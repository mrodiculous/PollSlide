/* PollSlide — proving a student is who they picked.
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * A class roster lets a student pick their name, which fixes identity across
 * devices — but nothing stopped them picking somebody else's. For a graded quiz
 * that makes the whole record untrustworthy.
 *
 * THREE METHODS, chosen per class by the teacher (see lib/roster.js):
 *   pin    Student sets it on first claim. No teacher setup, no personal data. The
 *          weakness is first claim — whoever gets there first owns the name — which
 *          is visible in the roster and clearable in seconds.
 *   code   Teacher issues a code per student and hands it out. Nobody can claim
 *          someone else's name; still no personal data.
 *   email  The same code, delivered by email. Strongest link to a real person, and
 *          the only one that stores personal data — so it is gated behind a recorded
 *          attestation rather than being a quiet dropdown choice.
 *
 * WHY THIS IS A SERVER ENDPOINT
 * Neither the PIN hash nor the issued code can live in quiz_builder — that node is
 * public-read, and a 4-digit PIN behind any client-visible hash is brute-forced in
 * milliseconds. Both live in the teacher's own tree, and only this endpoint
 * (Admin SDK) compares against them. The browser never sees either.
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
const { normCode } = require('../lib/roster');

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
    const secret    = String(req.body?.pin ?? req.body?.code ?? '').trim();
    if (!session || !studentId) return res.status(400).json({ error: 'Missing session or student.' });
    if (!secret) return res.status(400).json({ error: 'Enter your code.' });

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

    const mode = ['pin', 'code', 'email'].includes(meta.verifyMode) ? meta.verifyMode : 'pin';

    /* CODE and EMAIL are both "the teacher issued you something" — the difference is
     * only how it reached the student, so they verify identically. Neither can be
     * self-set: that is exactly the first-claim weakness they exist to remove. */
    if (mode === 'code' || mode === 'email') {
      const expected = normCode(st.code || '');
      if (!expected) return res.status(409).json({ error: 'Your teacher hasn\'t issued your code yet.' });
      if (!sameHash(normCode(secret), expected)) {
        return res.status(401).json({ error: 'That code doesn\'t match. Check it with your teacher.' });
      }
      return res.status(200).json({ ok: true, claimed: false, name: st.name || null });
    }

    // PIN: whoever claims first sets it. Visible and clearable from the roster.
    if (!/^\d{4,8}$/.test(secret)) return res.status(400).json({ error: 'Your PIN should be 4 to 8 digits.' });
    if (!st.pinHash) {
      const salt = crypto.randomBytes(16).toString('hex');
      await ref.update({ pinSalt: salt, pinHash: hashPin(secret, salt), pinSetAt: Date.now() });
      return res.status(200).json({ ok: true, claimed: true, name: st.name || null });
    }
    if (!sameHash(hashPin(secret, st.pinSalt || ''), st.pinHash)) {
      return res.status(401).json({ error: 'That PIN doesn\'t match. Ask your teacher to reset it if you\'ve forgotten.' });
    }
    return res.status(200).json({ ok: true, claimed: false, name: st.name || null });
  } catch (e) {
    return res.status(500).json({ error: 'Could not check that right now.' });
  }
};

module.exports.__test = { hashPin, sameHash };
