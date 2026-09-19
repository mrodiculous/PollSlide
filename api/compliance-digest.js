// PollSlide — compliance digest
// ---------------------------------------------------------------------------
// One page that answers "where do we stand right now", assembled from the three
// places the compliance machinery already writes to:
//
//   admin/legal_watch/*    per-source hashes + checkedAt   (api/legal-watch.js, weekly)
//   admin/legal_alerts/*   changes detected, open/ack'd    (api/legal-watch.js)
//   admin/compliance/last  our-own-pages self-audit        (api/compliance-sweep.js, monthly)
//
// WHAT THIS IS NOT. It reports whether watched pages MOVED and whether our own pages
// still carry their required sections. It cannot tell you whether PollSlide complies
// with any law — that is a legal judgement, not a diff. Nothing here is legal advice,
// and no output of this endpoint should be shown to a buyer as evidence of compliance.
// The same honesty rule that governs lib/compliance-register.js governs this file.
//
// Auth: Authorization: Bearer <CRON_SECRET>        (monthly cron)
//   or  Authorization: Bearer <admin idToken>      (Admin → Legal button)
// Query: ?email=1 forces the digest mail even when nothing needs attention.
const admin = require('firebase-admin');
const { getApp, verifyToken, tokenFrom, ADMIN_EMAILS } = require('../lib/quota');

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';

// A source that has not been checked in this long is treated as stale: the cron is the
// only thing keeping any of this current, and a silently dead cron looks exactly like
// "no laws changed", which is the most dangerous possible false negative here.
const STALE_MS = 1000 * 60 * 60 * 24 * 21; // 21 days (weekly cron, 3 misses)

const KIND_LABEL = {
  ours: 'our page',
  vendor: 'vendor policy',
  regulation: 'law / regulator',
  tracker: 'new-law tracker',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', APP);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let by = null;
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization === 'Bearer ' + secret) {
    by = 'cron';
  } else {
    const tok = tokenFrom(req);
    if (!tok) return res.status(401).json({ error: 'No auth' });
    let who;
    try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }
    if (!ADMIN_EMAILS.includes(who.email)) return res.status(403).json({ error: 'Admins only' });
    by = who.email;
  }

  let db;
  try { db = admin.database(getApp()); }
  catch (e) { return res.status(500).json({ error: 'Firebase admin not configured', detail: e.message }); }

  const now = Date.now();
  const [watchSnap, alertSnap, sweepSnap] = await Promise.all([
    db.ref('admin/legal_watch').get(),
    db.ref('admin/legal_alerts').limitToLast(40).get(),
    db.ref('admin/compliance/last').get(),
  ]);

  // ── 1. Watcher coverage and freshness ────────────────────────────────────
  const watch = watchSnap.exists() ? watchSnap.val() : {};
  const sources = Object.entries(watch).map(([key, v]) => ({
    key,
    label: v.label || key,
    kind: v.kind || 'vendor',
    url: v.url,
    checkedAt: v.checkedAt || 0,
    stale: !v.checkedAt || (now - v.checkedAt) > STALE_MS,
  }));
  const byKind = {};
  for (const s of sources) {
    byKind[s.kind] = byKind[s.kind] || { total: 0, stale: 0 };
    byKind[s.kind].total++;
    if (s.stale) byKind[s.kind].stale++;
  }
  const staleSources = sources.filter(s => s.stale);
  const lastCheck = sources.reduce((m, s) => Math.max(m, s.checkedAt || 0), 0);

  // ── 2. Open alerts, split so trackers never drown the real ones ──────────
  const alertsRaw = alertSnap.exists() ? alertSnap.val() : {};
  const open = Object.entries(alertsRaw)
    .map(([ts, a]) => ({ ts: Number(ts), ...a }))
    .filter(a => a.status !== 'ack' && a.status !== 'closed')
    .sort((a, b) => b.ts - a.ts);

  const flatten = (pred) => open.flatMap(a =>
    (a.changes || []).filter(pred).map(c => ({ ...c, ts: a.ts })));

  const lawChanges     = flatten(c => c.kind === 'regulation');
  const vendorChanges  = flatten(c => c.kind === 'vendor');
  const ourChanges     = flatten(c => c.kind === 'ours');
  const trackerChanges = flatten(c => c.kind === 'tracker');

  // ── 3. Last self-audit of our own pages ──────────────────────────────────
  const sweep = sweepSnap.exists() ? sweepSnap.val() : null;
  const sweepTotals = sweep && sweep.totals ? sweep.totals : null;
  const sweepStale = !sweep || !sweep.ranAt || (now - sweep.ranAt) > (1000 * 60 * 60 * 24 * 45);

  // ── 4. What actually needs a human ───────────────────────────────────────
  const attention = [];
  if (lawChanges.length)    attention.push(`${lawChanges.length} law/regulator page(s) changed — review product practices AND legal docs`);
  if (ourChanges.length)    attention.push(`${ourChanges.length} of our own legal pages changed — confirm it matches a version bump you made`);
  if (vendorChanges.length) attention.push(`${vendorChanges.length} vendor policy change(s) — check whether Privacy/subprocessors need updating`);
  if (staleSources.length)  attention.push(`${staleSources.length} watched source(s) not checked in 21+ days — the cron may be dead`);
  if (sweepStale)           attention.push('the self-audit (compliance-sweep) has not run in 45+ days');
  if (sweepTotals && sweepTotals.fail) attention.push(`${sweepTotals.fail} failing check(s) in the last self-audit`);

  const digest = {
    ranAt: now,
    by,
    coverage: { total: sources.length, byKind },
    lastWatcherCheck: lastCheck || null,
    staleSources: staleSources.map(s => ({ key: s.key, label: s.label, checkedAt: s.checkedAt })),
    open: {
      law: lawChanges, ours: ourChanges, vendor: vendorChanges, tracker: trackerChanges,
    },
    selfAudit: sweep ? { ranAt: sweep.ranAt, totals: sweepTotals, stale: sweepStale } : null,
    attention,
    // Restated in the payload itself, because a JSON blob gets pasted into a ticket or a
    // buyer thread with none of the surrounding context that says what it does not mean.
    disclaimer: 'Monitoring output only. Detects changes to published pages and whether our own pages carry required sections. Not legal advice and not evidence of compliance.',
  };

  await db.ref('admin/compliance/digest').set(digest);

  // ── 5. Mail it when there is something to say ────────────────────────────
  const force = req.query && (req.query.email === '1' || req.query.email === 'true');
  if (attention.length || trackerChanges.length || force) {
    try {
      const li = (arr) => arr.map(c =>
        `<li><a href="${c.url}">${c.label}</a> — <em>${KIND_LABEL[c.kind] || c.kind}</em></li>`).join('');
      const section = (title, arr) => arr.length
        ? `<p><strong>${title}</strong></p><ul>${li(arr)}</ul>` : '';
      const body =
        (attention.length
          ? `<p><strong>Needs a look:</strong></p><ul>${attention.map(a => `<li>${a}</li>`).join('')}</ul>`
          : '<p>Nothing needs attention this period.</p>')
        + section('Law / regulator pages that changed', lawChanges)
        + section('Our own legal pages that changed', ourChanges)
        + section('Vendor policies that changed', vendorChanges)
        + section('New-law trackers that moved (informational)', trackerChanges)
        + `<p>Watching ${sources.length} sources: `
        + Object.entries(byKind).map(([k, v]) => `${v.total} ${KIND_LABEL[k] || k}`).join(', ')
        + `.</p>`
        + `<p style="color:#666;font-size:12px">${digest.disclaimer}</p>`;
      await fetch(APP + '/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
        body: JSON.stringify({
          type: 'notify',
          to: process.env.LEGAL_ALERT_EMAIL || 'help@pollslide.com',
          data: {
            subject: attention.length
              ? `⚖️ Compliance digest — ${attention.length} item${attention.length > 1 ? 's' : ''} need a look`
              : '⚖️ Compliance digest — nothing outstanding',
            heading: 'Compliance digest',
            body,
          },
        }),
      });
    } catch (e) { /* digest is stored regardless */ }
  }

  return res.status(200).json(digest);
};
