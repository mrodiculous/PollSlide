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

    /* ── PRICES — can checkout actually find every plan? ──────────────────────
     * api/create-checkout.js resolves a price by LOOKUP KEY, and returns 404 when the key
     * is not on any price. Nothing in the product could answer "which of the ten keys are
     * missing" — so a plan that had never been given its lookup key looked, from the
     * Plans & Upgrade panel, exactly like a button that did nothing.
     * This lists every key checkout will ask Stripe for, whether Stripe has it, and what it
     * costs, so a broken plan is visible before a customer finds it. Read-only. */
    if (action === 'prices') {
      const EXPECT = [
        { key: 'pollslide_pro_monthly',        what: 'Pro — monthly',        expect: 12 },
        { key: 'pollslide_pro_yearly',         what: 'Pro — yearly',         expect: 120 },
        { key: 'pollslide_team_small_monthly', what: 'Team Small — monthly', expect: 39 },
        { key: 'pollslide_team_small_yearly',  what: 'Team Small — yearly',  expect: 384 },
        { key: 'pollslide_team_large_monthly', what: 'Team Large — monthly', expect: 199 },
        { key: 'pollslide_team_large_yearly',  what: 'Team Large — yearly',  expect: 1980 },
        { key: 'pollslide_credits_20',         what: '20 Polly credits',     expect: 8 },
        { key: 'pollslide_credits_100',        what: '100 Polly credits',    expect: 30 },
        { key: 'pollslide_credits_200',        what: '200 Polly credits',    expect: 50 },
        { key: 'pollslide_credits_500',        what: '500 Polly credits',    expect: 100 },
      ];
      const rows = await Promise.all(EXPECT.map(async e => {
        try {
          const list = await stripe.prices.list({ lookup_keys: [e.key], limit: 1, active: true });
          const p = list.data[0];
          if (!p) {
            return { ...e, found: false,
              fix: 'Stripe Dashboard → Products → open the price → Edit → Advanced → Lookup key: ' + e.key };
          }
          const amount = p.unit_amount == null ? null : p.unit_amount / 100;
          return { ...e, found: true, priceId: p.id, amount,
            currency: (p.currency || 'usd').toUpperCase(),
            interval: p.recurring ? p.recurring.interval : 'one-time',
            // The classic annual mistake: the per-MONTH figure entered as the yearly price.
            amountMatches: amount === e.expect,
            dashboardUrl: `${DASH}/prices/${p.id}` };
        } catch (err) { return { ...e, found: false, error: String(err && err.message || err) }; }
      }));
      const missing = rows.filter(r => !r.found);
      const wrongAmount = rows.filter(r => r.found && !r.amountMatches);
      return res.status(200).json({
        ok: true, configured: true, mode: LIVE ? 'live' : 'test', dashboard: DASH, prices: rows,
        missing: missing.length, wrongAmount: wrongAmount.length,
        verdict: missing.length ? `${missing.length} plan(s) have no price with that lookup key — checkout for those returns 404 and the button appears to do nothing.`
               : wrongAmount.length ? `${wrongAmount.length} price(s) exist but charge a different amount than the pricing page shows.`
               : 'All ten lookup keys resolve, and every amount matches the pricing page.',
      });
    }

    /* ── CHECKOUT DRY RUN — the only test that proves checkout works ───────────
     * The price check above proves Stripe can FIND a plan. It does not prove a session can
     * be CREATED, and that is a separate failure with a separate cause: the consent and tax
     * blocks in create-checkout.js are added to every session, so switching either env var
     * on before its Dashboard setting exists breaks all ten purchases at once — which reads,
     * from the Plans & Upgrade panel, as "the button does nothing".
     * So this builds the same params create-checkout builds, creates a real session, and
     * expires it immediately. Nothing is charged and no customer sees it; a Checkout Session
     * is just a URL until someone pays. It reports the exact Stripe error when it fails. */
    if (action === 'checkout-dryrun') {
      const key = (req.body && req.body.lookupKey) || 'pollslide_pro_monthly';
      const isSub = !/credits/.test(key);
      const out = { lookupKey: key, consent: process.env.STRIPE_COLLECT_CONSENT === '1',
                    automaticTax: process.env.STRIPE_AUTOMATIC_TAX === '1' };
      const list = await stripe.prices.list({ lookup_keys: [key], limit: 1 });
      if (!list.data.length) {
        return res.status(200).json({ ok: true, dryRun: { ...out, passed: false,
          error: 'No price carries the lookup key "' + key + '".',
          fix: 'Stripe → Products → the price → Edit → Advanced → Lookup key: ' + key }});
      }
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
      const params = {
        payment_method_types: ['card'],
        line_items: [{ price: list.data[0].id, quantity: 1 }],
        mode: isSub ? 'subscription' : 'payment',
        success_url: APP_URL + '/presenter?dryrun=1',
        cancel_url:  APP_URL + '/presenter?dryrun=1',
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
        customer_email: 'dry-run@pollslide.com',
      };
      if (out.consent)      params.consent_collection = { terms_of_service: 'required' };
      if (out.automaticTax) { params.automatic_tax = { enabled: true };
                              params.tax_id_collection = { enabled: true };
                              params.billing_address_collection = 'required'; }
      try {
        const s = await stripe.checkout.sessions.create(params);
        try { await stripe.checkout.sessions.expire(s.id); } catch (e) {}
        return res.status(200).json({ ok: true, dryRun: { ...out, passed: true,
          note: 'A real Checkout Session was created with your live settings, then expired. Checkout works.' }});
      } catch (e) {
        const m = String(e && e.message || e);
        let fix = null;
        if (/terms.of.service|consent_collection/i.test(m)) {
          fix = 'STRIPE_COLLECT_CONSENT=1 is set but this account has no Terms of Service URL. ' +
                'Set it at Settings → Checkout and Payment Links → Terms of service, or remove ' +
                'STRIPE_COLLECT_CONSENT from Vercel and redeploy.';
        } else if (/automatic_tax|tax is not active|origin address|Stripe Tax/i.test(m)) {
          fix = 'STRIPE_AUTOMATIC_TAX=1 is set but Stripe Tax is not active (or has no origin ' +
                'address). Activate it at Settings → Tax, or remove STRIPE_AUTOMATIC_TAX from ' +
                'Vercel and redeploy.';
        }
        return res.status(200).json({ ok: true, dryRun: { ...out, passed: false, error: m, fix } });
      }
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    console.error('stripe-admin error:', e && e.message);
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
};
