/* Tests for api/student-claim.js — the endpoint that decides whether the person
 * holding this phone is really the student whose name they tapped.
 *
 * This loads the REAL handler and stubs only what sits outside it (firebase-admin,
 * the rate limiter). A test that reimplements the comparison logic would pass
 * whatever the endpoint did; this one fails when the endpoint is wrong.
 *
 * The properties worth protecting, in order of how much damage getting them wrong does:
 *   1. A student cannot claim another student's name.
 *   2. The PIN/code never leaves the teacher's tree — nothing readable proves it.
 *   3. A student who left the class cannot answer.
 *   4. Guessing is rate limited before anything else happens.
 *
 * Run: node scripts/tests/student-claim.test.js
 */
const path = require('path');
const Module = require('module');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

/* ---- the world the endpoint runs in ------------------------------------- */
let DB, rateAllowed = true, rateCalls = [];

const dbRef = (p) => ({
  get: async () => {
    const v = p.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), DB);
    return { exists: () => v !== undefined && v !== null, val: () => v ?? null };
  },
  update: async (o) => {
    const ks = p.split('/').filter(Boolean);
    let cur = DB;
    ks.forEach(k => { cur[k] = cur[k] || {}; cur = cur[k]; });
    Object.assign(cur, o);
  },
});

// Stub the modules the handler requires, before it is loaded.
const realResolve = Module._resolveFilename;
const stubs = {
  'firebase-admin': { apps: [{}], initializeApp: () => ({}), credential: { cert: () => ({}) },
                      database: () => ({ ref: dbRef }) },
};
const realLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (stubs[req]) return stubs[req];
  if (/lib[\\/]guard$/.test(req)) {
    return {
      rateLimit: async (_db, key) => { rateCalls.push(key); return { allowed: rateAllowed }; },
      clientIp: () => '203.0.113.7',
      sweepRateLimits: () => {},
    };
  }
  return realLoad.apply(this, arguments);
};

process.env.FIREBASE_PRIVATE_KEY = 'k';
process.env.FIREBASE_CLIENT_EMAIL = 'e';
process.env.FIREBASE_PROJECT_ID = 'p';

const handler = require(path.resolve(__dirname, '../../api/student-claim.js'));
const { normCode, newStudentCode } = require(path.resolve(__dirname, '../../lib/roster.js'));

/* ---- a class, as the presenter actually writes one ---------------------- */
const ANA = 'st_ana', BEN = 'st_ben', GONE = 'st_gone';
const ANA_CODE = newStudentCode();

function reset(verifyMode) {
  DB = {
    quiz_builder: { ABC123: { verifyMode, ownerUid: 'teacher-uid', classId: 'c1',
                              roster: [{ id: ANA, name: 'Ana R.' }, { id: BEN, name: 'Ben C.' }] } },
    users: { 'teacher-uid': { classes: { c1: { students: {
      [ANA]:  { name: 'Ana Ruiz', code: ANA_CODE },
      [BEN]:  { name: 'Ben Cole', code: newStudentCode() },
      [GONE]: { name: 'Cara Diaz', code: newStudentCode(), left: Date.now() },
    } } } } },
  };
  rateAllowed = true; rateCalls = [];
}

async function call(body) {
  let code = 0, payload = null;
  const res = { setHeader() {}, status(c) { code = c; return this; },
                json(p) { payload = p; return this; }, end() { return this; } };
  await handler({ method: 'POST', body, headers: {}, socket: {} }, res);
  return { code, ...payload };
}

const claim = (studentId, pin, session = 'ABC123') => call({ session, studentId, pin });

(async () => {
  /* ---- codes the teacher issued --------------------------------------- */
  console.log('\nIssued codes — nobody can claim a name they weren\'t given');
  reset('code');
  ok('the right code is accepted',        (await claim(ANA, ANA_CODE)).ok === true);
  reset('code');
  ok('a different student\'s code is not', (await claim(ANA, DB.users['teacher-uid'].classes.c1.students[BEN].code)).code === 401);
  reset('code');
  ok('a made-up code is not',              (await claim(ANA, 'XXXXXX')).code === 401);
  reset('code');
  ok('typed with spaces and lowercase still works',
     (await claim(ANA, ' ' + ANA_CODE.toLowerCase().replace(/(...)/, '$1-') + ' ')).ok === true);
  reset('code');
  ok('a student who left the class is refused', (await claim(GONE, 'anything')).code === 403);
  reset('code');
  ok('an unknown student id is refused',        (await claim('st_nobody', 'x')).code === 404);
  reset('code');
  delete DB.users['teacher-uid'].classes.c1.students[ANA].code;
  ok('no code issued yet says so, rather than letting them in',
     (await claim(ANA, 'ABC123')).code === 409);

  /* Email mode is the same secret delivered differently — it must verify the
   * same way. If it ever diverged, the weaker of the two would be the one in use. */
  console.log('\nEmailed codes verify identically to issued ones');
  reset('email');
  ok('right code accepted',  (await claim(ANA, ANA_CODE)).ok === true);
  reset('email');
  ok('wrong code refused',   (await claim(ANA, 'ZZZZZZ')).code === 401);

  /* ---- PINs the student sets ------------------------------------------ */
  console.log('\nPINs — first claim sets it, and it is theirs from then on');
  reset('pin');
  const firstClaim = await claim(ANA, '4821');
  ok('the first claim succeeds and says it claimed', firstClaim.ok && firstClaim.claimed === true);
  ok('a hash and salt were stored', !!DB.users['teacher-uid'].classes.c1.students[ANA].pinHash
                                 && !!DB.users['teacher-uid'].classes.c1.students[ANA].pinSalt);
  ok('the PIN itself was NOT stored',
     JSON.stringify(DB.users['teacher-uid'].classes.c1.students[ANA]).indexOf('4821') === -1);
  ok('the hash is not a bare digest of the PIN — salted, so two students sharing a PIN differ',
     DB.users['teacher-uid'].classes.c1.students[ANA].pinHash !==
     require('crypto').createHash('sha256').update('4821').digest('hex'));
  ok('the same PIN gets back in',          (await claim(ANA, '4821')).ok === true);
  ok('…and is no longer a first claim',    (await claim(ANA, '4821')).claimed === false);
  ok('someone else guessing is refused',   (await claim(ANA, '1111')).code === 401);
  ok('a near miss is refused',             (await claim(ANA, '4822')).code === 401);
  ok('a longer PIN is allowed on first claim',
     (await claim(BEN, '90210')).ok === true);
  reset('pin');
  ok('a 3-digit PIN is rejected as too short',  (await claim(ANA, '123')).code === 400);
  ok('letters in a PIN are rejected',           (await claim(ANA, 'abcd')).code === 400);

  /* Resetting is the teacher's job, not a support ticket — clearing the hash
   * must genuinely hand the name back. */
  console.log('\nA teacher reset really does release the name');
  reset('pin');
  await claim(ANA, '4821');
  delete DB.users['teacher-uid'].classes.c1.students[ANA].pinHash;
  delete DB.users['teacher-uid'].classes.c1.students[ANA].pinSalt;
  const after = await claim(ANA, '7777');
  ok('the next PIN entered becomes the new one', after.ok && after.claimed === true);
  ok('and the old PIN no longer works',          (await claim(ANA, '4821')).code === 401);

  /* ---- refusing to answer ---------------------------------------------- */
  console.log('\nBad requests are refused before any lookup');
  reset('code');
  ok('missing student id',   (await call({ session: 'ABC123' })).code === 400);
  ok('missing session',      (await call({ studentId: ANA, pin: 'X' })).code === 400);
  ok('empty secret',         (await claim(ANA, '   ')).code === 400);
  ok('a session with no class attached',
     (await call({ session: 'NOCLASS', studentId: ANA, pin: 'x' })).code === 404);

  console.log('\nGuessing is rate limited two ways');
  reset('code');
  await claim(ANA, 'XXXXXX');
  ok('per student — hammering one name is capped', rateCalls.some(k => k.includes(ANA)));
  ok('per device — working through the whole class is capped too',
     rateCalls.some(k => k.startsWith('pin_i_')));
  reset('code');
  rateAllowed = false;
  const limited = await claim(ANA, ANA_CODE);
  ok('once limited even the CORRECT code is refused', limited.code === 429, limited);
  ok('…and the message tells them what to do', /teacher|wait/i.test(limited.error || ''));

  console.log('\nThe comparison itself');
  const { hashPin, sameHash } = handler.__test;
  ok('same input, same salt → same hash', hashPin('4821', 's') === hashPin('4821', 's'));
  ok('same input, different salt → different hash', hashPin('4821', 'a') !== hashPin('4821', 'b'));
  ok('sameHash is true for equals',  sameHash('abc', 'abc'));
  ok('sameHash is false for differing lengths', !sameHash('abc', 'abcd'));
  ok('sameHash does not throw on null', sameHash(null, null) === true && !sameHash(null, 'x'));
  ok('normCode is what both sides compare', normCode('bc4-df7 ') === 'BC4DF7');

  console.log(`\n${pass} passed, ${fail} failed\n`);
  Module._load = realLoad; Module._resolveFilename = realResolve;
  process.exit(fail ? 1 : 0);
})();
