// PollSlide — Stripe Checkout Session Creator
// Vercel Serverless Function
//
// Uses Stripe price LOOKUP KEYS instead of hardcoded price IDs.
// In your Stripe dashboard, set lookup keys on each price:
//   Pro Monthly:         pollslide_pro_monthly
//   Pro Annual:          pollslide_pro_annual
//   Team Small Monthly:  pollslide_team_small_monthly
//   Team Small Annual:   pollslide_team_small_annual
//   Team Large Monthly:  pollslide_team_large_monthly
//   Team Large Annual:   pollslide_team_large_annual
//   Credit pack 20:      pollslide_credits_20     (one-time)
//   Credit pack 100:     pollslide_credits_100    (one-time)
//   Credit pack 200:     pollslide_credits_200    (one-time)
//   Credit pack 500:     pollslide_credits_500    (one-time)
//
// Two purchase types: a subscription PLAN (mode:'subscription') or a one-time
// CREDIT PACK (mode:'payment') — the request body decides which.
//
// Vercel Environment Variables needed (only 3):
//   STRIPE_SECRET_KEY     = sk_test_... (sandbox) or sk_live_... (production)
//   NEXT_PUBLIC_APP_URL   = https://app.pollslide.com
//   (No price ID variables needed — lookup keys are in Stripe itself)

module.exports = async function handler(req, res) {
  // Security: only allow requests from your app domain
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({
      error: 'STRIPE_SECRET_KEY not set. Add it in Vercel → Settings → Environment Variables.'
    });
  }

  const Stripe = require('stripe');
  const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' });
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';

  const { email, uid, plan, billing, credits } = req.body || {};

  // Validate the always-required fields
  if (!email || !uid) {
    return res.status(400).json({ error: 'Missing required fields: email, uid' });
  }

  // Decide what's being bought: a one-time CREDIT PACK or a subscription PLAN.
  const CREDIT_PACKS = { 20: true, 100: true, 200: true, 500: true };
  const isCredits = credits !== undefined && credits !== null && String(credits) !== '';

  let lookupKey, mode, successUrl, sessionMeta, extra;
  if (isCredits) {
    const n = parseInt(credits, 10);
    if (!CREDIT_PACKS[n]) {
      return res.status(400).json({ error: 'credits must be one of 20, 100, 200, 500' });
    }
    lookupKey   = 'pollslide_credits_' + n;
    mode        = 'payment';                                  // one-time, NOT recurring
    successUrl  = APP_URL + '/presenter?credits=' + n;
    sessionMeta = { firebase_uid: uid, kind: 'credits', credits: String(n) };
    // Stamp the payment intent too, so the webhook can read it from either object.
    extra       = { payment_intent_data: { metadata: { firebase_uid: uid, kind: 'credits', credits: String(n) } } };
  } else {
    if (!plan) return res.status(400).json({ error: 'Missing required field: plan (or credits)' });
    if (!['pro', 'team_small', 'team_large'].includes(plan)) {
      return res.status(400).json({ error: 'plan must be "pro", "team_small" or "team_large"' });
    }
    const cycle = billing === 'annual' ? 'annual' : 'monthly';
    lookupKey   = 'pollslide_' + plan + '_' + cycle;
    mode        = 'subscription';
    successUrl  = APP_URL + '/presenter?upgrade=success&plan=' + plan;
    sessionMeta = { firebase_uid: uid, plan: plan, billing: cycle };
    extra       = { subscription_data: { metadata: { firebase_uid: uid, plan: plan } } };
  }

  try {
    // Fetch price by lookup key — this is set directly in Stripe dashboard
    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });

    if (!prices.data.length) {
      return res.status(404).json({
        error: 'Price not found for lookup key: "' + lookupKey + '"',
        fix: 'In Stripe Dashboard → Product → Price → Edit → Advanced → set Lookup key to: ' + lookupKey
      });
    }

    const priceId = prices.data[0].id;

    // Find or create the Stripe customer for this Firebase user
    const customers = await stripe.customers.list({ email: email, limit: 1 });
    let customer;
    if (customers.data.length > 0) {
      customer = customers.data[0];
      // Keep Firebase UID in sync on the customer record
      if (!customer.metadata.firebase_uid) {
        await stripe.customers.update(customer.id, { metadata: { firebase_uid: uid } });
      }
    } else {
      customer = await stripe.customers.create({
        email: email,
        metadata: { firebase_uid: uid },
      });
    }

    // Create the Checkout Session (mode + metadata + success URL vary by purchase type)
    const params = {
      customer:             customer.id,
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      mode:                 mode,
      success_url:          successUrl,
      cancel_url:           APP_URL + '/presenter?upgrade=cancelled',
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      metadata:             sessionMeta,
      ...extra,
    };

    // Consumer-law compliance, each opt-in via env so checkout never breaks
    // before the Stripe Dashboard is configured for it:
    //   STRIPE_COLLECT_CONSENT=1 — adds the "I agree to the Terms" checkbox
    //     (records acceptance on the Checkout Session). REQUIRES the Terms of
    //     Service URL set first: Dashboard → Settings → Business → Public details.
    //   STRIPE_AUTOMATIC_TAX=1 — VAT/GST/sales tax via Stripe Tax + business
    //     tax-ID field. REQUIRES Stripe Tax enabled in the Dashboard first.
    if (process.env.STRIPE_COLLECT_CONSENT === '1') {
      params.consent_collection = { terms_of_service: 'required' };
    }
    if (process.env.STRIPE_AUTOMATIC_TAX === '1') {
      params.automatic_tax = { enabled: true };
      params.customer_update = { address: 'auto' };
      params.tax_id_collection = { enabled: true };
      params.billing_address_collection = 'required';
    }

    const session = await stripe.checkout.sessions.create(params);

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
