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

console.log('\nLink numbers (home) — QR codes follow their question, 2026-10-01');
{
  const J = x => JSON.parse(JSON.stringify(x));
  // A deck in use today: 5 questions, links #CODE/0..4.
  const deck = () => ['A', 'B', 'C', 'D', 'E'].map(t => ({ text: t }));
  const qs = deck();
  ok('first time: returns true (something to save)', Q.ensureHomes(qs) === true);
  ok('first time: every link number = current position, so every existing link and QR is unchanged',
     qs.every((q, i) => q.home === i && Q.homeOf(q, i) === i));
  ok('running it again changes nothing', Q.ensureHomes(qs) === false);
  ok('a deck never reordered publishes the identity map', JSON.stringify(Q.homesMap(qs)) === '{"0":0,"1":1,"2":2,"3":3,"4":4}');
  const same = deck(); Q.ensureHomes(same);
  ok('two browsers backfilling the same deck agree exactly', JSON.stringify(same.map(q => q.home)) === JSON.stringify(qs.map(q => q.home)));

  // Move C (position 2) to the front.
  const moved = J(qs); const c = moved.splice(2, 1)[0]; moved.unshift(c);
  ok('after a move nothing is re-numbered', Q.ensureHomes(moved) === false && moved.map(q => q.home).join() === '2,0,1,3,4');
  const m = Q.homesMap(moved);
  ok("C's old QR (#CODE/2) still opens C", moved[Q.resolve(m, 2)].text === 'C');
  ok("A's old QR (#CODE/0) still opens A — it moved to position 1", moved[Q.resolve(m, 0)].text === 'A');
  ok('every old link resolves to its own question', ['A', 'B', 'C', 'D', 'E'].every((t, n) => moved[Q.resolve(m, n)].text === t));
  ok("the link shown for C is still #CODE/2", Q.homeOf(moved[0], 0) === 2 && Q.linkFor(m, 0) === 2);

  // Delete B (home 1) from the moved deck.
  const del = J(moved).filter(q => q.text !== 'B'); Q.ensureHomes(del);
  const dm = Q.homesMap(del);
  ok("deleting B does not shift D's link (today it would: D's code opened E)", del[Q.resolve(dm, 3)].text === 'D' && del[Q.resolve(dm, 4)].text === 'E');
  ok("B's old QR resolves to -1 (removed), never to whatever sits at position 1 now", Q.resolve(dm, 1) === -1);

  // Add a question after the move + delete.
  del.push({ text: 'F' }); Q.ensureHomes(del);
  ok('a new question gets the next unused number, never a taken one', del[del.length - 1].home === 5);
  const fresh = deck(); Q.ensureHomes(fresh); fresh.push({ text: 'F' }); Q.ensureHomes(fresh);
  ok('in a deck never reordered, a new question number = its position (links look like today)', fresh[5].home === 5);

  // Duplicates: two collaborators adding at once, or a copied question keeping its number.
  const dup = J(qs); dup.push(Object.assign({}, dup[1], { text: 'B copy' })); Q.ensureHomes(dup);
  ok('a duplicated number: the FIRST keeps it, the later copy gets a new one', dup[1].home === 1 && dup[5].home === 5);

  // Decks from before link numbers, and PresentSlide decks, have no homes map.
  ok('no homes map → the number is the position, exactly as before', Q.resolve(null, 3) === 3 && Q.resolve(undefined, 0) === 0 && Q.linkFor(null, 4) === 4);
  ok('the map read back from Firebase as an ARRAY resolves the same', Q.resolve([2, 0, 1], 0) === 2 && Q.resolve([2, 0, 1], 2) === 1);
  ok('a map with gaps read back as a sparse array still says "removed"', Q.resolve([0, null, 1], 1) === -1);
  ok('negative / non-numbers pass through untouched (survey + Q&A modes use -1)', Q.resolve({ 0: 0 }, -1) === -1);
  ok('homeOf without a home falls back to the position', Q.homeOf({ text: 'x' }, 7) === 7);
  const withIds = deck(); Q.backfill(withIds); Q.ensureHomes(withIds);
  const before = withIds.map((q, i) => Q.bucket(q, i, CODE));
  const mv = J(withIds); mv.unshift(mv.splice(2, 1)[0]); Q.ensureHomes(mv);
  ok('where answers are stored (bucket) is untouched by link numbers, before and after a move',
     mv.every(q => before.includes(Q.bucket(q, 0, CODE))) && Q.bucket(mv[0], 0, CODE) === before[2]);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
