/* PollSlide — "Contact us" lead capture for the Enterprise plan.
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN ENDPOINT
 * Enterprise is priced by size, negotiated by a human, not sold through Stripe
 * Checkout — so there is no lookup key and no create-checkout path for it. This is
 * the whole product for that plan: capture who's asking, tell Rod, and give the
 * visitor proof it went somewhere.
 *
 * WHY IT ANSWERS TWO ORIGINS
 * The same form lives in two places with two different audiences: the marketing
 * site (pollslide.com/pricing — usually a signed-out visitor sizing up the product)
 * and the in-app plan picker (app.pollslide.com — someone already on Team Large
 * bumping into its ceiling). Every other endpoint in api/ answers exactly one
 * origin because it is only ever called from the app. This is the first one two
 * different sites need to call, so the single hardcoded ACAO header those all use
 * would silently 0-result every request from whichever origin lost.
 *
 * WHY NO SIGN-IN IS REQUIRED
 * A marketing-site visitor evaluating Enterprise has often never created an
 * account — requiring one first is a lead lost. `uid`/`email` from a verified
 * token are trusted when present; the form fields are trusted only as far as
 * "somebody typed this," same posture as any public contact form.
 *
 * Env: FIREBASE_*, INTERNAL_API_KEY (the Rod-facing notification email),
 *      NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SITE_URL (defaults below cover both).
 * --------------------------------------------------------------------------- */
const admin = require('firebase-admin');
const { verifyToken, tokenFrom } = require('../lib/quota');
const { rateLimit, clientIp, sweepRateLimits } = require('../lib/guard');

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
// The two sites this form is embedded on. An unlisted Origin gets no ACAO header at
// all — same as every other endpoint's behaviour for a caller it doesn't recognise —
// rather than silently allowing anyone who asks.
const ALLOWED_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_SITE_URL || 'https://pollslide.com',
  APP_URL,
]);

const SIZES = new Set(['1-50', '51-200', '201-1000', '1000+']);
const s = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
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

const esc = (v) => String(v == null ? '' : v)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function notifyOwner(lead) {
  try {
    await fetch(APP_URL + '/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify({
        type: 'notify',
        to: process.env.OPS_ALERT_EMAIL || 'help@pollslide.com',
        data: {
          subject: `🏢 Enterprise inquiry — ${lead.size} · ${lead.email}`,
          heading: 'New Enterprise lead',
          body: `<p><b>${esc(lead.name || lead.email)}</b> (${esc(lead.email)}) — organisation size ${esc(lead.size)}.</p>` +
                (lead.message ? `<p style="border-left:3px solid #6c63ff;padding-left:12px;color:#444;">${esc(lead.message).replace(/\n/g, '<br>')}</p>` : '') +
                `<p style="color:#666;font-size:12.5px;">From ${esc(lead.origin)}${lead.uid ? ' · signed in' : ' · not signed in'}.</p>`,
        },
      }),
    });
    return true;
  } catch (e) { return false; }   // the lead is already saved; email is a courtesy
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase Admin not configured' });

  const { name, email, size, message } = req.body || {};
  const cleanEmail = s(email, 200).toLowerCase();
  if (!isEmail(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!SIZES.has(size)) return res.status(400).json({ error: 'Choose an organisation size.' });

  // A signed-in caller is identified for real; an anonymous marketing-site visitor
  // just gets the form fields taken at face value, same as any contact form.
  let uid = null;
  const tok = tokenFrom(req);
  if (tok) { try { const who = await verifyToken(tok); uid = who && who.uid ? who.uid : null; } catch (e) {} }

  // Two independent ceilings: no single flooded email, and no flooded IP re-rolling
  // addresses — this form has no CAPTCHA, so both need to fail before it's ignored.
  const ip = clientIp(req);
  const [byEmail, byIp] = await Promise.all([
    rateLimit(db, 'entlead_e_' + cleanEmail.replace(/[^a-z0-9]/gi, '_'), 3, 86400000),
    rateLimit(db, 'entlead_ip_' + ip, 10, 3600000),
  ]);
  if (!byEmail.allowed || !byIp.allowed) {
    return res.status(429).json({ error: "We've already got a message from you — we'll be in touch. Email help@pollslide.com if it's urgent." });
  }
  sweepRateLimits(db);

  const lead = {
    name: s(name, 120) || null,
    email: cleanEmail,
    size,
    message: s(message, 2000) || null,
    uid,
    origin: (origin || 'unknown').replace(/^https?:\/\//, ''),
    at: Date.now(),
    contacted: false,
  };

  const id = 'lead_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try {
    await db.ref('admin/enterprise_leads/' + id).set(lead);
  } catch (e) {
    return res.status(500).json({ error: 'Could not save your request — try again, or email help@pollslide.com directly.' });
  }

  const emailed = await notifyOwner(lead);
  return res.status(200).json({ ok: true, id, emailed });
};
