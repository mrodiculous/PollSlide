// PollSlide — Legal / compliance watcher
// Vercel Serverless Function, run on a weekly Cron (see vercel.json "crons").
//
// What it does: fetches your own legal pages AND key vendors' policy pages, hashes
// each, and compares to the last run. When something changes it (a) logs an alert to
// Firebase admin/legal_alerts and (b) emails you. It NEVER edits legal text itself —
// you stay the approver. Pair it with a re-consent banner when you bump a version.
//
// Vercel env:
//   CRON_SECRET         — set this; Vercel sends it as the Authorization header on cron
//   LEGAL_ALERT_EMAIL   — where alerts go (default help@pollslide.com)
//   FIREBASE_* + NEXT_PUBLIC_APP_URL + RESEND_API_KEY (already set for other functions)
const admin = require('firebase-admin');
const crypto = require('crypto');

function getApp() {
  if (admin.apps.length) return admin.apps[0];
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

// key → { label, url }. Add/remove freely.
const WATCH = {
  ours_terms:   { label: 'PollSlide — Terms',   url: 'https://pollslide.com/terms' },
  ours_privacy: { label: 'PollSlide — Privacy', url: 'https://pollslide.com/privacy' },
  ours_cookies: { label: 'PollSlide — Cookies', url: 'https://pollslide.com/cookies' },
  firebase:     { label: 'Firebase (Google) privacy', url: 'https://firebase.google.com/support/privacy' },
  stripe:       { label: 'Stripe privacy',     url: 'https://stripe.com/privacy' },
  vercel:       { label: 'Vercel privacy',     url: 'https://vercel.com/legal/privacy-policy' },
  fal:          { label: 'fal.ai terms',       url: 'https://fal.ai/terms' },
  anthropic:    { label: 'Anthropic privacy',  url: 'https://www.anthropic.com/legal/privacy' },
  openai:       { label: 'OpenAI privacy',     url: 'https://openai.com/policies/privacy-policy/' },
  resend:       { label: 'Resend privacy',     url: 'https://resend.com/legal/privacy-policy' },
};

// Normalize so trivial differences (whitespace, scripts) don't trigger false alerts.
function normalize(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function hashOf(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

async function checkOne(key, label, url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'PollSlide-LegalWatch/1.0' }, redirect: 'follow' });
    if (!r.ok) return { key, label, url, ok: false, note: 'HTTP ' + r.status };
    const text = normalize(await r.text());
    return { key, label, url, ok: true, hash: hashOf(text), len: text.length };
  } catch (e) {
    return { key, label, url, ok: false, note: e.message };
  }
}

module.exports = async function handler(req, res) {
  // Cron auth: Vercel sends Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let db;
  try { db = admin.database(getApp()); }
  catch (e) { return res.status(500).json({ error: 'Firebase admin not configured', detail: e.message }); }

  const results = await Promise.all(Object.entries(WATCH).map(([k, v]) => checkOne(k, v.label, v.url)));

  const changes = [], errors = [];
  for (const r of results) {
    if (!r.ok) { errors.push(r); continue; }
    const prevSnap = await db.ref('admin/legal_watch/' + r.key).get();
    const prev = prevSnap.exists() ? prevSnap.val() : null;
    if (prev && prev.hash && prev.hash !== r.hash) {
      changes.push({ key: r.key, label: r.label, url: r.url });
    }
    await db.ref('admin/legal_watch/' + r.key).set({ hash: r.hash, url: r.url, label: r.label, checkedAt: Date.now() });
  }

  if (changes.length) {
    const ts = Date.now();
    await db.ref('admin/legal_alerts/' + ts).set({ createdAt: ts, changes, status: 'open' });
    // Email the founder (best-effort) via the existing Resend endpoint.
    try {
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
      const list = changes.map(c => `<li><a href="${c.url}">${c.label}</a></li>`).join('');
      await fetch(APP_URL + '/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
        body: JSON.stringify({
          type: 'notify',
          to: process.env.LEGAL_ALERT_EMAIL || 'help@pollslide.com',
          data: {
            subject: `⚖️ ${changes.length} legal/policy page${changes.length>1?'s':''} changed`,
            heading: 'Policy change detected',
            body: `These watched pages changed since the last check — review whether your Terms/Privacy need updating:<ul>${list}</ul>`,
          },
        }),
      });
    } catch (e) { /* alert is already logged to Firebase regardless */ }
  }

  return res.status(200).json({ checked: results.length, changed: changes.length, changes, errors });
};
