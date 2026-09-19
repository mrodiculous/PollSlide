// PollSlide — Stripe Customer Billing Portal
// Redirects users to Stripe's hosted portal to manage their own subscription.
// Handles: upgrades, downgrades, cancellations, payment method updates, invoices.
//
// Why Stripe Portal instead of custom UI?
// - Stripe hosts it — PCI compliant, always up-to-date, handles all edge cases
// - Users can downgrade/cancel themselves without contacting support
// - Invoice downloads, payment history, all built-in
// - When they cancel: our stripe-webhook fires customer.subscription.deleted
//   → Firebase tier reverts to 'free' → user notified by email
//
// SETUP: In Stripe Dashboard → Settings → Billing → Customer portal
// Enable: "Customers can cancel subscriptions", "Customers can switch plans",
// "Customers can update payment methods". Add your plans to the portal config.
//
// SECURITY — 2026-09-19. This endpoint used to take the email straight from the POST
// body with no authentication at all. Anyone who knew a customer's email address could
// POST it here and get back a working Stripe billing-portal link for that customer:
// their invoices and billing address, their payment methods, and the ability to cancel
// or switch their plan. No session, no token, nothing — just the address. The
// Access-Control-Allow-Origin header below is NOT a control here; CORS constrains
// browsers, and an attacker uses curl.
//
// The email is now taken from a verified Firebase ID token and NEVER from the body.
// Do not reintroduce a body-supplied email or customer id: the identity must come from
// something the caller cannot choose.
const { verifyToken, tokenFrom } = require('../lib/quota');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' });
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';

  // Identity comes from the token, not the caller's JSON.
  const tok = tokenFrom(req);
  if (!tok) return res.status(401).json({ error: 'Sign in required' });
  let who;
  try { who = await verifyToken(tok); }
  catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }
  const email = who && who.email;
  if (!email) return res.status(403).json({ error: 'Account has no email address' });
  // An unverified address can be attacker-chosen at sign-up, which would re-open the
  // same hole one step further back.
  if (who.email_verified === false) return res.status(403).json({ error: 'Verify your email address first' });

  try {
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (!customers.data.length) {
      return res.status(404).json({
        error: 'No Stripe customer found for this email.',
        hint: 'The user has never completed a checkout. Redirect them to upgrade first.'
      });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: APP_URL + '/presenter',
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
