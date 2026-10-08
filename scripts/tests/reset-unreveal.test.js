#!/usr/bin/env node
/* A tally reset also ends the reveal (2026-10-08). Rod: after Reset tally, the presenter's
 * selected question and the Mac companion stayed on "Answer revealed" showing the answer.
 * Cause: every reset deleted responses but left phase:'revealed' in Firebase, and the
 * companion / big screen could only ever go INTO revealed. Verified on the stage server for
 * all four reset buttons, QR-targeted and follow mode, plus the PowerPoint re-claim trap.
 * Run: node scripts/tests/reset-unreveal.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n));
const P = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
const C = fs.readFileSync(path.join(ROOT, 'companion.html'), 'utf8');
const L = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const fnBody = (src, sig) => { const i = src.indexOf(sig); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i) + 3); };

console.log('\nPresenter: every reset clears the reveal');
const h = fnBody(P, 'async function clearRevealState(code, onlyQid)');
ok('clearRevealState exists', h.length > 100);
ok('…writes phase live + a fresh resetAt to qstate and currentQuestion in ONE update', /upd\[`qstate\/\$\{k\}\/resetAt`\] = at/.test(h) && /upd\['currentQuestion\/resetAt'\] = at/.test(h) && /db\.ref\(`sessions\/\$\{code\}`\)\.update\(upd\)/.test(h));
ok('…touches existing nodes only, never the Final-card tally, and never throws', /Object\.keys\(qs\)\.forEach/.test(h) && /!cq\.showTally/.test(h) && /catch \(e\) \{\}/.test(h));
ok('per-question Reset clears that question\'s bucket', /responses\/\$\{stableQId\}`\)\.remove\(\);\n    await clearRevealState\(code, stableQId\);/.test(P));
for (const [name, sig] of [['Reset (legacy)', 'async function doReset()'], ['Reset tally (presentation)', 'async function doResetPres()'], ['Reset all tallies', 'async function doResetAll()']]) {
  const b = fnBody(P, sig);
  ok(name + ': clears the reveal in Firebase', /clearRevealState\(code\)/.test(b));
  ok(name + ': redraws the question that was live, un-revealed and still live', /const wasLive = /.test(b) && /if \(wasLive !== null && wasLive === selIdx && !editorOnScreen\(\)\) showLiveOrEdit\(wasLive\);/.test(b));
}
ok('Reset tally (presentation) also clears the presenter\'s own reveal state', /clearRightPanel\(\);   \/\/ local reveal state too/.test(fnBody(P, 'async function doResetPres()')));

console.log('\nCompanion + big screen follow the reset — and ONLY the reset');
const f = fnBody(C, 'function followRemoteReset(src, q)');
ok('companion: un-reveals only on a NEWER resetAt (first value is the baseline)', /if \(_seenResetAt === null\) \{ _seenResetAt = r; return false; \}/.test(f) && /if \(!r \|\| r <= _seenResetAt\) return false;/.test(f) && /resetReveal\(q\)/.test(f));
ok('companion: a bare phase:\'live\' (the PowerPoint add-in re-claim) is NOT an un-reveal', !/=== 'live' && \(was/.test(C) && !/function followRemotePhase/.test(C));
ok('companion: wired into QR-targeted mode', /const unrevealed = followRemoteReset\(src, curQ\);/.test(C) && /if \(unrevealed \|\| newPhase !== presentPhase/.test(C));
ok('companion: wired into follow mode', /followRemoteReset\(q, q\);\n      presentPhase = q\.phase \|\| 'live';/.test(C));
ok('companion: the baseline resets on every question change', /resetReveal\(qObj\);\n      _seenResetAt = null;/.test(C) && /_seenResetAt = Number\(q\.resetAt\) \|\| 0;/.test(C));
ok('big screen: a newer resetAt redraws the question fresh', /if \(Number\(q\.resetAt\) > _liveResetSeen && newPhase === 'live'\) \{ presentPhase = 'live'; showQuestion\(q\); return; \}/.test(L) && /_liveResetSeen = Math\.max\(_liveResetSeen, Number\(q\.resetAt\) \|\| 0\);/.test(L));
ok('the frozen PowerPoint add-in is untouched by this fix', !/resetAt/.test(fs.readFileSync(path.join(ROOT, 'powerpoint-content', 'index.html'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
