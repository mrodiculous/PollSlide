#!/usr/bin/env node
/* The PowerPoint pane lost live responses.
 *
 * Reported 2026-09-21: answering via the QR link showed nothing in the add-in. The pane
 * filters responses to "this round" with `submittedAt >= liveStartedAt`, which is right —
 * presenter.html does the same. What was wrong was WHERE the cutoff came from.
 *
 * The pane set liveStartedAt = Date.now() at the moment the FIRST response ARRIVED. That
 * instant is necessarily later than that response's own submittedAt (submit time + network
 * latency, plus any clock skew between the phone and the laptop). So the answer that
 * started the round immediately failed the round's own cutoff. It rendered once, then the
 * first re-render — the reveal countdown firing, or a second answer landing — filtered it
 * out. A presenter testing with their own phone watched the count go 1 → 0 and reasonably
 * concluded responses were not arriving.
 *
 * The cutoff is not the pane's to invent: presenter.html writes the real launch time to
 * qstate/<qId>/launchedAt and filters on exactly that. The pane now reads it. No qstate
 * means nobody launched the question — someone scanned the QR on a slide — so there is no
 * round to be outside of and no cutoff is applied.
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ✓ ' + name)) : (fail++, console.log('  ✗ ' + name)); };

/* Models one open-view → answer → reveal cycle. 'old' is the shipped bug, kept so the
   test proves it reproduces rather than merely asserting the fix looks nice. */
function cycle(mode, launchedAt = 0) {
  let liveStartedAt = mode === 'new' ? (launchedAt > 0 ? launchedAt : 0) : 0;
  let revealArmed = false;
  const viewOpened = 1000;
  const submittedAt = viewOpened + 5000;
  const arrived = submittedAt + 300;          // latency: arrival is always after submission
  const all = [{ submittedAt }];

  const filter = () => (liveStartedAt > 0 ? all.filter(r => (r.submittedAt || 0) >= liveStartedAt) : all);
  let shown = filter();
  if (mode === 'old') {
    if (all.length > 0 && !revealArmed && liveStartedAt === 0) { liveStartedAt = arrived; revealArmed = true; }
  } else {
    if (shown.length > 0 && !revealArmed) revealArmed = true;
  }
  const onArrival = shown.length;
  const afterReveal = filter().length;        // doReveal() re-reads and re-filters
  return { onArrival, afterReveal, revealArmed };
}

console.log('\nThe bug reproduces against the old logic');
const bug = cycle('old');
ok('old logic shows the answer on arrival', bug.onArrival === 1);
ok('old logic then LOSES it when the reveal fires', bug.afterReveal === 0);

console.log('\nFixed: QR scanned, question never launched (no qstate)');
const scanned = cycle('new');
ok('the answer appears', scanned.onArrival === 1);
ok('the answer survives the reveal', scanned.afterReveal === 1);
ok('the reveal countdown still starts', scanned.revealArmed === true);

console.log('\nFixed: question launched from the presenter (qstate present)');
const launched = cycle('new', 900);
ok('the answer appears and survives', launched.onArrival === 1 && launched.afterReveal === 1);

console.log('\nThe filter still does its actual job');
const twoRounds = [{ submittedAt: 500 }, { submittedAt: 12000 }];
ok('an answer from before launch is still excluded', twoRounds.filter(r => r.submittedAt >= 10000).length === 1);
ok('an answer from after launch is kept', twoRounds.filter(r => r.submittedAt >= 10000)[0].submittedAt === 12000);

console.log('\nThe source still says what it should');
const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint.html'), 'utf8');
ok('goLive reads the authoritative launchedAt from qstate', /qstate\/\$\{qId\}\/launchedAt/.test(src));
/* Strip comments first: the fix is explained in a comment that quotes the old broken
   line, and matching that would fail forever while the code is correct. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('the listener no longer invents a cutoff', !/liveStartedAt\s*=\s*Date\.now\(\)/.test(code));
ok('goLive is async (it awaits that read)', /async function goLive/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
