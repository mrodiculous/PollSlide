// PollSlide — Stripe visibility inside the admin panel.
// ---------------------------------------------------------------------------
// WHY READ-ONLY (a deliberate decision, not an omission)
// This surfaces everything you need to UNDERSTAND billing — subscriptions, invoices,
// failed payments, revenue, and the raw Stripe event stream — but performs no
// refunds, cancellations or plan edits. Those stay in the Stripe Dashboard because:
//   • Stripe's own UI has confirmations, permissions and an immutable audit trail
//     that a bespoke panel would have to reimplement (badly) to be equally safe.
//   • A mis-click here would move real money. A mis-click there is at least
//     recorded against a named Stripe user.
// Every row returned includes a `dashboardUrl`, so acting is one click away in the
// place designed for it. See the "Act in Stripe" note in the admin UI.
//
// THE POINT OF THIS FILE: after an account silently changed plan with no user action
// (2026-08-07/17), the missing capability was cross-referencing what STRIPE thinks
// happened against what OUR database did (admin/tier_log — see lib/tier.js). The
// `user` action returns both sides so they can be read side by side.
//
// POST { action:'summary'|'user'|'events', uid?, limit? }  + admin Firebase ID token
const admin = require('firebase-admin');
const { getApp, verifyToken, tokenFrom, ADMIN_EMAILS } = require('../lib/quota');

const KEY = process.env.STRIPE_SECRET_KEY;
const LIVE = KEY && KEY.startsWith('sk_live');
const DASH = LIVE ? 'https://dashboard.stripe.com' : 'https://dashboard.stripe.com/test';

function money(cents, cur) {
  if (cents == null) return null;
  return { amount: cents / 100, currency: (cur || 'usd').toUpperCase() };
}
// Normalise a subscription to the handful of fields support actually needs.
function subRow(s) {
  const item = s.items && s.items.data && s.items.data[0];
  const price = item && item.price;
  return {
    id: s.id,
    status: s.status,                       // active | trialing | past_due | canceled | unpaid
    plan: price ? (price.lookup_key || price.nickname || price.id) : null,
    amount: price ? money(price.unit_amount, price.currency) : null,
    interval: price && price.recurring ? price.recurring.interval : null,
    currentPeriodEnd: s.current_period_end ? s.current_period_end * 1000 : null,
    cancelAtPeriodEnd: !!s.cancel_at_period_end,
    created: s.created ? s.created * 1000 : null,
    trialEnd: s.trial_end ? s.trial_end * 1000 : null,
    firebaseUid: (s.metadata && s.metadata.firebase_uid) || null,
    dashboardUrl: `${DASH}/subscriptions/${s.id}`,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  // Admin only — same gate as the other admin endpoints.
  let who;
  try { who = await verifyToken(tokenFrom(req)); }
  catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }
  if (!ADMIN_EMAILS.includes(who.email)) return res.status(403).json({ error: 'Admins only' });

  if (!KEY) return res.status(200).json({ ok: true, configured: false, note: 'STRIPE_SECRET_KEY is not set in this environment.' });

  const stripe = require('stripe')(KEY);
  const db = admin.database(getApp());
  const { action = 'summary', uid, limit } = req.body || {};
  const n = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);

  try {
    // ── SUMMARY — the billing health of the business at a glance ────────────
    if (action === 'summary') {
      const subs = await stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.items.data.price'] });
      const rows = subs.data.map(subRow);
      const live = rows.filter(r => ['active', 'trialing'].includes(r.status));
      // Monthly recurring revenue, annual plans amortised to a monthly figure.
      const mrr = live.reduce((sum, r) => {
        if (!r.amount) return sum;
        return sum + (r.interval === 'year' ? r.amount.amount / 12 : r.amount.amount);
      }, 0);
      const byPlan = {};
      live.forEach(r => { const k = r.plan || 'unknown'; byPlan[k] = (byPlan[k] || 0) + 1; });
      const problems = rows.filter(r => ['past_due', 'unpaid', 'incomplete'].includes(r.status));
      const cancelling = live.filter(r => r.cancelAtPeriodEnd);
      return res.status(200).json({
        ok: true, configured: true, mode: LIVE ? 'live' : 'test', dashboard: DASH,
        counts: { total: rows.length, active: live.length, problem: problems.length, cancelling: cancelling.length },
        mrr: Math.round(mrr * 100) / 100, byPlan,
        problems, cancelling,
      });
    }

    // ── USER — Stripe's view AND our audit trail, side by side ──────────────
    // This is the pairing that was missing when a plan changed with no user action.
    if (action === 'user') {
      if (!uid) return res.status(400).json({ error: 'uid required' });
      const [tierSnap, custSnap, emailSnap, logSnap] = await Promise.all([
        db.ref(`users/${uid}/tier`).get(),
        db.ref(`users/${uid}/stripeCustomerId`).get(),
        db.ref(`users/${uid}/email`).get(),
        db.ref(`admin/tier_log/${uid}`).get(),
      ]);
      const customerId = custSnap.val();
      const ourTierLog = logSnap.exists()
        ? Object.entries(logSnap.val()).map(([ts, r]) => ({ at: Number(r.at || ts), ...r })).sort((a, b) => b.at - a.at).slice(0, n)
        : [];

      let subscriptions = [], invoices = [], customer = null;
      if (customerId) {
        const [subList, invList] = await Promise.all([
          stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20, expand: ['data.items.data.price'] }).catch(() => ({ data: [] })),
          stripe.invoices.list({ customer: customerId, limit: 20 }).catch(() => ({ data: [] })),
        ]);
        subscriptions = subList.data.map(subRow);
        invoices = invList.data.map(i => ({
          id: i.id, status: i.status, total: money(i.total, i.currency),
          created: i.created ? i.created * 1000 : null,
          paidAt: i.status_transitions && i.status_transitions.paid_at ? i.status_transitions.paid_at * 1000 : null,
          attemptCount: i.attempt_count || 0,
          dashboardUrl: `${DASH}/invoices/${i.id}`,
        }));
        customer = { id: customerId, dashboardUrl: `${DASH}/customers/${customerId}` };
      }
      return res.status(200).json({
        ok: true, configured: true, mode: LIVE ? 'live' : 'test',
        uid, email: emailSnap.val() || null, ourTier: tierSnap.val() || 'free',
        customer, subscriptions, invoices, ourTierLog,
        note: customerId ? null : 'No Stripe customer linked — this account has never checked out.',
      });
    }

    // ── EVENTS — the raw Stripe stream, for tracing a specific change ────────
    // Repeated delivery attempts on ONE event id is the signature of the replay
    // that could previously re-apply a tier change and re-send its email.
    if (action === 'events') {
      const evs = await stripe.events.list({ limit: n });
      const rows = evs.data.map(e => ({
        id: e.id, type: e.type, created: e.created * 1000,
        pendingWebhooks: e.pending_webhooks,
        livemode: e.livemode,
        summary: (e.data && e.data.object && (e.data.object.id || '')) || '',
        dashboardUrl: `${DASH}/events/${e.id}`,
      }));
      // Which of these did our webhook actually claim? (admin/stripe_events)
      const claimed = {};
      await Promise.all(rows.map(async r => {
        try { claimed[r.id] = (await db.ref(`admin/stripe_events/${r.id}`).get()).exists(); }
        catch (e) { claimed[r.id] = null; }
      }));
      return res.status(200).json({ ok: true, configured: true, mode: LIVE ? 'live' : 'test', dashboard: DASH, events: rows, claimed });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    console.error('stripe-admin error:', e && e.message);
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
};
