// PollSlide — Stripe Webhook Handler
// Vercel Serverless Function
//
// SETUP INSTRUCTIONS:
// 1. In Stripe Dashboard → Developers → Webhooks → Add endpoint:
//    URL: https://app.pollslide.com/api/stripe-webhook
//    Events to listen for:
//      - checkout.session.completed
//      - customer.subscription.updated
//      - customer.subscription.deleted
//      - invoice.payment_failed
//      - invoice.payment_succeeded
// 2. Copy the webhook signing secret and add to Vercel:
//    STRIPE_WEBHOOK_SECRET=whsec_...
// 3. Add Firebase Admin credentials to Vercel:
//    FIREBASE_DATABASE_URL=https://echonest-live-survey-default-rtdb.firebaseio.com
//    FIREBASE_CLIENT_EMAIL=... (from Firebase Console → Project Settings → Service Accounts → Generate new private key)
//    FIREBASE_PRIVATE_KEY=... (same JSON, the "private_key" field)
//    FIREBASE_PROJECT_ID=echonest-live-survey
// 4. After deploy, verify by clicking "Send test webhook" in Stripe Dashboard

const Stripe = require('stripe');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK (server-side — uses service account, not client SDK)
function getFirebaseApp() {
  if (admin.apps.length > 0) return admin.apps[0];

  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) {
    throw new Error('Firebase Admin credentials not configured. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY to Vercel Environment Variables.');
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

// Map Stripe price IDs to PollSlide plan tier names (fallback only — the primary
// source of truth is the `plan` we stash in subscription metadata at checkout).
const PRICE_TO_TIER = {
  [process.env.STRIPE_PRICE_PRO_MONTHLY]: 'pro',
  [process.env.STRIPE_PRICE_PRO_ANNUAL]: 'pro',
  [process.env.STRIPE_PRICE_TEAM_SMALL_MONTHLY]: 'team_small',
  [process.env.STRIPE_PRICE_TEAM_SMALL_ANNUAL]: 'team_small',
  [process.env.STRIPE_PRICE_TEAM_LARGE_MONTHLY]: 'team_large',
  [process.env.STRIPE_PRICE_TEAM_LARGE_ANNUAL]: 'team_large',
};
const VALID_TIERS = ['pro', 'team_small', 'team_large'];

function getTierFromPriceId(priceId) {
  return PRICE_TO_TIER[priceId] || 'pro'; // default to pro if unknown
}

async function updateUserTier(uid, tier, stripeCustomerId) {
  const app = getFirebaseApp();
  const db = admin.database(app);
  const updates = {
    tier,
    stripeCustomerId: stripeCustomerId || null,
    tierUpdatedAt: Date.now(),
  };
  await db.ref(`users/${uid}`).update(updates);
  await db.ref(`admin/users_index/${uid}`).update(updates);
  console.log(`Updated user ${uid} tier → ${tier}`);
  await syncWorkspaceTier(db, uid, tier);
}

// If this user OWNS a team workspace, keep the workspace and its members in
// step with the owner's subscription: workspaces/<id>/tier drives the seat
// limit in api/team.js, and members inherit their tier because the owner pays.
// When the owner leaves the team tiers (downgrade or cancel), members drop to
// free — never to the owner's personal paid tier.
async function syncWorkspaceTier(db, uid, tier) {
  try {
    const wsId = (await db.ref(`users/${uid}/workspaceId`).get()).val();
    if (!wsId) return;
    const wsSnap = await db.ref(`workspaces/${wsId}`).get();
    if (!wsSnap.exists()) return;
    const ws = wsSnap.val();
    if (ws.ownerUid !== uid || ws.tier === tier) return;
    await db.ref(`workspaces/${wsId}/tier`).set(tier);
    const memberTier = (tier === 'team_small' || tier === 'team_large') ? tier : 'free';
    for (const memberUid of Object.keys(ws.members || {})) {
      if (memberUid === uid) continue;
      await db.ref(`users/${memberUid}/tier`).set(memberTier);
      await db.ref(`admin/users_index/${memberUid}/tier`).set(memberTier);
    }
    console.log(`Synced workspace ${wsId} tier → ${tier}; members → ${memberTier}`);
  } catch (e) {
    console.error('Workspace tier sync failed (non-fatal):', e.message);
  }
}

async function getUserUidByEmail(email) {
  const app = getFirebaseApp();
  try {
    const user = await admin.auth(app).getUserByEmail(email);
    return user.uid;
  } catch (e) {
    console.error('Could not find user by email:', email, e.message);
    return null;
  }
}

async function sendEmailNotification(type, to, data) {
  // Fire-and-forget — call our own email endpoint
  try {
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
    await fetch(`${APP_URL}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify({ type, to, data }),
    });
  } catch (e) {
    console.error('Email notification failed:', e.message);
    // Never block the webhook on email failure
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Stripe credentials not configured' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' });

  // Verify webhook signature — prevents spoofed events
  let event;
  try {
    const signature = req.headers['stripe-signature'];
    // Vercel exposes the raw body when you use config.api.bodyParser = false
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
  }

  console.log('Stripe event:', event.type, event.id);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        // User completed checkout — activate their plan
        const session = event.data.object;
        const uid = session.metadata?.firebase_uid;
        const plan = session.metadata?.plan || 'pro';
        const email = session.customer_details?.email || session.customer_email;

        if (uid) {
          await updateUserTier(uid, plan, session.customer);
          if (email) {
            await sendEmailNotification('upgrade', email, { plan: plan.charAt(0).toUpperCase() + plan.slice(1) });
            await sendEmailNotification('receipt', email, {
              plan: plan.charAt(0).toUpperCase() + plan.slice(1),
              amount: (session.amount_total / 100).toFixed(2),
              period: session.metadata?.billing === 'annual' ? 'Annual' : 'Monthly',
            });
          }
        } else if (email) {
          // Fallback: look up by email if uid wasn't in metadata
          const foundUid = await getUserUidByEmail(email);
          if (foundUid) await updateUserTier(foundUid, plan, session.customer);
        }
        break;
      }

      case 'customer.subscription.updated': {
        // Subscription changed (upgrade, downgrade, renewal)
        const sub = event.data.object;
        const uid = sub.metadata?.firebase_uid;
        const priceId = sub.items?.data[0]?.price?.id;
        // Prefer the plan we stamped at checkout; fall back to the price-ID map.
        const metaPlan = sub.metadata?.plan;
        const tier = VALID_TIERS.includes(metaPlan) ? metaPlan : getTierFromPriceId(priceId);
        const status = sub.status; // active, past_due, canceled, etc.

        if (uid) {
          if (status === 'active') {
            await updateUserTier(uid, tier, sub.customer);
          } else if (status === 'past_due') {
            // Don't downgrade yet — give them the 7-day grace period
            await admin.database(getFirebaseApp()).ref(`users/${uid}/subscriptionStatus`).set('past_due');
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        // Subscription cancelled — downgrade to free
        const sub = event.data.object;
        const uid = sub.metadata?.firebase_uid;
        if (uid) {
          const db = admin.database(getFirebaseApp());
          const oldTierSnap = await db.ref(`users/${uid}/tier`).get();
          const oldPlan = oldTierSnap.val() || 'pro';
          await updateUserTier(uid, 'free', sub.customer);
          // Email: downgrade notice
          const emailSnap = await db.ref(`users/${uid}/email`).get();
          if (emailSnap.val()) {
            await sendEmailNotification('downgrade', emailSnap.val(), {
              oldPlan: oldPlan.charAt(0).toUpperCase() + oldPlan.slice(1),
            });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        // Payment failed — warn the user, don't downgrade yet (grace period)
        const invoice = event.data.object;
        const uid = invoice.subscription_details?.metadata?.firebase_uid;
        const email = invoice.customer_email;
        const plan = getTierFromPriceId(invoice.lines?.data[0]?.price?.id) || 'Pro';
        if (email) {
          await sendEmailNotification('payment_failed', email, {
            plan: plan.charAt(0).toUpperCase() + plan.slice(1),
          });
        }
        if (uid) {
          await admin.database(getFirebaseApp()).ref(`users/${uid}/subscriptionStatus`).set('payment_failed');
          await admin.database(getFirebaseApp()).ref(`admin/users_index/${uid}/subscriptionStatus`).set('payment_failed');
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        // Payment succeeded — clear any payment_failed status
        const invoice = event.data.object;
        const uid = invoice.subscription_details?.metadata?.firebase_uid;
        if (uid) {
          await admin.database(getFirebaseApp()).ref(`users/${uid}/subscriptionStatus`).set('active');
          await admin.database(getFirebaseApp()).ref(`admin/users_index/${uid}/subscriptionStatus`).set('active');
        }
        break;
      }

      default:
        // Unexpected event type — acknowledge but don't process
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    // Return 200 anyway — Stripe retries on non-200, which can cause loops
    return res.status(200).json({ received: true, warning: 'Handler error — check logs' });
  }

  return res.status(200).json({ received: true, type: event.type });
};

// Vercel requires raw body for Stripe signature verification
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Tell Vercel NOT to parse the body — Stripe needs the raw bytes for signature verification
module.exports.config = {
  api: { bodyParser: false },
};
