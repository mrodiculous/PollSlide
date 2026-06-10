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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: 'Stripe not configured' });

  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' });
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });

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
