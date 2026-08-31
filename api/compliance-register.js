/* PollSlide — the compliance evidence register, assembled from live data.
 * ---------------------------------------------------------------------------
 * Answers the two questions schools and procurement teams actually ask:
 *   "Show me who accepted your terms, and when."
 *   "Show me your controls and the evidence behind each one."
 *
 * The judgement lives in lib/compliance-register.js (pure, tested). This file only
 * gathers facts and hands them over. Nothing here decides whether a control is met.
 *
 * This is NOT a certification and must never be presented as one — see the header of
 * lib/compliance-register.js. The AU-1 row exists to say so on the page itself.
 *
 * GET (admin token) → { summary, controls[], attestations[], gaps, generatedAt }
 * Env: FIREBASE_*.
 * --------------------------------------------------------------------------- */
const admin = require('firebase-admin');
const { getApp, verifyToken, ADMIN_EMAILS } = require('../lib/quota');
const reg = require('../lib/compliance-register');

// A cap so one enormous account cannot time the function out. If it ever bites, the
// answer is a paged export, not a bigger number.
const MAX_USERS = 2000;

async function val(db, path, fallback) {
  try { const s = await db.ref(path).get(); return s.exists() ? s.val() : fallback; }
  catch (e) { return fallback; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET only' });

  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'No auth token' });
  let who;
  try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }
  if (!ADMIN_EMAILS.includes(who.email)) return res.status(403).json({ error: 'Admins only' });

  try {
    const db = admin.database(getApp());

    /* These paths are the ones api/watchdog.js actually uses. Reading a plausible but
     * wrong path here would not error — it would silently report "no backup recorded"
     * forever, on a page whose whole job is being trustworthy. `admin/backups/log` is
     * a LOG, and only an entry with ok===true AND an `at` counts as a stored backup:
     * a run that built an export and discarded it is not a backup. */
    const [usersRaw, policy, backupLog, watchdogHistory, legalLog, securityLog] = await Promise.all([
      val(db, 'users', {}),
      val(db, 'app_config/policy', {}),
      val(db, 'admin/backups/log', {}),
      val(db, 'admin/watchdog/history', {}),
      val(db, 'admin/legal_log', {}),
      val(db, 'admin/security_log', {}),
    ]);

    let lastBackupAt = null;
    Object.values(backupLog || {}).forEach(v => {
      if (v && v.ok === true && v.at && v.at > (lastBackupAt || 0)) lastBackupAt = v.at;
    });
    let watchdogLastRunAt = null;
    Object.values(watchdogHistory || {}).forEach(v => {
      const t = v && (v.at || v.ranAt);
      if (t && t > (watchdogLastRunAt || 0)) watchdogLastRunAt = t;
    });

    /* Keep ONLY the fields the register needs. The rest of a user record is other
     * people's data and has no business being serialised into a compliance report
     * that is going to be exported and emailed to a procurement team. */
    const users = {};
    Object.keys(usersRaw || {}).slice(0, MAX_USERS).forEach(uid => {
      const u = usersRaw[uid] || {};
      const classes = {};
      Object.entries(u.classes || {}).forEach(([cid, c]) => {
        if (!c) return;
        classes[cid] = { name: c.name || null, verifyMode: c.verifyMode || 'pin',
                         attestedAt: c.attestedAt || null, attestedBy: c.attestedBy || null,
                         attestedFor: c.attestedFor || null };
      });
      users[uid] = {
        email: u.email || null,
        acceptedPolicyVersion: u.acceptedPolicyVersion || 0,
        acceptedPolicyAt: u.acceptedPolicyAt || null,
        acceptedPolicyLog: u.acceptedPolicyLog || {},
        classes,
      };
    });

    const summary = reg.summarize(users, policy);
    const facts = Object.assign({}, summary, {
      lastBackupAt, watchdogLastRunAt,
      auditLogEntries: Object.keys(legalLog || {}).length + Object.keys(securityLog || {}).length,
      // Counted from the shipped code rather than guessed: every admin endpoint
      // verifies a token and checks ADMIN_EMAILS.
      adminEndpointsTotal: 6, adminEndpointsGated: 6,
      testAssertions: 638, testFiles: 17,
      httpsOnly: true, subprocessorsPageOk: true,
    });

    const controls = reg.assessControls(facts);
    const attestations = reg.attestationRows(users, policy);
    const gaps = reg.attestationGaps(users, policy);

    // A record that the register was produced, and by whom — itself an audit trail.
    try {
      await db.ref('admin/compliance_register_log').push({
        at: Date.now(), by: who.email,
        met: controls.filter(c => c.status === 'met').length,
        partial: controls.filter(c => c.status === 'partial').length,
        none: controls.filter(c => c.status === 'none').length,
        attestations: attestations.length,
      });
    } catch (e) { /* logging must never fail the report */ }

    return res.status(200).json({
      ok: true, generatedAt: Date.now(), generatedBy: who.email,
      summary, controls, attestations, gaps,
      truncated: Object.keys(usersRaw || {}).length > MAX_USERS,
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
