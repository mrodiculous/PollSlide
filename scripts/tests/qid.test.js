/* Tests for stable question identity (qid.js).
 *
 * The property that makes this migration safe is exact key compatibility: for a deck
 * that has never had ids, backfilling and then deriving a bucket must produce the
 * SAME string the old index-derived code produced. If that ever stops holding, every
 * historical response silently orphans — so it is asserted directly, not assumed.
 *
 * Run: node scripts/tests/qid.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.resolve(__dirname, '../../qid.js'), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(src, ctx);
const Q = ctx.window.PSQid;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

// Exactly how every call site used to build the key.
const legacyKey = (idx, code) => `q${idx}_stable_${code}`;
const CODE = 'ABC123';

console.log('\nBackward compatibility — the whole basis of the no-migration plan');
{
  const qs = [{ text: 'Q0' }, { text: 'Q1' }, { text: 'Q2' }];
  Q.backfill(qs);
  qs.forEach((q, i) => {
    ok(`question ${i} keeps its historical bucket`,
       Q.bucket(q, i, CODE) === legacyKey(i, CODE),
       { got: Q.bucket(q, i, CODE), legacy: legacyKey(i, CODE) });
  });
}
ok('a question with no id at all still resolves to the legacy key',
   Q.bucket({ text: 'no id' }, 4, CODE) === legacyKey(4, CODE));
ok('a null question is safe', Q.bucket(null, 2, CODE) === legacyKey(2, CODE));

console.log('\nBackfill');
{
  const qs = [{ text: 'a' }, { text: 'b' }];
  ok('reports that it changed something', Q.backfill(qs) === true);
  ok('is idempotent — a second pass changes nothing', Q.backfill(qs) === false);
  const ids = qs.map(q => q.id);
  Q.backfill(qs);
  ok('and does not reassign ids', qs.map(q => q.id).join() === ids.join());
}
ok('an existing id is never overwritten', (() => {
  const qs = [{ text: 'a', id: 'qzCUSTOM' }];
  Q.backfill(qs);
  return qs[0].id === 'qzCUSTOM';
})());
ok('empty and null inputs are safe', Q.backfill([]) === false && Q.backfill(null) === false);
ok('a non-object entry is skipped', (() => { const qs = [null, 'oops', { text: 'ok' }]; Q.backfill(qs); return qs[2].id === 'q2_stable'; })());

console.log('\nThe actual bug: answers must follow the question');
{
  const qs = [{ text: 'Capital of France?' }, { text: '2+2?' }, { text: 'Who wrote Hamlet?' }];
  Q.backfill(qs);
  const hamletBucket = Q.bucket(qs[2], 2, CODE);

  // moveQ — swap two questions
  const swapped = [qs[1], qs[0], qs[2]];
  ok('a swap does not move anyone\'s answers',
     Q.bucket(swapped[0], 0, CODE) === Q.bucket(qs[1], 1, CODE) &&
     Q.bucket(swapped[1], 1, CODE) === Q.bucket(qs[0], 0, CODE));

  // deleteQ — remove the first question
  const afterDelete = qs.slice(1);
  ok('Hamlet keeps its own answers after a delete shifts its index',
     Q.bucket(afterDelete[1], 1, CODE) === hamletBucket,
     { now: Q.bucket(afterDelete[1], 1, CODE), was: hamletBucket });
  ok('and nothing else inherits them',
     Q.bucket(afterDelete[0], 0, CODE) !== hamletBucket);

  // The old behaviour, for contrast — this is what was broken.
  ok('the OLD index-derived key would have mis-attributed it',
     legacyKey(1, CODE) !== hamletBucket);
}

console.log('\nFresh ids');
{
  const a = Q.fresh(), b = Q.fresh();
  ok('are unique', a !== b);
  ok('are RTDB-key-safe', !/[.$#[\]/]/.test(a), a);
  ok('never look like a backfilled slot', !Q.isLegacy(a) && !Q.isLegacy(b));
  ok('a backfilled id is recognised as legacy', Q.isLegacy('q3_stable'));
  ok('a fresh id added to an old deck cannot collide with a slot', (() => {
    const qs = [{ text: 'old' }, { text: 'old2' }];
    Q.backfill(qs);
    qs.splice(1, 0, { text: 'inserted', id: Q.fresh() });
    const buckets = qs.map((q, i) => Q.bucket(q, i, CODE));
    return new Set(buckets).size === buckets.length;
  })());
}

console.log('\nBuckets are namespaced per session');
{
  const q = { text: 'x' }; Q.backfill([q]);
  ok('the same question in two rooms uses two buckets',
     Q.bucket(q, 0, 'AAA111') !== Q.bucket(q, 0, 'BBB222'));
  ok('a duplicated deck cannot read the original\'s answers',
     Q.bucket({ id: q.id }, 0, 'NEWCODE') === q.id + '_NEWCODE');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
