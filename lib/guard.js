// PollSlide — guards for endpoints that must stay PUBLIC but cost money to run.
// ---------------------------------------------------------------------------
// /api/translate cannot require a login: the audience answering a poll is anonymous
// by design. But it reaches an LLM and falls back to OpenAI, so an open, unmetered
// endpoint is a direct line to the company card. Verified 2026-08-17 that an
// unauthenticated stranger could call it and consume AI compute.
//
// Two cheap guards, in order of strength:
//   1. sessionExists()  — the request must name a REAL session code. A stranger with
//      no code can't fabricate one, which removes drive-by abuse entirely.
//   2. rateLimit()      — even a legitimate code can't be hammered. Fixed window,
//      stored in RTDB so it holds across serverless instances (in-memory counters are
//      useless on Vercel, where every request may be a new lambda).
//
// Both FAIL OPEN on infrastructure errors: a wobble in the rate-limit store must never
// stop a real audience from answering. We accept a little abuse risk over breaking a
// live session in front of a room.
// ---------------------------------------------------------------------------

/**
 * Does this session code actually exist? Cheap shallow read.
 * @returns {Promise<boolean>} false ONLY when we positively know it doesn't exist.
 */
async function sessionExists(db, code) {
  const clean = String(code || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!clean) return false;
  try {
    const snap = await db.ref(`quiz_builder/${clean}/questions`).limitToFirst(1).get();
    return snap.exists();
  } catch (e) {
    return true;   // fail open — never block a real session on a read hiccup
  }
}

/**
 * Fixed-window rate limit shared across serverless instances.
 * @param {string} key     what to limit on (session code, ip, uid…)
 * @param {number} max     allowed calls per window
 * @param {number} windowMs
 * @returns {Promise<{allowed:boolean, count:number, resetIn:number}>}
 */
async function rateLimit(db, key, max = 60, windowMs = 60000) {
  const clean = String(key || 'anon').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
  const bucket = Math.floor(Date.now() / windowMs);
  const ref = db.ref(`admin/ratelimit/${clean}/${bucket}`);
  try {
    const r = await ref.transaction(n => (n || 0) + 1);
    const count = (r && r.snapshot && r.snapshot.val()) || 1;
    return {
      allowed: count <= max,
      count,
      resetIn: windowMs - (Date.now() % windowMs),
    };
  } catch (e) {
    return { allowed: true, count: 0, resetIn: 0 };   // fail open
  }
}

/** Best-effort client IP behind Vercel's proxy. */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || 'unknown';
}

/**
 * Old rate-limit buckets are write-once garbage; drop anything older than an hour so
 * the node can't grow forever. Fire-and-forget, sampled so it isn't run every request.
 */
async function sweepRateLimits(db, windowMs = 60000) {
  if (Math.random() > 0.02) return;                 // ~2% of calls do the cleanup
  try {
    const cutoff = Math.floor((Date.now() - 3600000) / windowMs);
    const snap = await db.ref('admin/ratelimit').get();
    if (!snap.exists()) return;
    const updates = {};
    snap.forEach(keyNode => {
      keyNode.forEach(bucketNode => {
        if (Number(bucketNode.key) < cutoff) updates[`${keyNode.key}/${bucketNode.key}`] = null;
      });
    });
    if (Object.keys(updates).length) await db.ref('admin/ratelimit').update(updates);
  } catch (e) { /* housekeeping only */ }
}

module.exports = { sessionExists, rateLimit, clientIp, sweepRateLimits };
