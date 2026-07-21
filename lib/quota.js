// PollSlide — server-side Polly AI quota (tamper-proof).
//
// The usage counter (users/<uid>/aiUsedThisMonth + aiQuotaMonth) is written ONLY here
// via the Firebase Admin SDK. Clients are locked out by DB rules (.validate immutability),
// so a user can't reset their own count. Monthly reset is by SERVER time. Admin changes go
// through api/admin-quota.js. Upgrading changes the user's `tier` (a different field), which
// raises the limit — the counter itself is never client-writable.
//
// Requires (already set for other endpoints): FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL.

const admin = require('firebase-admin');

const AI_LIMITS   = { free: 5, pro: 20, team_small: 100, team_large: 300 };
const ADMIN_EMAILS = ['help@pollslide.com'];

function configured() { return !!process.env.FIREBASE_PRIVATE_KEY; }
function getApp() {
  if (admin.apps.length) return admin.apps[0];
  const pk = process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : '';
  if (!pk) throw new Error('FIREBASE_PRIVATE_KEY not set');
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  pk,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}
function normalizeTier(t) { if (t === 'team') return 'team_small'; if (t === 'white') return 'team_large'; return AI_LIMITS[t] != null ? t : 'free'; }
function monthKey() { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1); }
function tokenFrom(req) { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : ((req.body && req.body.idToken) || null); }
async function verifyToken(idToken) { const dec = await admin.auth(getApp()).verifyIdToken(idToken); return { uid: dec.uid, email: (dec.email || '').toLowerCase() }; }

// Verify the caller + check their monthly limit. Throws { code, error, overLimit } on
// invalid/over-limit. Returns { uid, ref, month } when allowed, or { skipped:true } if the
// Admin SDK isn't configured (so a misconfig never hard-blocks generation).
async function checkQuota(req) {
  if (!configured()) return { skipped: true };
  const tok = tokenFrom(req);
  if (!tok) throw { code: 401, error: 'Please sign in to use Polly.' };
  let who;
  try { who = await verifyToken(tok); } catch (e) { throw { code: 401, error: 'Your session expired — sign in again.' }; }
  const ref = admin.database(getApp()).ref('users/' + who.uid);
  const v   = (await ref.get()).val() || {};
  const tier  = normalizeTier(v.tier || 'free');
  const limit = AI_LIMITS[tier] != null ? AI_LIMITS[tier] : 5;
  const month = monthKey();
  const used  = (v.aiQuotaMonth === month) ? (v.aiUsedThisMonth || 0) : 0;
  // Two pools: the monthly allowance (resets each month) and purchased CREDITS
  // (bought in packs, never reset — they carry over month to month). Rule: ALWAYS
  // spend the monthly allowance first; only dip into credits once the month's is gone.
  const monthlyLeft = (limit < 0) ? Infinity : Math.max(0, limit - used);   // limit<0 = unlimited
  const credits     = Math.max(0, Math.floor(v.aiCredits || 0));
  if (monthlyLeft <= 0 && credits <= 0) {
    throw { code: 429, error: `You've used all ${limit} monthly Polly generations and have no credits left.`, overLimit: true, limit, used, credits, tier };
  }
  return { uid: who.uid, ref, month, monthlyLeft, credits };
}

// Count ONE successful generation (call only after the generation succeeds).
// Spends the monthly allowance first, then draws down a purchased credit.
async function consumeQuota(q) {
  if (!q || !q.ref) return;
  const month = monthKey();
  if (q.monthlyLeft === undefined || q.monthlyLeft > 0) {
    const s = await q.ref.child('aiQuotaMonth').get();
    if (s.val() !== month) await q.ref.update({ aiQuotaMonth: month, aiUsedThisMonth: 1 });
    else                   await q.ref.child('aiUsedThisMonth').transaction(n => (n || 0) + 1);
  } else {
    // Monthly allowance exhausted → decrement one purchased credit (floor at 0).
    await q.ref.child('aiCredits').transaction(n => Math.max(0, Math.floor(n || 0) - 1));
  }
}

module.exports = { checkQuota, consumeQuota, verifyToken, tokenFrom, getApp, normalizeTier, monthKey, configured, AI_LIMITS, ADMIN_EMAILS };
