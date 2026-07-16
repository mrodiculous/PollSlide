// PollSlide — automated compliance sweep (worldwide marketing & sale readiness).
//
// The self-audit half of the compliance automation ("legal-watch" is the other
// half — it watches EXTERNAL pages: vendors + laws). This sweep verifies OUR OWN
// side stays compliant: that every legally required public page is live and still
// contains its required sections, that the consent/re-consent machinery is armed,
// and that the external watcher itself is running. It never changes anything —
// it reports, logs a paper trail, and emails the founder on failures.
//
// Runs monthly via Vercel cron AND on demand from Admin → Legal ("Run sweep now").
// Auth: Authorization: Bearer <CRON_SECRET>  (cron)
//   or  Authorization: Bearer <admin Firebase idToken>  (admin panel)
//
// Result shape (stored at admin/compliance/last, log at admin/compliance_log/<ts>):
//   { ranAt, by, totals:{pass,warn,fail,info}, checks:[{id,area,label,status,detail,fix}] }

const admin = require('firebase-admin');
const { getApp, verifyToken, tokenFrom, ADMIN_EMAILS } = require('../lib/quota');

const SITE = 'https://pollslide.com';
const APP  = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';

async function fetchText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'PollSlide-ComplianceSweep/1.0' }, redirect: 'follow', signal: ctl.signal });
    const text = r.ok ? await r.text() : '';
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: '', err: e.message };
  } finally { clearTimeout(t); }
}

// One public page: must be reachable and contain every marker string.
// Markers are the load-bearing legal sections — if an edit accidentally drops
// one, the sweep fails and says exactly which promise went missing.
async function pageCheck(id, area, label, url, markers, fix) {
  const r = await fetchText(url);
  if (!r.ok) return { id, area, label, status: 'fail', detail: `${url} unreachable (HTTP ${r.status}${r.err ? ' — ' + r.err : ''})`, fix };
  const missing = (markers || []).filter(m => !r.text.toLowerCase().includes(m.toLowerCase()));
  if (missing.length) return { id, area, label, status: 'fail', detail: `${url} is live but missing required content: "${missing.join('", "')}"`, fix };
  return { id, area, label, status: 'pass', detail: `${url} live, all required sections present` };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', APP);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Auth: Vercel cron secret OR signed-in site admin ──
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

  const checks = [];

  // ── 1. Required public legal pages + their load-bearing sections ──────────
  const pages = await Promise.all([
    pageCheck('terms', 'Legal pages', 'Terms of Service (incl. EU withdrawal, minors, notice-and-action)', SITE + '/terms',
      ['money-back guarantee', 'right of withdrawal', 'Audience participants and minors', 'Reporting content'],
      'Restore the missing section in terms.html (website repo) and redeploy.'),
    pageCheck('privacy', 'Legal pages', "Privacy Policy (GDPR + CCPA + children + participants)", SITE + '/privacy',
      ['GDPR', 'CCPA', "Children's privacy", 'Audience participants'],
      'Restore the missing section in privacy.html (website repo) and redeploy.'),
    pageCheck('cookies', 'Legal pages', 'Cookie Policy', SITE + '/cookies',
      ['Strictly necessary'],
      'Restore cookies.html (website repo) and redeploy.'),
    pageCheck('trust', 'Legal pages', 'Trust & Safety (UGC safeguards + reporting channel)', SITE + '/trust-safety',
      ['Report', 'help@pollslide.com'],
      'Restore trust-safety.html (website repo) and redeploy.'),
    pageCheck('a11y', 'Accessibility (EAA)', 'Accessibility Statement (WCAG 2.1 AA / EN 301 549)', SITE + '/accessibility',
      ['WCAG', 'EN 301 549', 'help@pollslide.com'],
      'Restore accessibility.html (website repo) and redeploy. Required for EU marketing under the European Accessibility Act.'),
    pageCheck('join', 'Participant access', 'No-camera join path (pollslide.com/join)', SITE + '/join', [],
      'join.html redirect is down — laptop/desktop participants cannot join.'),
    pageCheck('answer', 'Participant access', 'Participant answer page', APP + '/answer', [],
      'app answer page unreachable — participants cannot vote at all.'),
  ]);
  checks.push(...pages);

  // Cookie consent banner still wired into the homepage?
  const home = await fetchText(SITE + '/');
  if (!home.ok) {
    checks.push({ id: 'consent', area: 'Privacy consent', label: 'Cookie consent banner on pollslide.com', status: 'fail', detail: 'Homepage unreachable', fix: 'Check the website deploy on Vercel.' });
  } else {
    checks.push({ id: 'consent', area: 'Privacy consent', label: 'Cookie consent banner on pollslide.com',
      status: home.text.includes('consent.js') ? 'pass' : 'fail',
      detail: home.text.includes('consent.js') ? 'consent.js is loaded on the homepage' : 'consent.js is NOT referenced on the homepage — EU visitors get no cookie notice',
      fix: 'Re-add <script src="/consent.js"></script> before </body> in index.html.' });
    // Footer must link the legal pages (EAA statement + terms/privacy discoverability)
    const missingLinks = ['/terms', '/privacy', '/accessibility', '/trust-safety'].filter(h => !home.text.includes('href="' + h + '"'));
    checks.push({ id: 'footer', area: 'Legal pages', label: 'Homepage footer links to all legal pages',
      status: missingLinks.length ? 'fail' : 'pass',
      detail: missingLinks.length ? 'Footer missing links: ' + missingLinks.join(', ') : 'Terms, Privacy, Accessibility, Trust & Safety all linked',
      fix: 'Restore the footer links in index.html.' });
  }

  // ── 2. Policy push / re-consent machinery armed? ──────────────────────────
  try {
    const pol = await db.ref('app_config/policy').get();
    if (pol.exists() && pol.val().version) {
      const v = pol.val();
      checks.push({ id: 'policy', area: 'Re-consent', label: 'Policy version push system', status: 'pass',
        detail: `Live at version ${v.version} (pushed ${v.updatedAt ? new Date(v.updatedAt).toISOString().slice(0, 10) : '?'}) — users below this version get the consent modal.` });
    } else {
      checks.push({ id: 'policy', area: 'Re-consent', label: 'Policy version push system', status: 'info',
        detail: 'No policy version pushed yet — the re-consent modal is dormant (by design until the first push).',
        fix: 'When a legal doc materially changes: Admin → Legal → "Push update & notify all users".' });
    }
  } catch (e) {
    checks.push({ id: 'policy', area: 'Re-consent', label: 'Policy version push system', status: 'fail',
      detail: 'Could not read app_config/policy: ' + e.message, fix: 'Publish database-rules.json (app_config node) via the Firebase console.' });
  }

  // ── 3. Is the external legal/regulation watcher alive? ────────────────────
  try {
    const lw = await db.ref('admin/legal_watch').get();
    if (!lw.exists()) {
      checks.push({ id: 'watch', area: 'Regulation watch', label: 'legal-watch cron (vendors + worldwide laws)', status: 'warn',
        detail: 'legal-watch has never run — no baseline hashes stored.', fix: 'Check the Vercel cron for /api/legal-watch and CRON_SECRET.' });
    } else {
      let newest = 0, count = 0, regCount = 0;
      lw.forEach(s => { const v = s.val() || {}; count++; if (v.kind === 'regulation') regCount++; if (v.checkedAt > newest) newest = v.checkedAt; });
      const days = (Date.now() - newest) / 86400000;
      checks.push({ id: 'watch', area: 'Regulation watch', label: 'legal-watch cron (vendors + worldwide laws)',
        status: days > 10 ? 'warn' : 'pass',
        detail: `${count} sources watched (${regCount} laws/regulations), last run ${days.toFixed(1)} days ago`,
        fix: days > 10 ? 'Cron appears stalled — check Vercel cron logs for /api/legal-watch.' : undefined });
      if (regCount === 0 && count > 0) checks.push({ id: 'watch_reg', area: 'Regulation watch', label: 'Regulation sources baselined', status: 'info',
        detail: 'Regulation sources added but not yet baselined — they hash on the next weekly run.' });
    }
  } catch (e) {
    checks.push({ id: 'watch', area: 'Regulation watch', label: 'legal-watch cron', status: 'warn', detail: 'Could not read admin/legal_watch: ' + e.message });
  }

  // Open, unhandled legal alerts?
  try {
    const al = await db.ref('admin/legal_alerts').orderByChild('createdAt').limitToLast(50).get();
    let open = 0;
    if (al.exists()) al.forEach(s => { if ((s.val() || {}).status === 'open') open++; });
    checks.push({ id: 'alerts', area: 'Regulation watch', label: 'Open legal-change alerts', status: open ? 'warn' : 'pass',
      detail: open ? `${open} open alert${open > 1 ? 's' : ''} awaiting review` : 'No open alerts',
      fix: open ? 'Review them in Admin → Legal → Policy updates (notify users or dismiss).' : undefined });
  } catch (e) { /* non-fatal */ }

  // ── 4. Checkout consumer-protection configuration ─────────────────────────
  checks.push({ id: 'stripe_consent', area: 'Checkout', label: 'Terms-acceptance checkbox at Stripe Checkout',
    status: process.env.STRIPE_COLLECT_CONSENT === '1' ? 'pass' : 'info',
    detail: process.env.STRIPE_COLLECT_CONSENT === '1' ? 'Enabled — Stripe records each buyer\'s Terms acceptance' : 'OFF — buyers are not asked to tick Terms acceptance at checkout',
    fix: process.env.STRIPE_COLLECT_CONSENT === '1' ? undefined : 'Set the Terms URL in Stripe Dashboard → Settings → Business → Public details, then set STRIPE_COLLECT_CONSENT=1 in Vercel env.' });
  checks.push({ id: 'stripe_tax', area: 'Checkout', label: 'VAT/GST collection (Stripe Tax)',
    status: process.env.STRIPE_AUTOMATIC_TAX === '1' ? 'pass' : 'info',
    detail: process.env.STRIPE_AUTOMATIC_TAX === '1' ? 'Enabled — tax calculated and collected automatically' : 'OFF — acceptable at low volume, but EU/UK VAT on digital services technically applies from the first sale',
    fix: process.env.STRIPE_AUTOMATIC_TAX === '1' ? undefined : 'Enable Stripe Tax in the Dashboard, then set STRIPE_AUTOMATIC_TAX=1 in Vercel env.' });
  if (!process.env.CRON_SECRET) checks.push({ id: 'cron_secret', area: 'Automation', label: 'CRON_SECRET', status: 'warn',
    detail: 'CRON_SECRET is not set — cron endpoints are unauthenticated.', fix: 'Set CRON_SECRET in Vercel env.' });

  // ── Totals, persist, notify ────────────────────────────────────────────────
  const totals = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const c of checks) totals[c.status] = (totals[c.status] || 0) + 1;
  const report = { ranAt: Date.now(), by, totals, checks };

  try {
    await db.ref('admin/compliance/last').set(report);
    await db.ref('admin/compliance_log/' + report.ranAt).set({ ranAt: report.ranAt, by, totals });
  } catch (e) { /* report still returned to caller */ }

  if (totals.fail > 0) {
    try {
      const list = checks.filter(c => c.status === 'fail').map(c => `<li><strong>${c.label}</strong>: ${c.detail}<br><em>Fix: ${c.fix || ''}</em></li>`).join('');
      await fetch(APP + '/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
        body: JSON.stringify({
          type: 'notify',
          to: process.env.LEGAL_ALERT_EMAIL || 'help@pollslide.com',
          data: {
            subject: `🚨 Compliance sweep: ${totals.fail} check${totals.fail > 1 ? 's' : ''} FAILING`,
            heading: 'Compliance sweep found problems',
            body: `The automated compliance sweep found failing checks:<ul>${list}</ul>Full report: Admin → Legal → Compliance sweep.`,
          },
        }),
      });
    } catch (e) { /* report is already stored regardless */ }
  }

  return res.status(200).json(report);
};
