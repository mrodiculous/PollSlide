// PollSlide — admin reset of a user's Polly quota (server-side).
// The counter is locked from client writes (DB rules), so even an admin must reset it
// through the Admin SDK here. Verifies the caller is an admin via their Firebase ID token.
//
// POST { uid, action:'reset' }  with header  Authorization: Bearer <admin idToken>

const admin = require('firebase-admin');
const { getApp, verifyToken, monthKey, ADMIN_EMAILS } = require('../lib/quota');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'No auth token' });

  let who;
  try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }
  if (!ADMIN_EMAILS.includes(who.email)) return res.status(403).json({ error: 'Admins only' });

  const { uid, action, amount } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  try {
    const ref = admin.database(getApp()).ref('users/' + uid);

    // Grant Polly credits (spent AFTER the monthly allowance runs out) — the compensation
    // path when a generation was junk or failed. Logged for accountability.
    if (action === 'credit') {
      const n = Math.max(1, Math.min(1000, Math.floor(Number(amount) || 0)));
      const r = await ref.child('aiCredits').transaction(c => Math.max(0, Math.floor(c || 0)) + n);
      const credits = (r && r.snapshot && r.snapshot.val()) || 0;
      await admin.database(getApp()).ref('admin/credit_log/' + uid).push({ t: Date.now(), by: who.email, amount: n, credits }).catch(() => {});
      return res.status(200).json({ ok: true, uid, granted: n, credits });
    }

    // Reset the monthly usage counter to zero (gives back this month's allowance).
    if (action === 'reset' || !action) {
      await ref.update({ aiUsedThisMonth: 0, aiQuotaMonth: monthKey() });
      // keep the admin index mirror in sync (it's read by the dashboard)
      await admin.database(getApp()).ref('admin/users_index/' + uid + '/aiUsedThisMonth').set(0).catch(() => {});
      return res.status(200).json({ ok: true, uid, aiUsedThisMonth: 0 });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
