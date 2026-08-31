/* Tests for longitudinal student progress (lib/progress.js).
 *
 * This computes a sentence a teacher may repeat to a parent, so the tests that matter
 * most are the ones that stop it overclaiming:
 *
 *   • two sittings is never a trend
 *   • a small wobble is "steady", not "declining"
 *   • one bad day cannot invert a term of progress
 *   • an ungraded reflection question is never part of a score
 *
 * Run: node scripts/tests/progress.test.js
 */
const path = require('path');
const P = require(path.resolve(__dirname, '../../lib/progress.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const DAY = 86400000, T0 = Date.parse('2026-01-06T09:00:00Z');
// one answer row, report.html's shape
const a = (o) => Object.assign({ presId:'d1', presName:'Quiz', name:'Ana R.', studentId:'st_ana',
                                 date:T0, isCorrect:true }, o);
// a whole sitting: n questions, `right` of them correct, on day `d`
const sitting = (d, right, n, over) => Array.from({length:n}, (_, i) =>
  a(Object.assign({ date: T0 + d*DAY, qIdx:i, isCorrect: i < right }, over)));

console.log('\nTwo sittings is not a trend');
let s = P.byStudent([...sitting(0,1,10), ...sitting(7,9,10)])[0];
ok('both sittings counted',       s.sittingCount === 2, s.scores);
ok('the scores are right',        s.scores.join() === '10,90');
ok('but the direction is unknown', s.trend.direction === 'unknown', s.trend);
ok('and it says why in plain words', /Needs 3 sittings/.test(s.trend.why), s.trend.why);
ok('no change is claimed',        s.trend.change === null);

console.log('\nWith enough sittings, a real direction is reported');
s = P.byStudent([...sitting(0,4,10), ...sitting(7,5,10), ...sitting(14,8,10), ...sitting(21,9,10)])[0];
ok('improving',        s.trend.direction === 'improving', s.trend);
ok('with the size of the change', s.trend.change > 0, s.trend.change);
ok('and a sentence a person can read', /Up \d+/.test(s.trend.why), s.trend.why);
s = P.byStudent([...sitting(0,9,10), ...sitting(7,8,10), ...sitting(14,5,10), ...sitting(21,4,10)])[0];
ok('declining, when it really is', s.trend.direction === 'declining', s.trend);

console.log('\nNormal classroom variation is "steady", not a direction');
s = P.byStudent([...sitting(0,7,10), ...sitting(7,8,10), ...sitting(14,7,10), ...sitting(21,7,10)])[0];
ok('a few points either way is steady', s.trend.direction === 'steady', s.trend);
ok('…and says so honestly', /inside normal variation/.test(s.trend.why));
ok('the noise band is real, not zero', P.NOISE_BAND >= 5);

console.log('\nOne bad day cannot invert a term of progress');
// climbing all term, then a single terrible last sitting
s = P.byStudent([...sitting(0,5,10), ...sitting(7,7,10), ...sitting(14,8,10),
                 ...sitting(21,9,10), ...sitting(28,2,10)])[0];
ok('still not called "declining" off one score',
   s.trend.direction !== 'declining', { dir:s.trend.direction, scores:s.scores });
ok('the bad day is still visible in the scores', s.scores[s.scores.length-1] === 20);

console.log('\nUngraded questions are never part of a score');
s = P.byStudent([ ...sitting(0,5,10),
                  a({ date:T0, qIdx:99, isCorrect:null }),      // reflection prompt
                  a({ date:T0, qIdx:98, isCorrect:undefined }) ])[0];
ok('the score is unchanged by them', s.scores[0] === 50, s.scores);
ok('but the answers are still counted as answered', s.sittings[0].answered === 12);
ok('a sitting with NO graded questions is not a score at all',
   P.byStudent([a({ isCorrect:null })])[0].sittingCount === 0);

console.log('\nOne student, many devices and sessions');
const twoDevices = [ a({ pid:'chromebook', date:T0,      isCorrect:true }),
                     a({ pid:'phone',      date:T0,      isCorrect:false }),
                     a({ pid:'phone',      date:T0+7*DAY, isCorrect:true }) ];
let all = P.byStudent(twoDevices);
ok('still one student',             all.length === 1);
ok('two sittings, not three',       all[0].sittingCount === 2, all[0].sittings.map(x=>x.id));
ok('the same-day answers are one score', all[0].scores[0] === 50);
ok('sittings are oldest first',     all[0].sittings[0].date <= all[0].sittings[1].date);

console.log('\nWithout a class, students are matched on the typed name');
all = P.byStudent([ a({ studentId:null, name:'Dan' }), a({ studentId:null, name:'dan', date:T0+DAY }) ]);
ok('case-insensitive', all.length === 1, all.map(x=>x.name));
ok('two different names are two students',
   P.byStudent([a({studentId:null,name:'Dan'}), a({studentId:null,name:'Sam'})]).length === 2);

console.log('\nSummary figures');
const cls = P.byStudent([
  ...sitting(0,9,10,{studentId:'st_a',name:'Ana R.'}), ...sitting(7,9,10,{studentId:'st_a',name:'Ana R.'}),
  ...sitting(14,9,10,{studentId:'st_a',name:'Ana R.'}),
  ...sitting(0,3,10,{studentId:'st_b',name:'Ben C.'}), ...sitting(7,3,10,{studentId:'st_b',name:'Ben C.'}),
  ...sitting(14,2,10,{studentId:'st_b',name:'Ben C.'}),
]);
const sum = P.classSummary(cls);
ok('counts students',      sum.students === 2, sum);
/* Averages the per-student averages AS DISPLAYED (Ana 90, Ben 27), not the raw
 * fractions. If it averaged unrounded values the class figure would not reconcile with
 * the numbers on the screen above it, and someone would eventually try to work out why. */
ok('averages the per-student averages as shown', sum.average === 59, sum.average);
ok('and that reconciles with the rows',
   sum.average === Math.round((cls[0].average + cls[1].average) / 2),
   cls.map(s => s.name + ':' + s.average));
ok('counts sittings',      sum.sittings === 6);
ok('an empty class is safe', P.classSummary([]).average === null);

console.log('\nWho to check on — not a leaderboard');
const attn = P.needsAttention(cls, 5);
ok('the struggling student is surfaced', attn.some(s => s.name === 'Ben C.'), attn.map(s=>s.name));
ok('the thriving one is not',           !attn.some(s => s.name === 'Ana R.'));
ok('a class doing fine surfaces nobody',
   P.needsAttention(P.byStudent([...sitting(0,9,10), ...sitting(7,9,10), ...sitting(14,9,10)]), 5).length === 0);

console.log('\nDegenerate input');
ok('no records',   P.byStudent([]).length === 0);
ok('null',         P.byStudent(null).length === 0);
ok('junk rows',    P.byStudent([null, undefined]).length === 0);
ok('undated rows do not crash', P.byStudent([a({date:null})]).length === 1);
ok('trend on nothing', P.trendOf([]).direction === 'unknown');
ok('trend on junk',    P.trendOf(null).direction === 'unknown');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
