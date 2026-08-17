/* PollSlide — client error intake.
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SERVER ENDPOINT AND NOT A DIRECT FIREBASE WRITE:
 *   admin/* is admin-write-only in database-rules.json, so a browser write to
 *   admin/client_errors would be rejected for every real user — the reporting would
 *   look installed and record nothing. Opening that path to public writes would instead
 *   hand anyone an unauthenticated write into the admin tree. So the browser POSTs here
 *   and the Admin SDK does the write, with rate limiting in front of it.
 *
 * Bonus: because the browser side no longer needs the Firebase SDK, an error that
 * happens *because* Firebase failed to load still gets reported.
 *
 * Everything is best-effort. This endpoint always answers 204 — a failure to record an
 * error must never turn into a second error on the user's screen.
 * --------------------------------------------------------------------------- */
const admin = require('firebase-admin');
const { rateLimit, clientIp, sweepRateLimits } = require('../lib/guard');

function getAdminDb() {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) return null;
    const app = admin.apps.length ? admin.apps[0] : admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    return admin.database(app);
  } catch (e) { return null; }
}

// Stable RTDB-key-safe id so repeats of the same fault collapse onto one row.
// Computed server-side — the client's idea of the key is never trusted.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const s = (v, n) => String(v == null ? '' : v).slice(0, n);

/* Turn whatever the browser sent into a record we're willing to store, or null to
 * drop it. Split out from the handler so the limits are unit-testable — every field
 * here is attacker-controlled, and "it looked fine when I tried it" is not a bound. */
function normalize(b, ua) {
  if (!b || typeof b !== 'object') return null;
  const kind = s(b.kind, 16) || 'error';
  const message = s(b.message, 300);
  if (!message) return null;
  const source = s(b.source, 120);
  const line = Number.isFinite(+b.line) && b.line !== null && b.line !== '' ? +b.line : null;
  const col  = Number.isFinite(+b.col)  && b.col  !== null && b.col  !== '' ? +b.col  : null;
  return {
    key: fnv1a(kind + '|' + message + '|' + source + '|' + line),
    kind, message, source, line, col,
    stack: b.stack ? s(String(b.stack).split('\n').slice(0, 4).join(' | '), 400) : null,
    page: s(b.page, 60),
    ua: s(ua, 140),
    ver: s(b.ver, 24) || null,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(204).end();

  try {
    const db = getAdminDb();
    if (!db) return res.status(204).end();

    // A broken page can only produce so many distinct errors; anything past this is
    // either a loop we already have a row for, or someone poking the endpoint.
    const rl = await rateLimit(db, 'ce_' + clientIp(req), 40, 60000);
    if (!rl.allowed) return res.status(204).end();

    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }

    const rec = normalize(b, req.headers['user-agent']);
    if (!rec) return res.status(204).end();

    const day = new Date().toISOString().slice(0, 10);
    const { key, ...fields } = rec;

    await db.ref('admin/client_errors/' + day + '/' + key).transaction((cur) => {
      if (cur) {
        cur.count  = (cur.count || 1) + 1;
        cur.lastAt = Date.now();
        return cur;
      }
      return Object.assign({ firstAt: Date.now(), lastAt: Date.now(), count: 1 }, fields);
    });

    sweepRateLimits(db);
  } catch (e) { /* never surface intake failures to the page */ }

  return res.status(204).end();
};

module.exports.normalize = normalize;
