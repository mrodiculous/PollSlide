#!/usr/bin/env node
/* The big screen listens where the phones write (2026-10-10).
 * Since v182 (26 Aug 2026) live.html re-bucketed the live pointer — "<id>_<code>" became
 * "<id>_<code>_<code>" — so "Open big screen" showed "Waiting for responses…" for every
 * question while answers arrived. Found by a security test that needed the big screen to
 * show an answer. Proven on the stage server before and after.
 * Run: node scripts/tests/live-bucket.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const L = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
global.window = {}; require(path.join(ROOT, 'qid.js')); const PSQid = global.window.PSQid;

// Run the page's own liveBucket() with the page's own PSQid.
const src = L.slice(L.indexOf('function liveBucket(q, idx) {'), L.indexOf('\n}\n', L.indexOf('function liveBucket(q, idx) {')) + 2);
const liveBucket = new Function('PSQid', 'sessionCode', src + '; return liveBucket;');
const code = 'ABC123', lb = liveBucket(PSQid, code);

console.log('\nBig screen bucket');
for (const id of ['qzmv2f2wmycz3gp', 'q0_stable', undefined]) {
  const phone = PSQid.bucket({ id }, 2, code);                 // where answer.html writes (from quiz_builder)
  const pointer = { id: phone, qIndex: 2 };                    // what presenter/companion/add-in publish
  ok(`question id ${JSON.stringify(id)}: the big screen listens exactly where the phone writes`, lb(pointer, 2) === phone, { phone, listens: lb(pointer, 2) });
}
ok('an old pointer carrying a bare question id is still turned into its bucket', lb({ id: 'qzabc' }, 0) === 'qzabc_' + code);
ok('a pointer with no id falls back to the position bucket', lb({}, 3) === 'q3_stable_' + code);
ok('the session code is never appended twice', !/_ABC123_ABC123/.test(lb({ id: 'q1_stable_ABC123' }, 1)));
ok('both listeners on the page use it (live answers, and the re-draw at reveal)', (L.replace(src, '').match(/liveBucket\((q|currentQ), idx\)/g) || []).length === 2 && !/PSQid\.bucket\((q|currentQ), idx, sessionCode\)/.test(L.replace(src, '')));
ok('the end-of-deck tally still buckets from the deck\'s own questions', /\[PSQid\.bucket\(q, i, code\)\]/.test(L));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
