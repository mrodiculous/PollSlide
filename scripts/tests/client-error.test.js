/* Tests for the client-error intake (api/client-error.js → normalize()).
 *
 * Everything this function receives is attacker-controlled: the endpoint is public
 * by necessity (a page that is broken enough to throw can't be trusted to sign in
 * first). So the bounds matter — an unbounded `message` is an unbounded RTDB write.
 *
 * Run: node scripts/tests/client-error.test.js
 */
const { normalize } = require('../../api/client-error');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';

console.log('\nRejects junk');
ok('null body dropped',        normalize(null, UA) === null);
ok('non-object dropped',       normalize('hello', UA) === null);
ok('array dropped',            normalize([], UA) === null || normalize([], UA).message === undefined);
ok('missing message dropped',  normalize({ kind: 'error' }, UA) === null);
ok('empty message dropped',    normalize({ message: '' }, UA) === null);

console.log('\nBounds every attacker-controlled field');
const huge = normalize({
  message: 'x'.repeat(5000), source: 'y'.repeat(5000), kind: 'k'.repeat(500),
  stack: Array(200).fill('frame line here').join('\n'), page: 'p'.repeat(500), ver: 'v'.repeat(500),
}, 'u'.repeat(5000));
ok('message ≤ 300',  huge.message.length === 300, huge.message.length);
ok('source ≤ 120',   huge.source.length === 120, huge.source.length);
ok('kind ≤ 16',      huge.kind.length === 16, huge.kind.length);
ok('stack ≤ 400',    huge.stack.length <= 400, huge.stack.length);
ok('page ≤ 60',      huge.page.length === 60, huge.page.length);
ok('ver ≤ 24',       huge.ver.length === 24, huge.ver.length);
ok('ua ≤ 140',       huge.ua.length === 140, huge.ua.length);
ok('stack keeps only the first 4 frames',
   huge.stack.split(' | ').length === 4, huge.stack.split(' | ').length);

console.log('\nDedupe key');
const a = normalize({ message: 'boom', source: 'answer.html', line: 42, kind: 'error' }, UA);
const b = normalize({ message: 'boom', source: 'answer.html', line: 42, kind: 'error' }, 'different UA');
const c = normalize({ message: 'boom', source: 'answer.html', line: 99, kind: 'error' }, UA);
const d = normalize({ message: 'other', source: 'answer.html', line: 42, kind: 'error' }, UA);
ok('same fault → same key (so repeats merge)', a.key === b.key);
ok('different line → different key',           a.key !== c.key);
ok('different message → different key',        a.key !== d.key);
ok('key is RTDB-safe (no . $ # [ ] /)',        !/[.$#[\]/]/.test(a.key), a.key);

console.log('\nNumber handling');
ok('line 0 stays 0, not null',   normalize({ message: 'm', line: 0 }, UA).line === 0);
ok('missing line → null',        normalize({ message: 'm' }, UA).line === null);
ok('garbage line → null',        normalize({ message: 'm', line: 'abc' }, UA).line === null);
ok('numeric string line coerced', normalize({ message: 'm', line: '12' }, UA).line === 12);

console.log('\nNo personal data is carried through');
const rec = normalize({ message: 'boom', source: 's', page: '/answer.html', email: 'rod@x.com', uid: 'abc123', answer: 'B' }, UA);
ok('unknown fields are not stored',
   !('email' in rec) && !('uid' in rec) && !('answer' in rec), Object.keys(rec));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
