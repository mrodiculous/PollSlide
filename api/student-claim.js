/* PollSlide — proving a student is who they picked.
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * A class roster lets a student pick their name, which fixes identity across
 * devices — but nothing stopped them picking somebody else's. For a graded quiz
 * that makes the whole record untrustworthy.
 *
 * THE APPROACH: a PIN the student sets themselves the first time they claim their
 * name, and must enter every time after.
 *   • No work for the teacher — no codes to print, no emails to collect.
 *   • Stops the realistic attack, which is a classmate tapping the wrong name.
 *   • The teacher can clear a forgotten PIN from their own roster.
 *
 * WHY THIS IS A SERVER ENDPOINT
 * The PIN can never live in quiz_builder — that node is public-read, and a 4-digit
 * PIN behind any client-visible hash is brute-forced in milliseconds. So the hash
 * lives in the teacher's own tree, and only this endpoint (Admin SDK) can compare
 * against it. The browser never sees it.
 *
 * WHAT THIS IS NOT: exam-grade proctoring. A determined student can share a PIN
 * with a friend, and no browser can prevent that. It is proportionate to a
 * classroom — say so plainly rather than implying more.
 *
 * Env: FIREBASE_*.
 * --------------------------------------------------------------------------- */
const crypto = require('crypto');
const admin = require('firebase-admin');
const { rateLimit, clientIp, sweepRateLimits } = require('../lib/guard');

function getDb() {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) return null;
  const app = admin.apps.length ? admin.apps[0] : admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  return admin.database(app);
}

/* scrypt, not a bare SHA: a 4-digit PIN has only 10,000 possibilities, so the only
 * thing standing between a leaked hash and the PIN is how slow each guess is. */
function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
// Constant-time compare — a length-or-content shortcut leaks the answer by timing.
function sameHash(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8'), bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const clean = (v, n) => String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, n);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Not configured' });

  try {
    const session   = clean(req.body?.session, 64);
    const studentId = clean(req.body?.studentId, 64);
    const pin       = String(req.body?.pin || '').trim();
    if (!session || !studentId) return res.status(400).json({ error: 'Missing session or student.' });
    if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'Your PIN should be 4 to 8 digits.' });

    /* Guessing is the whole attack, so it is rate limited two ways: per student
     * (stops hammering one name) and per device (stops working through a class). */
    const perStudent = await rateLimit(db, 'pin_s_' + session + '_' + studentId, 8, 600000);
    const perIp      = await rateLimit(db, 'pin_i_' + clientIp(req), 30, 600000);
    if (!perStudent.allowed || !perIp.allowed) {
      return res.status(429).json({ error: 'Too many tries. Wait a few minutes, or ask your teacher to reset your PIN.' });
    }
    sweepRateLimits(db);

    // The session tells us whose class this is; the roster lives in the teacher's tree.
    const qb = await db.ref(`quiz_builder/${session}`).get();
    const meta = qb.exists() ? (qb.val() || {}) : {};
    if (!meta.ownerUid || !meta.classId) return res.status(404).json({ error: 'This session has no class list.' });

    const ref = db.ref(`users/${meta.ownerUid}/classes/${meta.classId}/students/${studentId}`);
    const snap = await ref.get();
    if (!snap.exists()) return res.status(404).json({ error: 'That name is no longer on the class list.' });
    const st = snap.val() || {};
    if (st.left) return res.status(403).json({ error: 'That name is no longer on the class list.' });

    // First claim: whoever gets here first sets the PIN. Later claims must match.
    if (!st.pinHash) {
      const salt = crypto.randomBytes(16).toString('hex');
      await ref.update({ pinSalt: salt, pinHash: hashPin(pin, salt), pinSetAt: Date.now() });
      return res.status(200).json({ ok: true, claimed: true, name: st.name || null });
    }

    if (!sameHash(hashPin(pin, st.pinSalt || ''), st.pinHash)) {
      return res.status(401).json({ error: 'That PIN doesn\'t match. Ask your teacher to reset it if you\'ve forgotten.' });
    }
    return res.status(200).json({ ok: true, claimed: false, name: st.name || null });
  } catch (e) {
    return res.status(500).json({ error: 'Could not check that right now.' });
  }
};

module.exports.__test = { hashPin, sameHash };
