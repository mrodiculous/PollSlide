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
const { setUserTier, claimStripeEvent } = require('../lib/tier');

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

// Pretty tier names for emails — the naive charAt-uppercase produced "Team_small".
const TIER_LABELS = { free: 'Free', pro: 'Pro', team_small: 'Team Small', team_large: 'Team Large' };
function planLabel(plan) { return TIER_LABELS[plan] || (plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : 'Pro'); }

function getTierFromPriceId(priceId) {
  return PRICE_TO_TIER[priceId] || null; // null = unknown (let callers fall through)
}

// The price's lookup key IS the current plan — e.g. "pollslide_team_small_monthly" →
// "team_small". This reflects the REAL plan after a Customer-Portal switch, unlike the
// subscription's metadata.plan (stamped at checkout, never updated on a switch).
function planFromLookupKey(lookupKey) {
  if (!lookupKey || lookupKey.indexOf('pollslide_') !== 0) return null;
  const plan = lookupKey.replace('pollslide_', '').replace(/_(monthly|annual)$/, '');
  return VALID_TIERS.includes(plan) ? plan : null;
}

// Resolve the true current tier for a subscription: prefer the live price's lookup key,
// then the price-ID env map, and only as a last resort the (possibly stale) metadata.
async function tierForSubscription(stripe, sub) {
  const priceItem = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price;
  const priceId = priceItem && priceItem.id;
  let lookupKey = priceItem && priceItem.lookup_key;
  if (!lookupKey && priceId) {
    try { const p = await stripe.prices.retrieve(priceId); lookupKey = p.lookup_key; } catch (e) {}
  }
  return planFromLookupKey(lookupKey)
      || getTierFromPriceId(priceId)
      || (VALID_TIERS.includes(sub.metadata && sub.metadata.plan) ? sub.metadata.plan : 'pro');
}

async function updateUserTier(uid, tier, stripeCustomerId, meta = {}) {
  const app = getFirebaseApp();
  const db = admin.database(app);
  // Audited + idempotent: a redelivered Stripe event that resolves to the SAME tier
  // now changes nothing and, crucially, triggers no email. Every real change is
  // recorded in admin/tier_log/<uid> with its cause. See lib/tier.js.
  const result = await setUserTier(db, uid, tier, {
    source: 'stripe-webhook',
    reason: meta.reason || 'subscription change',
    actor: 'stripe',
    ref: meta.eventId || null,
  });
  if (stripeCustomerId) {
    await db.ref(`users/${uid}/stripeCustomerId`).set(stripeCustomerId).catch(() => {});
    await db.ref(`admin/users_index/${uid}/stripeCustomerId`).set(stripeCustomerId).catch(() => {});
  }
  if (result.changed) await syncWorkspaceTier(db, uid, tier);
  return result;
}

// Defense in depth against duplicate subscriptions: when a new subscription checkout
// completes, cancel any OTHER active/trialing subscriptions on that customer, keeping
// only the newest (keepSubId). The create-checkout guard already blocks a 2nd checkout,
// so this only fires on a race or legacy duplicates — a customer must never carry two.
async function cancelOtherSubscriptions(stripe, customerId, keepSubId) {
  if (!customerId) return;
  try {
    const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
    const live = list.data.filter(s => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status));
    for (const s of live) {
      if (s.id !== keepSubId) {
        await stripe.subscriptions.cancel(s.id).catch(e => console.error('cancel dup sub failed:', s.id, e.message));
        console.log(`Cancelled duplicate subscription ${s.id} for customer ${customerId} (kept ${keepSubId})`);
      }
    }
  } catch (e) { console.error('cancelOtherSubscriptions error:', e.message); }
}

// One-time credit-pack purchase → add credits to users/<uid>/aiCredits.
// IDEMPOTENT: Stripe may deliver checkout.session.completed more than once, so we
// atomically CLAIM the session id first (only the first delivery wins). If the credit
// write then fails, we release the claim so Stripe's automatic retry re-processes it —
// so a purchase is never double-credited and never silently lost.
async function addCredits(uid, credits, sessionId) {
  const db = admin.database(getFirebaseApp());
  const guardRef = db.ref(`admin/credit_purchases/${sessionId}`);
  const claim = await guardRef.transaction(cur => (cur ? undefined : { uid, credits, at: Date.now(), status: 'claimed' }));
  if (!claim.committed) { console.log(`Credit purchase ${sessionId} already processed — skipping`); return; }
  try {
    await db.ref(`users/${uid}/aiCredits`).transaction(n => (n || 0) + credits);
    await guardRef.update({ status: 'done', doneAt: Date.now() });
    console.log(`Added ${credits} credits to ${uid} (session ${sessionId})`);
  } catch (e) {
    await guardRef.remove().catch(() => {});   // release the claim so the retry can re-process
    throw e;
  }
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
      // Audited too: a member whose plan changes because the OWNER's subscription
      // changed is exactly the case that looks inexplicable from the member's side.
      await setUserTier(db, memberUid, memberTier, {
        source: 'stripe-webhook', actor: 'stripe',
        reason: `workspace owner moved to ${tier}`, ref: wsId,
      });
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
    // Stripe guarantees at-least-once delivery. Without this, a redelivered
    // subscription event re-applies the tier change and re-sends the email — the
    // most likely cause of a plan silently flipping with no user action.
    const _db = admin.database(getFirebaseApp());
    if (!(await claimStripeEvent(_db, event.id))) {
      console.log('Stripe event already processed — ignoring replay:', event.id);
      return res.status(200).json({ received: true, duplicate: true });
    }

    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.metadata?.firebase_uid;
        const email = session.customer_details?.email || session.customer_email;

        // One-time CREDIT-PACK purchase — add credits, do NOT touch the subscription tier.
        if (session.metadata?.kind === 'credits') {
          const n = parseInt(session.metadata.credits, 10) || 0;
          if (uid && n > 0) {
            await addCredits(uid, n, session.id);
            if (email) await sendEmailNotification('receipt', email, {
              plan: n + ' Polly credits', amount: (session.amount_total / 100).toFixed(2), period: 'One-time',
            });
          }
          break;
        }

        // Subscription checkout — activate their plan
        const plan = session.metadata?.plan || 'pro';
        // Ensure a single active subscription — cancel any others (keep the new one).
        if (session.mode === 'subscription' && session.customer) {
          await cancelOtherSubscriptions(stripe, session.customer, session.subscription);
        }
        if (uid) {
          const chk = await updateUserTier(uid, plan, session.customer,
            { reason: 'checkout.session.completed', eventId: event.id });
          if (email && chk.changed) {
            await sendEmailNotification('upgrade', email, { plan: planLabel(plan), planKey: plan });
            await sendEmailNotification('receipt', email, {
              plan: planLabel(plan),
              amount: (session.amount_total / 100).toFixed(2),
              period: session.metadata?.billing === 'annual' ? 'Annual' : 'Monthly',
            });
          }
        } else if (email) {
          // Fallback: look up by email if uid wasn't in metadata
          const foundUid = await getUserUidByEmail(email);
          if (foundUid) await updateUserTier(foundUid, plan, session.customer,
            { reason: 'checkout.session.completed (email lookup)', eventId: event.id });
        }
        break;
      }

      case 'customer.subscription.updated': {
        // Subscription changed (upgrade, downgrade, renewal)
        const sub = event.data.object;
        // uid from the sub metadata, or fall back to the customer's metadata (portal
        // switches keep both, but be defensive).
        let uid = sub.metadata?.firebase_uid;
        if (!uid && sub.customer) {
          try { const cust = await stripe.customers.retrieve(sub.customer); uid = cust && cust.metadata && cust.metadata.firebase_uid; } catch (e) {}
        }
        // Derive the tier from the CURRENT price (lookup key) — NOT the stale metadata.plan,
        // which doesn't change on a Customer-Portal plan switch.
        const tier = await tierForSubscription(stripe, sub);
        const status = sub.status; // active, past_due, canceled, etc.

        if (uid) {
          if (status === 'active') {
            // This event also fires on renewals / card updates, so only email when the
            // PLAN actually changed (e.g. a Customer-Portal switch) — not every renewal.
            const db = admin.database(getFirebaseApp());
            const prevTier = (await db.ref(`users/${uid}/tier`).get()).val();
            const upd = await updateUserTier(uid, tier, sub.customer,
              { reason: 'customer.subscription.updated (' + status + ')', eventId: event.id });
            if (upd.changed && prevTier && prevTier !== tier && VALID_TIERS.includes(tier)) {
              const to = (await db.ref(`users/${uid}/email`).get()).val();
              if (to) await sendEmailNotification('upgrade', to, { plan: planLabel(tier), planKey: tier });
            }
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
          const res2 = await updateUserTier(uid, 'free', sub.customer,
            { reason: 'customer.subscription.deleted', eventId: event.id });
          // ONLY email on a real change. Previously this fired unconditionally, so a
          // replayed or duplicate cancellation event told an already-free user their
          // account had been downgraded — alarming, and impossible to trace.
          if (res2.changed) {
            const emailSnap = await db.ref(`users/${uid}/email`).get();
            if (emailSnap.val()) {
              await sendEmailNotification('downgrade', emailSnap.val(), {
                oldPlan: planLabel(oldPlan),
              });
            }
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        // Payment failed — warn the user, don't downgrade yet (grace period)
        const invoice = event.data.object;
        const uid = invoice.subscription_details?.metadata?.firebase_uid;
        const email = invoice.customer_email;
        const plan = getTierFromPriceId(invoice.lines?.data[0]?.price?.id) || 'pro';
        if (email) {
          await sendEmailNotification('payment_failed', email, {
            plan: planLabel(plan),
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
