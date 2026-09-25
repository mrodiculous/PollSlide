// Admin "view as this user" — support tooling to reproduce a user's problem.
// POST /api/masquerade  { uid }   Authorization: Bearer <admin Firebase idToken>
//
// Returns a short-lived Firebase custom token for the target account. Guard rails:
//   • the CALLER must be an admin (verified token, email in ADMIN_EMAILS)
//   • an admin account can never be impersonated
//   • every use is written to admin/masquerade_log (who, whom, when) before the token
//     is returned — no log, no token
//   • the token is carried to the new window by postMessage, never in a URL
//   • the claim `masqueradedBy` rides on the session so it is identifiable in rules/logs
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
  if (!who || !ADMIN_EMAILS.includes(who.email)) return res.status(403).json({ error: 'Admins only.' });

  const { uid } = req.body || {};   // the TARGET, not a claim about the caller
  if (typeof uid !== 'string' || !uid || uid.length > 128) return res.status(400).json({ error: 'Missing user id.' });

  try {
    const app = getApp();
    const target = await admin.auth(app).getUser(uid);
    if (target.email && ADMIN_EMAILS.includes(String(target.email).toLowerCase()))
      return res.status(403).json({ error: 'Admin accounts cannot be impersonated.' });
    await admin.database(app).ref('admin/masquerade_log').push({
      by: who.email, byUid: who.uid, uid, email: target.email || null, at: Date.now(),
      ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
    });
    const token = await admin.auth(app).createCustomToken(uid, { masqueradedBy: who.email });
    return res.status(200).json({ token, email: target.email || uid });
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') return res.status(404).json({ error: 'No such user.' });
    return res.status(500).json({ error: 'Could not start the session.' });
  }
};
