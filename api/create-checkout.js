// PollSlide — Stripe Checkout Session Creator
// Vercel Serverless Function
//
// SETUP INSTRUCTIONS (do this once when Stripe account is ready):
// 1. Install Stripe npm package: add "stripe": "^14.0.0" to package.json in pollslide repo
// 2. In Stripe Dashboard → Products, create 4 prices:
//    - Pro Monthly: $12/mo recurring
//    - Pro Annual: $10/mo (= $120/yr) recurring annual
//    - Team Monthly: $39/mo recurring
//    - Team Annual: $32/mo (= $384/yr) recurring annual
// 3. In Vercel Environment Variables, add:
//    STRIPE_SECRET_KEY=sk_live_...  (from Stripe Dashboard → Developers → API Keys)
//    STRIPE_PRICE_PRO_MONTHLY=price_...
//    STRIPE_PRICE_PRO_ANNUAL=price_...
//    STRIPE_PRICE_TEAM_MONTHLY=price_...
//    STRIPE_PRICE_TEAM_ANNUAL=price_...
//    NEXT_PUBLIC_APP_URL=https://app.pollslide.com  (your app domain)
// 4. Deploy — endpoint is live at app.pollslide.com/api/create-checkout

const PRICE_MAP = {
  pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
  pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
  team_monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY,
  team_annual: process.env.STRIPE_PRICE_TEAM_ANNUAL,
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe not configured. Add STRIPE_SECRET_KEY to Vercel Environment Variables.' });
  }

  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20' });
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';

  const { email, uid, plan, billing } = req.body || {};

  if (!email || !uid || !plan) {
    return res.status(400).json({ error: 'Missing: email, uid, or plan' });
  }
  if (!['pro', 'team'].includes(plan)) {
    return res.status(400).json({ error: 'Plan must be "pro" or "team"' });
  }
  const billingCycle = billing === 'annual' ? 'annual' : 'monthly';
  const priceKey = `${plan}_${billingCycle}`;
  const priceId = PRICE_MAP[priceKey];

  if (!priceId) {
    return res.status(500).json({ error: `Price not configured for: ${priceKey}. Add ${`STRIPE_PRICE_${priceKey.toUpperCase()}`} to Vercel Environment Variables.` });
  }

  try {
    // Create or retrieve the Stripe customer for this user
    const existing = await stripe.customers.list({ email, limit: 1 });
    let customer;
    if (existing.data.length > 0) {
      customer = existing.data[0];
    } else {
      customer = await stripe.customers.create({
        email,
        metadata: { firebase_uid: uid },
      });
    }

    // Create the Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${APP_URL}/presenter?upgrade=success&plan=${plan}`,
      cancel_url: `${APP_URL}/presenter?upgrade=cancelled`,
      metadata: {
        firebase_uid: uid,
        plan,
        billing: billingCycle,
      },
      subscription_data: {
        metadata: {
          firebase_uid: uid,
          plan,
        },
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
    });

    return res.status(200).json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session', detail: err.message });
  }
};
