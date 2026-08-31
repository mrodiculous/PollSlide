/* Tests for the offline answer queue (lib/offline-queue.js).
 *
 * This is the thing standing between bad school wifi and a wrong mark on a child's
 * record, so the tests that matter most are about NOT losing and NOT inventing:
 *
 *   • a queued answer keeps the time the student TAPPED, never the time it arrived
 *   • a retake replaces the pending answer rather than sending both
 *   • giving up is loud, never silent
 *   • storage being full or disabled must not throw — that would take the answer page
 *     down at exactly the moment the student is trying to submit
 *
 * Run: node scripts/tests/offline-queue.test.js
 */
const path = require('path');
const Q = require(path.resolve(__dirname, '../../lib/offline-queue.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const T0 = 1_700_000_000_000;
const item = (over) => Object.assign({
  session: 'ABC123', qid: 'q0', pid: 'dev-ana',
  record: { name: 'Ana R.', answer: '0', isCorrect: true, submittedAt: T0 },
}, over);

console.log('\nAn answer that fails to send is kept, not discarded');
let q = Q.enqueue([], item(), T0);
ok('it is queued',            q.length === 1);
ok('with everything needed to resend it',
   q[0].session === 'ABC123' && q[0].qid === 'q0' && q[0].pid === 'dev-ana' && !!q[0].record);
ok('and is due immediately',  Q.dueItems(q, T0).length === 1);
ok('a malformed item is ignored rather than queued broken',
   Q.enqueue([], { session: 'X' }, T0).length === 0);
ok('null is safe',            Q.enqueue(null, item(), T0).length === 1);

console.log('\nThe student is not punished for the network');
const rec = Q.recordFor(q[0], T0 + 40_000);
ok('the ORIGINAL tap time survives',   rec.submittedAt === T0);
ok('the arrival time is recorded separately', rec.arrivedAt === T0 + 40_000);
ok('and how long it was stuck',        rec.queuedMs === 40_000);
ok('it is flagged as having gone through the queue', rec.offline === true);
ok('a normal round trip is NOT flagged offline — that would cry wolf on every answer',
   Q.recordFor(q[0], T0 + 300).offline === undefined);
ok('…and carries no queuedMs either',  Q.recordFor(q[0], T0 + 300).queuedMs === undefined);
ok('the answer itself is untouched',   rec.answer === '0' && rec.isCorrect === true);

console.log('\nA retake replaces the pending answer, never doubles it');
let q2 = Q.enqueue(q, item({ record: { name: 'Ana R.', answer: '1', submittedAt: T0 + 5000 } }), T0 + 5000);
ok('still one entry for that question', q2.length === 1);
ok('and it is the newer answer',        q2[0].record.answer === '1');
ok('a DIFFERENT question is its own entry',
   Q.enqueue(q2, item({ qid: 'q1' }), T0).length === 2);
ok('a different person is its own entry too',
   Q.enqueue(q2, item({ pid: 'dev-ben' }), T0).length === 2);

console.log('\nRetries back off, and do not stampede the access point');
let q3 = Q.markFailed(q, q[0].id, T0, 0);
ok('a failure schedules a retry',   q3[0].nextAt > T0);
ok('and counts the attempt',        q3[0].attempts === 1);
ok('it is not due before then',     Q.dueItems(q3, T0 + 100).length === 0);
ok('and is due after',              Q.dueItems(q3, q3[0].nextAt + 1).length === 1);
const delays = [0, 1, 2, 3, 4, 8].map(a => Q.nextDelay(a, 0));
ok('each wait is longer than the last', delays.every((d, i) => i === 0 || d >= delays[i - 1]), delays);
ok('but capped, so it never waits forever', Q.nextDelay(30, 0) <= 60000 * 1.3);
ok('jitter spreads simultaneous retries apart — thirty phones do not fire in lockstep',
   new Set([0.1, 0.4, 0.9].map(r => Q.nextDelay(3, r))).size === 3);
ok('a successful send removes it',  Q.markSent(q3, q[0].id).length === 0);
ok('removing something absent is harmless', Q.markSent(q3, 'nope').length === 1);

console.log('\nGiving up is loud, never silent');
let tired = q.slice();
for (let i = 0; i < Q.MAX_ATTEMPTS; i++) tired = Q.markFailed(tired, q[0].id, T0, 0);
ok('after enough attempts it is reported as expired', Q.expired(tired, T0).length === 1);
ok('an old one expires on age even with few attempts',
   Q.expired(Q.enqueue([], item(), T0), T0 + Q.GIVE_UP_MS + 1).length === 1);
ok('a healthy one is not expired',   Q.expired(q, T0 + 1000).length === 0);
ok('expired items are only removed when explicitly dropped',
   Q.drop(tired, Q.expired(tired, T0).map(x => x.id)).length === 0);
ok('…so nothing disappears without the caller deciding to',
   Q.expired(tired, T0).length === 1 && tired.length === 1);

console.log('\nThe queue survives the page being closed');
const store = (() => { let v = {}; return {
  getItem: k => (k in v ? v[k] : null), setItem: (k, x) => { v[k] = String(x); },
  removeItem: k => { delete v[k]; }, _raw: () => v }; })();
ok('saving works',              Q.save(q, store) === true);
ok('and it comes back intact',  Q.load(store).length === 1 && Q.load(store)[0].qid === 'q0');
ok('the tap time survives the round trip', Q.load(store)[0].record.submittedAt === T0);

console.log('\nStorage failing must never take the answer page down');
const full = { getItem: () => { throw new Error('SecurityError'); },
               setItem: () => { throw new Error('QuotaExceededError'); } };
ok('a throwing getItem yields an empty queue, not an exception', Q.load(full).length === 0);
ok('a throwing setItem reports false, not an exception',          Q.save(q, full) === false);
const corrupt = { getItem: () => 'not json at all', setItem: () => {} };
ok('corrupt stored data yields an empty queue', Q.load(corrupt).length === 0);
const wrongShape = { getItem: () => '{"a":1}', setItem: () => {} };
ok('a non-array yields an empty queue',         Q.load(wrongShape).length === 0);
const partial = { getItem: () => '[{"id":"x"},null,{"no":"id"}]', setItem: () => {} };
ok('entries without an id are filtered out',    Q.load(partial).length === 1);

console.log('\nIt cannot grow without bound');
let big = [];
for (let i = 0; i < Q.MAX_ITEMS + 20; i++) big = Q.enqueue(big, item({ qid: 'q' + i }), T0 + i);
ok('capped at the maximum',        big.length === Q.MAX_ITEMS);
ok('and it is the OLDEST that is dropped', big[big.length - 1].qid === 'q' + (Q.MAX_ITEMS + 19));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
