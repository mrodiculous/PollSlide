// LoopSlide — support actions for PollSlide staff (admin panel → LoopSlide).
// POST /api/loop-admin  { action, code, ... }   Authorization: Bearer <admin idToken>
//
//   pause   { code, reason }  — take a loop off every screen and phone at once (e.g. something
//                               unsuitable on a public TV). The owner sees why in the Studio
//                               and can't un-pause it; they can still edit or delete it.
//   resume  { code }          — put it back.
//   ban     { code, pid }     — remove a player from that loop's screen (same as the owner's
//   unban   { code, pid }       "Remove" in Players & moderation).
//
// Guard rails: admin only (verified token, ADMIN_EMAILS); every action is logged to
// admin/loop_actions before it is applied; Admin SDK writes (the rules keep owners from
// clearing a pause themselves — database-rules.json loops/$code).
const admin = require('firebase-admin');
const { verifyToken, tokenFrom, getApp, configured, ADMIN_EMAILS } = require('../lib/quota');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!configured()) return res.status(503).json({ error: 'Firebase Admin not configured.' });

  const tok = tokenFrom(req);
  if (!tok) return res.status(401).json({ error: 'Sign in required.' });
  let who;
  try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Session expired — sign in again.' }); }
  if (!who || !ADMIN_EMAILS.includes(String(who.email || '').toLowerCase())) return res.status(403).json({ error: 'Admins only.' });

  const b = req.body || {};
  const action = String(b.action || '');
  const code = String(b.code || '').toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return res.status(400).json({ error: 'Missing loop code.' });
  const pid = String(b.pid || '');
  if ((action === 'ban' || action === 'unban') && !/^p[a-z0-9]{1,20}$/.test(pid)) return res.status(400).json({ error: 'Missing player id.' });
  if (!['pause', 'resume', 'ban', 'unban'].includes(action)) return res.status(400).json({ error: 'Unknown action.' });

  const db = admin.database(getApp());
  const loop = (await db.ref('loops/' + code).get()).val();
  if (!loop) return res.status(404).json({ error: 'No loop with that code.' });

  const reason = String(b.reason || '').replace(/[<>]/g, '').trim().slice(0, 200) || 'Paused by PollSlide support.';
  await db.ref('admin/loop_actions').push({ action, code, pid: pid || null, reason: action === 'pause' ? reason : null,
    ownerUid: loop.ownerUid || null, by: who.email, at: Date.now() });

  if (action === 'pause') await db.ref('loops/' + code + '/suspended').set(reason);
  if (action === 'resume') await db.ref('loops/' + code + '/suspended').remove();
  if (action === 'ban') await db.ref('loops/' + code + '/banned/' + pid).set(true);
  if (action === 'unban') await db.ref('loops/' + code + '/banned/' + pid).remove();
  return res.status(200).json({ ok: true });
};
