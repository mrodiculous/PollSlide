/* PollSlide — Enterprise "Contact us" lead capture.
 * ---------------------------------------------------------------------------
 * Enterprise has no Stripe price — it's negotiated by size — so there is no checkout
 * to hand this off to. This records the lead (admin/enterprise_leads, listed in
 * admin.html's Marketing → Enterprise leads tab) and emails Rod, so a submission is
 * never lost even if the inbox notification is missed.
 *
 * TWO ORIGINS CALL THIS, not one: the marketing site's pricing page (pollslide.com)
 * AND the in-app plan picker (app.pollslide.com). Every other endpoint in this
 * codebase answers to a single hardcoded Access-Control-Allow-Origin; this is the
 * one place that needs an allowlist instead, with Vary: Origin so a CDN never caches
 * one origin's response and serves it to the other.
 *
 * No auth required — an Enterprise inquiry can come from someone who hasn't signed
 * up yet. If a valid ID token IS attached (the in-app picker sends one when
 * available), the lead is tagged with that account so a follow-up can find it.
 *
 * Env: FIREBASE_*, INTERNAL_API_KEY (notification email), NEXT_PUBLIC_APP_URL.
 * --------------------------------------------------------------------------- */
const admin = require('firebase-admin');
const { verifyToken, tokenFrom } = require('../lib/quota');
const { rateLimit, clientIp, sweepRateLimits } = require('../lib/guard');

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
const ALLOWED_ORIGINS = new Set(['https://pollslide.com', 'https://www.pollslide.com', APP_URL]);
const SIZES = new Set(['1-50', '51-200', '201-1000', '1000+']);
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

function getDb() {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) return null;
  const app = admin.apps.length ? admin.apps[0] : admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  return admin.database(app);
}

async function notify(subject, heading, body) {
  try {
    await fetch(APP_URL + '/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify({ type: 'notify', to: process.env.OPS_ALERT_EMAIL || 'help@pollslide.com', data: { subject, heading, body } }),
    });
  } catch (e) { /* the lead is still recorded; email is a courtesy */ }
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Not configured' });

  const name = String((req.body && req.body.name) || '').trim().slice(0, 120);
  const email = String((req.body && req.body.email) || '').trim().slice(0, 200);
  const size = String((req.body && req.body.size) || '').trim();
  const message = String((req.body && req.body.message) || '').trim().slice(0, 2000);

  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!SIZES.has(size)) return res.status(400).json({ error: 'Choose your organisation size.' });

  // Two independent limits: an attacker spamming ONE address can't flood it (per-email),
  // and an attacker rotating addresses from one machine can't flood us either (per-IP).
  const emailKey = email.toLowerCase().replace(/[.#$/[\]@]/g, '_');
  const [byEmail, byIp] = await Promise.all([
    rateLimit(db, `enterprise_lead:email:${emailKey}`, 3, 86400000),
    rateLimit(db, `enterprise_lead:ip:${clientIp(req)}`, 10, 3600000),
  ]);
  sweepRateLimits(db);   // fire-and-forget housekeeping, same as every other guarded endpoint
  if (!byEmail.allowed) return res.status(429).json({ error: "We've already got a message from you — we'll be in touch. Email help@pollslide.com if it's urgent." });
  if (!byIp.allowed) return res.status(429).json({ error: 'Too many requests — try again shortly.' });

  // Best-effort: an expired/missing token still lets the lead through as anonymous
  // rather than blocking a signed-in visitor on a token refresh race.
  let uid = null, accountEmail = null;
  const tok = tokenFrom(req);
  if (tok) { try { const who = await verifyToken(tok); uid = who.uid; accountEmail = who.email; } catch (e) {} }

  const id = db.ref('admin/enterprise_leads').push().key;
  const lead = {
    name, email, size, message,
    uid, accountEmail,
    origin: origin || null,
    status: 'new',
    createdAt: Date.now(),
  };
  try {
    await db.ref('admin/enterprise_leads/' + id).set(lead);
  } catch (e) {
    return res.status(500).json({ error: 'Could not save your request — try again, or email help@pollslide.com directly.' });
  }

  notify(
    `Enterprise inquiry — ${name || email}`,
    'New Enterprise lead',
    `${name || '(no name given)'} <${email}> — ${size} people${message ? `\n\n"${message}"` : ''}${accountEmail ? `\n\nSigned in as: ${accountEmail}` : ''}`
  );

  return res.status(200).json({ ok: true });
};
