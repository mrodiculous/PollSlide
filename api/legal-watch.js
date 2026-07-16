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

// key → { label, url, kind }. Add/remove freely.
//   kind 'ours'       — our own legal pages (a change should match a version bump we made)
//   kind 'vendor'     — subprocessor/vendor policies (review whether our Privacy needs updating)
//   kind 'regulation' — laws & regulator guidance worldwide (EAA, GDPR, DSA, COPPA, consumer
//                       law…). A change here means: review our docs AND our product practices.
//                       Sources are stable reference/consolidated-text pages, not news feeds,
//                       so a hash change usually means the rule or guidance itself moved.
const WATCH = {
  ours_terms:   { kind: 'ours', label: 'PollSlide — Terms',   url: 'https://pollslide.com/terms' },
  ours_privacy: { kind: 'ours', label: 'PollSlide — Privacy', url: 'https://pollslide.com/privacy' },
  ours_cookies: { kind: 'ours', label: 'PollSlide — Cookies', url: 'https://pollslide.com/cookies' },
  ours_trust:   { kind: 'ours', label: 'PollSlide — Trust & Safety', url: 'https://pollslide.com/trust-safety' },
  ours_a11y:    { kind: 'ours', label: 'PollSlide — Accessibility Statement', url: 'https://pollslide.com/accessibility' },
  ours_vpat:    { kind: 'ours', label: 'PollSlide — VPAT / Accessibility Conformance Report', url: 'https://pollslide.com/vpat' },
  ours_dpa:     { kind: 'ours', label: 'PollSlide — Data Processing Agreement', url: 'https://pollslide.com/dpa' },
  ours_subprocessors: { kind: 'ours', label: 'PollSlide — Subprocessor list', url: 'https://pollslide.com/subprocessors' },
  firebase:     { kind: 'vendor', label: 'Firebase (Google) privacy', url: 'https://firebase.google.com/support/privacy' },
  stripe:       { kind: 'vendor', label: 'Stripe privacy',     url: 'https://stripe.com/privacy' },
  vercel:       { kind: 'vendor', label: 'Vercel privacy',     url: 'https://vercel.com/legal/privacy-policy' },
  fal:          { kind: 'vendor', label: 'fal.ai terms',       url: 'https://fal.ai/terms' },
  anthropic:    { kind: 'vendor', label: 'Anthropic privacy',  url: 'https://www.anthropic.com/legal/privacy' },
  openai:       { kind: 'vendor', label: 'OpenAI privacy',     url: 'https://openai.com/policies/privacy-policy/' },
  resend:       { kind: 'vendor', label: 'Resend privacy',     url: 'https://resend.com/legal/privacy-policy' },
  // ── Worldwide rules that govern how PollSlide is marketed & sold ──
  reg_eaa:      { kind: 'regulation', label: 'European Accessibility Act (Directive 2019/882)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019L0882' },
  reg_eaa_ec:   { kind: 'regulation', label: 'EC — European Accessibility Act policy page', url: 'https://ec.europa.eu/social/main.jsp?catId=1202' },
  reg_wcag:     { kind: 'regulation', label: 'WCAG 2.1 (W3C Recommendation)', url: 'https://www.w3.org/TR/WCAG21/' },
  reg_gdpr:     { kind: 'regulation', label: 'GDPR (Regulation 2016/679)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679' },
  reg_dsa:      { kind: 'regulation', label: 'EU Digital Services Act (Regulation 2022/2065)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32022R2065' },
  reg_ai_act:   { kind: 'regulation', label: 'EU Artificial Intelligence Act (Regulation 2024/1689)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689' },
  reg_crd:      { kind: 'regulation', label: 'EU Consumer Rights Directive (2011/83) — 14-day withdrawal', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32011L0083' },
  reg_coppa:    { kind: 'regulation', label: 'US FTC COPPA rule (children under 13)', url: 'https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa' },
  reg_ico_kids: { kind: 'regulation', label: "UK ICO Children's Code (Age Appropriate Design)", url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/' },
  reg_ccpa:     { kind: 'regulation', label: 'California CPPA regulations (CCPA/CPRA)', url: 'https://cppa.ca.gov/regulations/' },
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
    const kind = (WATCH[r.key] && WATCH[r.key].kind) || 'vendor';
    if (prev && prev.hash && prev.hash !== r.hash) {
      changes.push({ key: r.key, label: r.label, url: r.url, kind });
    }
    await db.ref('admin/legal_watch/' + r.key).set({ hash: r.hash, url: r.url, label: r.label, kind, checkedAt: Date.now() });
  }

  if (changes.length) {
    const ts = Date.now();
    await db.ref('admin/legal_alerts/' + ts).set({ createdAt: ts, changes, status: 'open' });
    // Email the founder (best-effort) via the existing Resend endpoint.
    try {
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
      const kindTag = { ours: 'our page', vendor: 'vendor policy', regulation: '⚖️ LAW / REGULATION' };
      const list = changes.map(c => `<li><a href="${c.url}">${c.label}</a> — <em>${kindTag[c.kind] || c.kind}</em></li>`).join('');
      await fetch(APP_URL + '/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
        body: JSON.stringify({
          type: 'notify',
          to: process.env.LEGAL_ALERT_EMAIL || 'help@pollslide.com',
          data: {
            subject: `⚖️ ${changes.length} legal/policy page${changes.length>1?'s':''} changed`,
            heading: 'Policy change detected',
            body: `These watched pages changed since the last check:<ul>${list}</ul>Vendor changes: review whether your Privacy Policy needs updating. Law/regulation changes: review whether your <strong>product practices AND legal docs</strong> need updating, then push a policy update from Admin → Legal if users must be re-notified.`,
          },
        }),
      });
    } catch (e) { /* alert is already logged to Firebase regardless */ }
  }

  return res.status(200).json({ checked: results.length, changed: changes.length, changes, errors });
};
