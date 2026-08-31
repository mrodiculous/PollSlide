/* Tests for psStandings — the scoring shared by the presenter, the big screen and
 * the recap.
 *
 * This does not reimplement the block; it EXTRACTS it from presenter.html and runs
 * it in a vm, so a test can only pass if the shipped code passes. It also asserts
 * the three copies are byte-identical, which is the thing the admin runbook promises
 * and the only reason the three screens can't disagree about who won.
 *
 * The property added with class rosters: a leaderboard ranks PEOPLE. A student who
 * answers on the school Chromebook and finishes on their phone is one competitor
 * with one score, not two half-scores — and cannot use the second device to retry a
 * question they already got wrong.
 *
 * Run: node scripts/tests/standings.test.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const blockOf = (file) => {
  const t = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // Whole lines: the markers live inside `// ===== … =====` comments, and slicing
  // from the marker itself would cut a comment in half and not parse.
  const m = /^.*PS_GAME_MODES_START[\s\S]*?PS_GAME_MODES_END.*$/m.exec(t);
  return m && m[0];
};

console.log('\nThe three screens run the same scoring');
const blocks = ['presenter.html', 'live.html', 'report.html'].map(blockOf);
ok('the block exists in all three', blocks.every(Boolean));
ok('and is byte-identical, so they cannot disagree about who won',
   new Set(blocks).size === 1, blocks.map(b => (b || '').length));

/* PSQid.bucket decides which stored bucket a question's answers live in. Standings
 * only needs it to be consistent between what the test stores and what it reads. */
const ctx = { PSQid: { bucket: (q, i) => 'q' + i }, console };
vm.createContext(ctx);
vm.runInContext(blocks[0], ctx);
const { psStandings } = ctx;
ok('psStandings loaded out of the page', typeof psStandings === 'function');

const qs = [{}, {}, {}, {}];
const R = (over) => Object.assign({ name: 'x', isCorrect: true, elapsed: 1, submittedAt: 1 }, over);
const run = (all, mode = 'classic') => psStandings(mode, qs, all, 'CODE');

console.log('\nOne student, two devices, one score');
const split = {
  q0: { chromebook: R({ name: 'Ana R.', studentId: 'st_ana' }) },
  q1: { chromebook: R({ name: 'Ana R.', studentId: 'st_ana' }) },
  q2: { phone:      R({ name: 'Ana R.', studentId: 'st_ana' }) },
  q3: { phone:      R({ name: 'Ana R.', studentId: 'st_ana' }) },
};
let rows = run(split);
ok('Ana is one row, not two', rows.length === 1, rows.map(r => r.name + ':' + r.score));
ok('with all four points, not two', rows[0].score === 4, rows[0].score);
ok('and all four answers counted', rows[0].answered === 4);
ok('her row is keyed by the student, not the device', rows[0].pid === 'st_ana');

console.log('\nAn open session still works — pid is all there is');
const open = { q0: { devA: R({ name: 'Dan' }) }, q1: { devA: R({ name: 'Dan' }) },
               q2: { devB: R({ name: 'Sam' }) } };
rows = run(open);
ok('two people, scored separately', rows.length === 2);
ok('keyed by device, as before', rows.every(r => /^dev/.test(r.pid)), rows.map(r => r.pid));

console.log('\nA second device is not a free retry');
const retry = {
  q0: { chromebook: R({ studentId: 'st_ana', isCorrect: false, submittedAt: 100 }),
        phone:      R({ studentId: 'st_ana', isCorrect: true,  submittedAt: 500 }) },
};
rows = run(retry);
ok('one row', rows.length === 1);
ok('the FIRST answer stands — the wrong one', rows[0].score === 0, rows[0].score);
ok('and it counts once, not twice', rows[0].answered === 1);

const retryReversed = {   // same facts, opposite key order in the object
  q0: { phone:      R({ studentId: 'st_ana', isCorrect: true,  submittedAt: 500 }),
        chromebook: R({ studentId: 'st_ana', isCorrect: false, submittedAt: 100 }) },
};
ok('…whichever order the database happens to return them in',
   run(retryReversed)[0].score === 0, run(retryReversed)[0].score);

console.log('\nTwo students are never folded together');
const two = {
  q0: { d1: R({ name: 'Ana R.', studentId: 'st_ana' }), d2: R({ name: 'Ben C.', studentId: 'st_ben' }) },
  q1: { d1: R({ name: 'Ana R.', studentId: 'st_ana' }), d2: R({ name: 'Ben C.', studentId: 'st_ben', isCorrect: false }) },
};
rows = two && run(two);
ok('both appear', rows.length === 2);
ok('scored on their own answers', rows[0].score === 2 && rows[1].score === 1, rows.map(r => r.name + ':' + r.score));

// A shared classroom device: two students, same pid, different studentIds. Before
// folding by identity this was ONE row whose name flickered between them.
console.log('\nA shared device carrying two students');
const shared = {
  q0: { kiosk: R({ name: 'Ana R.', studentId: 'st_ana' }) },
  q1: { kiosk: R({ name: 'Ben C.', studentId: 'st_ben' }) },
};
rows = run(shared);
ok('is two people, not one', rows.length === 2, rows.map(r => r.name));
ok('each with their own point', rows.every(r => r.score === 1));

console.log('\nThe game modes still behave');
const streak = { q0:{d:R({studentId:'s'})}, q1:{d:R({studentId:'s'})}, q2:{d:R({studentId:'s',isCorrect:false})}, q3:{d:R({studentId:'s'})} };
ok('streak resets on a miss and rebuilds', run(streak, 'streak')[0].bestStreak === 2, run(streak,'streak')[0]);
const surv = { q0:{d:R({studentId:'s'})}, q1:{d:R({studentId:'s',isCorrect:false})}, q2:{d:R({studentId:'s'})} };
const sv = run(surv, 'survival')[0];
ok('survival knocks them out at the miss', sv.alive === false && sv.outAt === 2, sv);
ok('…and later right answers do not revive them', sv.score === 1, sv.score);
const wager = { q0:{d:R({studentId:'s',wager:3})}, q1:{d:R({studentId:'s',wager:3,isCorrect:false})} };
ok('wager pays out and takes back', run(wager,'wager')[0].score === 1, run(wager,'wager')[0].score);
ok('speed pays a bonus for answering fast',
   run({q0:{d:R({studentId:'s',elapsed:800})}}, 'speed')[0].score > 1,
   run({q0:{d:R({studentId:'s',elapsed:800})}}, 'speed')[0].score);
ok('…but an unrecorded time earns none, rather than a free maximum',
   run({q0:{d:R({studentId:'s',elapsed:0})}}, 'speed')[0].score === 1);
ok('a slow answer still scores the base point',
   run({q0:{d:R({studentId:'s',elapsed:999999})}}, 'speed')[0].score === 1);

console.log('\nDegenerate input does not throw');
ok('no responses',   run({}).length === 0);
ok('null responses', psStandings('classic', qs, null, 'C').length === 0);
ok('no questions',   psStandings('classic', [], {q0:{d:R({})}}, 'C').length === 0);
ok('a record with nothing in it', run({ q0: { d: {} } }).length === 1);
ok('an unknown mode falls back rather than throwing',
   run({ q0: { d: R({ studentId: 's' }) } }, 'nonsense')[0].score === 1);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
