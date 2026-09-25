// LoopSlide retention sweep — daily cron. Data minimisation (GDPR art. 5(1)(c)/(e) and
// equivalents): players are told their answers are "kept only while this leaderboard runs,
// then deleted", and this is what makes that true.
//
//   • loop_answers — only needed for the reveal and the round board of the CURRENT loop
//     cycle. Every period except the current one is deleted; inside the current period,
//     answers from cycles older than the previous one are deleted too (this is what keeps
//     an all-time board from accumulating every answer ever given).
//   • loop_scores  — every period except the current one is deleted (the board has reset).
//   • anything left behind by a loop that no longer exists is deleted.
//
// Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>. This job DELETES data, so
// unlike the read-only sweeps it fails CLOSED — no secret configured, no run.
const admin = require('firebase-admin');
const { getApp, configured } = require('../lib/quota');
const E = require('../loop-engine');

async function shallowKeys(app, path) {
  // Keys only — never download a busy venue's whole history just to tidy it.
  const token = (await app.options.credential.getAccessToken()).access_token;
  const base = String(process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const r = await fetch(`${base}/${path}.json?shallow=true&access_token=${encodeURIComponent(token)}`);
  if (!r.ok) throw new Error('shallow read failed: ' + r.status);
  return Object.keys((await r.json()) || {});
}

module.exports = async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || (req.headers.authorization || '') !== 'Bearer ' + secret) return res.status(401).json({ error: 'Unauthorized' });
  if (!configured()) return res.status(503).json({ error: 'Firebase Admin not configured' });

  const app = getApp(), db = admin.database(app), now = Date.now();
  const report = { loops: 0, periodsDeleted: 0, cyclesPruned: 0, orphans: 0 };
  try {
    const loops = (await db.ref('loops').get()).val() || {};
    for (const node of ['loop_answers', 'loop_scores']) {
      const codes = await shallowKeys(app, node);
      for (const code of codes) {
        const def = loops[code] && loops[code].def;
        if (!def) { await db.ref(`${node}/${code}`).remove(); report.orphans++; continue; }
        const L = E.normalizeLoop(def);
        if (!L.epoch) continue;
        const current = E.periodKey(L, now);
        const periods = await shallowKeys(app, `${node}/${code}`);
        const upd = {};
        periods.filter(p => p !== current).forEach(p => { upd[`${node}/${code}/${p}`] = null; report.periodsDeleted++; });
        if (node === 'loop_answers' && periods.includes(current)) {
          const pos = E.positionAt(L, now);
          const keep = pos ? pos.cycle - 1 : 0;
          (await shallowKeys(app, `${node}/${code}/${current}`)).forEach(k => {
            const cyc = parseInt(String(k).split('_')[0], 10);
            if (Number.isFinite(cyc) && cyc < keep) { upd[`${node}/${code}/${current}/${k}`] = null; report.cyclesPruned++; }
          });
        }
        if (Object.keys(upd).length) await db.ref().update(upd);
      }
    }
    report.loops = Object.keys(loops).length;
    return res.status(200).json(Object.assign({ ok: true }, report));
  } catch (e) {
    return res.status(500).json({ error: 'sweep failed', detail: String(e && e.message || e).slice(0, 200) });
  }
};
