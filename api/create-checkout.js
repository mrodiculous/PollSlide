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

  const { email, uid, plan, billing } = req.body || {};

  // Validate inputs
  if (!email || !uid || !plan) {
    return res.status(400).json({ error: 'Missing required fields: email, uid, plan' });
  }
  if (!['pro', 'team_small', 'team_large'].includes(plan)) {
    return res.status(400).json({ error: 'plan must be "pro", "team_small" or "team_large"' });
  }

  const cycle = billing === 'annual' ? 'annual' : 'monthly';
  const lookupKey = 'pollslide_' + plan + '_' + cycle;

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

    // Create the Checkout Session
    const params = {
      customer:             customer.id,
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      mode:                 'subscription',
      success_url:          APP_URL + '/presenter?upgrade=success&plan=' + plan,
      cancel_url:           APP_URL + '/presenter?upgrade=cancelled',
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      metadata: {
        firebase_uid: uid,
        plan:         plan,
        billing:      cycle,
      },
      subscription_data: {
        metadata: {
          firebase_uid: uid,
          plan:         plan,
        },
      },
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
