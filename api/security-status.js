// PollSlide — admin security status + safe auto-fixes.
// Powers the "Security" page in admin.html. Admin-token gated (lib/quota
// ADMIN_EMAILS). Each run:
//   1. CHECKS configuration (env keys the security posture depends on),
//   2. AUTO-FIXES what is safe to fix without a human (orphaned invite
//      indexes, stale rate-limit rows) and reports exactly what it did,
//   3. REPORTS what needs a human (missing env keys, abuse signals),
//   4. LOGS the run to admin/security_log so there's a paper trail.
//
// POST /api/security-status   Authorization: Bearer <admin idToken>

const admin = require('firebase-admin');
const { getApp, verifyToken, tokenFrom, ADMIN_EMAILS } = require('../lib/quota');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const tok = tokenFrom(req);
  if (!tok) return res.status(401).json({ error: 'No auth token' });
  let who;
  try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }
  if (!ADMIN_EMAILS.includes(who.email)) return res.status(403).json({ error: 'Admins only' });

  const db = admin.database(getApp());
  const issues = [];  // { sev: 'high'|'warn'|'info', what, fix }  ← needs a human
  const fixed  = [];  // strings — what this run repaired automatically

  // ── 1. Configuration checks ────────────────────────────────────────────────
  const env = k => !!process.env[k];
  if (!env('INTERNAL_API_KEY')) issues.push({ sev: 'high', what: 'INTERNAL_API_KEY is not set — internal emails (receipts, invites, alerts) are silently skipped and /api/send-email has no server-to-server path.', fix: 'Follow SETUP-INTERNAL-API-KEY.md (repo root), then redeploy.' });
  if (!env('RESEND_API_KEY')) issues.push({ sev: 'high', what: 'RESEND_API_KEY is not set — no transactional email can send.', fix: 'Add the Resend API key in Vercel → Settings → Environment Variables.' });
  if (env('STRIPE_SECRET_KEY') && !env('STRIPE_WEBHOOK_SECRET')) issues.push({ sev: 'high', what: 'Stripe key present but STRIPE_WEBHOOK_SECRET missing — webhooks can be spoofed / will be rejected.', fix: 'Copy the signing secret from Stripe → Webhooks into Vercel env.' });
  if (!env('STRIPE_SECRET_KEY')) issues.push({ sev: 'info', what: 'Stripe not configured (expected until live mode).', fix: 'See stripe go-live checklist.' });
  if (!env('OPENAI_API_KEY')) issues.push({ sev: 'warn', what: 'OPENAI_API_KEY missing — no cloud fallback if the local Mac is down.', fix: 'Add the OpenAI key in Vercel env.' });
  if (!env('LOCAL_LLM_URL')) issues.push({ sev: 'info', what: 'LOCAL_LLM_URL not set — Polly always uses the cloud provider.', fix: 'Optional: point at the Mac tunnel for local-first inference.' });

  // ── 2. Safe auto-fixes ─────────────────────────────────────────────────────
  // Orphaned invite indexes: team_invites entries whose workspace is gone let
  // a future signup join a dead workspace — remove them.
  try {
    const [invSnap, wsSnap] = await Promise.all([db.ref('team_invites').get(), db.ref('workspaces').get()]);
    const wsIds = new Set(); if (wsSnap.exists()) wsSnap.forEach(s => { wsIds.add(s.key); });
    const gone = [];
    if (invSnap.exists()) invSnap.forEach(s => { const v = s.val(); if (!v || !v.wsId || !wsIds.has(v.wsId)) gone.push(s.key); });
    for (const k of gone) await db.ref('team_invites/' + k).remove();
    if (gone.length) fixed.push(`Removed ${gone.length} orphaned team invite${gone.length > 1 ? 's' : ''} pointing at deleted workspaces.`);
  } catch (e) { issues.push({ sev: 'warn', what: 'Could not scan team_invites: ' + e.message, fix: 'Check Firebase Admin credentials.' }); }

  // Stale email rate-limit rows: counters from past hours are dead weight —
  // prune them; also surface anyone who hit the cap THIS hour (abuse signal).
  try {
    const hour = Math.floor(Date.now() / 3600000);
    const snap = await db.ref('email_quota').get();
    let pruned = 0; const capped = [];
    if (snap.exists()) {
      const updates = {};
      snap.forEach(s => { const v = s.val() || {}; if (v.h !== hour) { updates[s.key] = null; pruned++; } else if (v.n >= 5) capped.push(s.key); });
      if (Object.keys(updates).length) await db.ref('email_quota').update(updates);
    }
    if (pruned) fixed.push(`Pruned ${pruned} stale email rate-limit row${pruned > 1 ? 's' : ''}.`);
    if (capped.length) issues.push({ sev: 'warn', what: `${capped.length} account(s) hit the hourly email cap this hour: ${capped.join(', ')}`, fix: 'Check these uids in the Users page — could be abuse or a stuck client.' });
  } catch (e) { /* table may simply not exist yet */ }

  // ── 3. Informational posture ───────────────────────────────────────────────
  try {
    const alerts = await db.ref('admin/legal_alerts').get();
    let open = 0; if (alerts.exists()) alerts.forEach(s => { if ((s.val() || {}).status === 'open') open++; });
    if (open) issues.push({ sev: 'warn', what: `${open} open legal/policy-watch alert${open > 1 ? 's' : ''}.`, fix: 'Review in Legal actions page.' });
  } catch (e) { }

  // ── 4. Log the run ─────────────────────────────────────────────────────────
  const report = { t: Date.now(), by: who.email, issues, fixed, ok: !issues.some(i => i.sev === 'high') };
  try { await db.ref('admin/security_log/' + String(report.t).padStart(15, '0')).set({ t: report.t, by: who.email, high: issues.filter(i => i.sev === 'high').length, warn: issues.filter(i => i.sev === 'warn').length, fixed: fixed.length ? fixed : null }); } catch (e) { }

  return res.status(200).json(report);
};
