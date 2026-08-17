// PollSlide — Comp / demo auto-expire sweep
// Vercel Serverless Function, run daily on a Cron (see vercel.json "crons").
//
// Downgrades anything whose free-access period has ended:
//   • Individual comps  — admin/comps/$uid  (e.g. "free Pro until Aug 8")
//   • Team demos        — workspaces/$id/comp (e.g. "Team Small demo until Aug 8")
// Everyone affected reverts to Free. Deleting an expired demo workspace only removes
// the team grouping — each member's own presentations live under users/$uid and are untouched.
//
// It logs to admin/comp_log + admin/incidents and emails the founder. Never throws to a
// non-JSON crash. Comps with no expiresAt (permanent, e.g. a comped family account) are skipped.
//
// Vercel env: CRON_SECRET (cron auth), INTERNAL_API_KEY (email), FIREBASE_*, NEXT_PUBLIC_APP_URL.
const admin = require('firebase-admin');
const { setUserTier } = require('../lib/tier');

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

async function downgradeUser(db, uid, rec) {
  // Audited: the tier_log entry names the comp that expired, so "why did my plan
  // change?" is answerable months later. See lib/tier.js.
  await setUserTier(db, uid, 'free', {
    source: 'comp-sweep', actor: 'cron',
    reason: 'comp expired' + (rec && rec.note ? ' (' + String(rec.note).slice(0, 60) + ')' : ''),
    ref: rec && rec.expiresAt ? 'expiresAt=' + rec.expiresAt : null,
  });
  await db.ref('users/' + uid + '/comp').remove().catch(() => {});
  await db.ref('admin/comps/' + uid).remove().catch(() => {});
}

async function endWorkspace(db, wsId, ws) {
  // Detach EVERY member incl. the owner → Free (a demo has no paying owner), then delete
  // the (content-free) workspace record. User presentations are elsewhere and stay intact.
  for (const uid of Object.keys(ws.members || {})) {
    await db.ref('users/' + uid + '/workspaceId').remove().catch(() => {});
    await setUserTier(db, uid, 'free', {
      source: 'comp-sweep', actor: 'cron',
      reason: 'team demo expired — workspace closed', ref: wsId,
    });
  }
  for (const k of Object.keys(ws.invites || {})) await db.ref('team_invites/' + k).remove().catch(() => {});
  await db.ref('workspaces/' + wsId).remove().catch(() => {});
}

module.exports = async function handler(req, res) {
  // Auth: Vercel cron sends Authorization: Bearer <CRON_SECRET>. Also allow an internal-key
  // call so the admin panel can trigger a manual sweep. If neither secret is set, allow (dev).
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const internalOK = process.env.INTERNAL_API_KEY && req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY;
  if (secret && auth !== 'Bearer ' + secret && !internalOK) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let db;
  try { db = admin.database(getApp()); }
  catch (e) { return res.status(500).json({ error: 'Firebase admin not configured', detail: e.message }); }

  try {
    const now = Date.now();
    const expiredUsers = [], expiredTeams = [];

    // 1) Individual comps.
    const compsSnap = await db.ref('admin/comps').get();
    if (compsSnap.exists()) {
      for (const [uid, rec] of Object.entries(compsSnap.val() || {})) {
        if (rec && rec.expiresAt && Number(rec.expiresAt) <= now) {
          await downgradeUser(db, uid, rec);
          expiredUsers.push({ uid, email: rec.email || '', tier: rec.tier || '' });
        }
      }
    }

    // 2) Team demos.
    const wsSnap = await db.ref('workspaces').get();
    if (wsSnap.exists()) {
      for (const [wsId, ws] of Object.entries(wsSnap.val() || {})) {
        if (ws && ws.comp && ws.comp.expiresAt && Number(ws.comp.expiresAt) <= now) {
          await endWorkspace(db, wsId, ws);
          expiredTeams.push({ wsId, name: ws.name || '', tier: ws.tier || '', members: Object.keys(ws.members || {}).length });
        }
      }
    }

    const total = expiredUsers.length + expiredTeams.length;
    if (total > 0) {
      const ts = now;
      await db.ref('admin/comp_log/' + ts).set({ at: ts, users: expiredUsers, teams: expiredTeams }).catch(() => {});
      await db.ref('admin/incidents/' + ts).set({
        t: ts, comp: 'comps/demos', from: 'active', to: 'expired',
        auto: `Auto-reverted ${expiredUsers.length} comped account(s) and ${expiredTeams.length} team demo(s) to Free (access period ended).`,
      }).catch(() => {});
      try {
        const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
        const uL = expiredUsers.map(u => `<li>${u.email || u.uid} (was ${u.tier})</li>`).join('');
        const tL = expiredTeams.map(t => `<li>${t.name || t.wsId} — ${t.members} member(s), was ${t.tier}</li>`).join('');
        await fetch(APP_URL + '/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
          body: JSON.stringify({
            type: 'notify',
            to: process.env.LEGAL_ALERT_EMAIL || 'help@pollslide.com',
            data: {
              subject: `⏰ ${total} comp/demo${total > 1 ? 's' : ''} expired → reverted to Free`,
              heading: 'Comps expired',
              body: `These free grants reached their end date and were auto-reverted to Free:` +
                (uL ? `<p><b>Accounts:</b></p><ul>${uL}</ul>` : '') +
                (tL ? `<p><b>Team demos:</b></p><ul>${tL}</ul>` : ''),
            },
          }),
        });
      } catch (e) { /* the log in Firebase stands regardless */ }
    }

    return res.status(200).json({ ok: true, checkedAt: now, expiredUsers, expiredTeams });
  } catch (e) {
    return res.status(500).json({ error: 'Sweep failed', detail: String((e && e.message) || e) });
  }
};
