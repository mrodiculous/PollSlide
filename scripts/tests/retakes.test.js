/* Tests for second attempts (lib/retakes.js).
 *
 * The thing that must not break: a deck with retakes OFF behaves exactly as it always
 * did. Everything else here is about a grade landing on the right answer — so the
 * rules that matter most are the conservative ones. A malformed policy means OFF, not
 * unlimited; a tie under "best" keeps the earlier answer; "first" records the retake
 * but never grades it.
 *
 * Run: node scripts/tests/retakes.test.js
 */
const path = require('path');
const R = require(path.resolve(__dirname, '../../lib/retakes.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

console.log('\nOff unless a teacher turns it on');
ok('nothing stored means off',        !R.retakePolicy(undefined).allowed);
ok('an empty object means off',       !R.retakePolicy({}).allowed);
ok('null means off',                  !R.retakePolicy(null).allowed);
ok('a string means off',              !R.retakePolicy('yes').allowed);
ok('allowed:"true" (a string) is NOT on — only a real boolean is',
   !R.retakePolicy({ allowed: 'true' }).allowed);
ok('allowed:1 is not on either',      !R.retakePolicy({ allowed: 1 }).allowed);
ok('allowed:true is on',              R.retakePolicy({ allowed: true }).allowed);

console.log('\nA broken policy can never mean "unlimited tries on a graded quiz"');
ok('no max means two tries',          R.retakePolicy({ allowed: true }).max === 2);
ok('max 1 is raised to 2 — "on" has to mean at least a second try',
   R.retakePolicy({ allowed: true, max: 1 }).max === 2);
ok('max 0 likewise',                  R.retakePolicy({ allowed: true, max: 0 }).max === 2);
ok('a negative max likewise',         R.retakePolicy({ allowed: true, max: -5 }).max === 2);
ok('garbage max likewise',            R.retakePolicy({ allowed: true, max: 'lots' }).max === 2);
ok('an absurd max is capped',         R.retakePolicy({ allowed: true, max: 9999 }).max === R.MAX_ATTEMPTS);
ok('a sensible max is kept',          R.retakePolicy({ allowed: true, max: 3 }).max === 3);
ok('an unknown counts mode falls back to best',
   R.retakePolicy({ allowed: true, counts: 'whatever' }).counts === 'best');
ok('no counts mode means best',       R.retakePolicy({ allowed: true }).counts === 'best');
ok('all three modes are declared',    R.COUNT_MODES.join() === 'best,last,first');

console.log('\nCounting the tries already used');
ok('no history is none used',         R.attemptsUsed(null) === 0 && R.attemptsUsed(undefined) === 0);
ok('an empty history is none used',   R.attemptsUsed({}) === 0);
ok('two recorded attempts',           R.attemptsUsed({ 1: {}, 2: {} }) === 2);
ok('junk history is none used',       R.attemptsUsed('two') === 0);

console.log('\nMay this student try again?');
const on2 = { allowed: true, max: 2 }, on3 = { allowed: true, max: 3 }, off = { allowed: false };
ok('off: never',                      !R.canRetake(off, 0) && !R.canRetake(off, 1));
ok('on, one used: yes',               R.canRetake(on2, 1));
ok('on, both used: no',               !R.canRetake(on2, 2));
ok('on, more used than allowed: no',  !R.canRetake(on2, 7));
ok('three tries, two used: yes',      R.canRetake(on3, 2));
ok('tries left is reported for the student',
   R.attemptsLeft(on3, 1) === 2 && R.attemptsLeft(on3, 3) === 0);
ok('never a negative number of tries left', R.attemptsLeft(on2, 99) === 0);
ok('off means zero left',             R.attemptsLeft(off, 0) === 0);

console.log('\nWhich attempt gets graded');
const right = { isCorrect: true }, wrong = { isCorrect: false }, half = { isCorrect: 0.5 };
ok('the first answer always counts when there is none yet',
   R.shouldReplace('best', null, wrong));

console.log('  best:');
ok('    a right answer replaces a wrong one',      R.shouldReplace('best', wrong, right));
ok('    a wrong answer does NOT replace a right one', !R.shouldReplace('best', right, wrong));
ok('    partial credit replaces zero',             R.shouldReplace('best', wrong, half));
ok('    full credit replaces partial',             R.shouldReplace('best', half, right));
ok('    partial does not replace full',            !R.shouldReplace('best', right, half));
ok('    an equal answer keeps the earlier one — they did not improve on it',
   !R.shouldReplace('best', right, right) && !R.shouldReplace('best', wrong, wrong));

console.log('  last:');
ok('    always replaces, even with a worse answer', R.shouldReplace('last', right, wrong));
ok('    and with an equal one',                     R.shouldReplace('last', right, right));

console.log('  first:');
ok('    never replaces, even with a better answer', !R.shouldReplace('first', wrong, right));
ok('    …but the attempt is still recorded (that is the caller\'s job, not this one)',
   R.shouldReplace('first', null, wrong));

ok('an unknown mode behaves as best', R.shouldReplace('nonsense', wrong, right)
                                   && !R.shouldReplace('nonsense', right, wrong));

console.log('\nScoring agrees with the leaderboard (psBasePoints)');
ok('true is a full point',            R.scoreOf({ isCorrect: true }) === 1);
ok('a number is partial credit',      R.scoreOf({ isCorrect: 0.25 }) === 0.25);
ok('false is nothing',                R.scoreOf({ isCorrect: false }) === 0);
ok('missing is nothing',              R.scoreOf({}) === 0 && R.scoreOf(null) === 0);
ok('zero partial credit is nothing',  R.scoreOf({ isCorrect: 0 }) === 0);
ok('a negative number is nothing, not a penalty', R.scoreOf({ isCorrect: -1 }) === 0);

console.log('\nWhat each audience is told');
const say = (p, who) => R.describePolicy(p, who);
ok('a student with retakes off is told plainly',
   /one answer/i.test(say(off, 'student')));
ok('a student is told trying again can help under best',
   /best try/i.test(say({ allowed: true, max: 2, counts: 'best' }, 'student')));
ok('…and told it CANNOT help under first — otherwise the offer is a lie',
   /first answer is the one that counts/i.test(say({ allowed: true, max: 2, counts: 'first' }, 'student')));
ok('a student sees "twice" for two, not "up to 2 times"',
   /twice/.test(say({ allowed: true, max: 2 }, 'student')));
ok('…and a count for more than two',
   /up to 4 times/.test(say({ allowed: true, max: 4 }, 'student')));
ok('the teacher is told every attempt is kept',
   /every attempt is kept/i.test(say({ allowed: true, max: 3 }, 'teacher')));
ok('the teacher is told which one is graded',
   /best attempt is graded/i.test(say({ allowed: true, counts: 'best' }, 'teacher')));
ok('audiences get different sentences', say(off, 'student') !== say(off, 'teacher'));
ok('no audience given still returns a sentence', typeof say(off) === 'string' && say(off).length > 10);

console.log('\nThe deck menu label reads as a state');
ok('off',       R.shortLabel({}) === 'Retakes: off', R.shortLabel({}));
ok('on, best',  R.shortLabel({ allowed: true, max: 2, counts: 'best' }) === 'Retakes: 2 tries, best counts');
ok('on, last',  /last counts/.test(R.shortLabel({ allowed: true, max: 3, counts: 'last' })));
ok('on, first', /first counts/.test(R.shortLabel({ allowed: true, counts: 'first' })));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
