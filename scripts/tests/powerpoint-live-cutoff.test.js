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

console.log('\nThe pane publishes which question is live (the stale-currentQuestion bug)');
/* answer.html watches sessions/<code>/currentQuestion: it follows qIndex and takes
   currentQuestion.id as the response bucket. This pane only ever READ session state, so
   currentQuestion held whatever presenter.html last wrote — a different question, possibly
   from days earlier. Scanning question 3's QR therefore loaded question 3 and was then
   yanked to the stale one, which the tester HAD answered ("You've already answered this
   question" on a question they hadn't), while answers landed in the stale bucket and every
   question showed zero responses. */
{
  const src2 = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint.html'), 'utf8');
  ok('the pane defines publishLive', /async function publishLive\(/.test(src2));
  ok('goLive publishes before listening', /await publishLive\([^)]*\);\s*\n\s*attachListener\(/.test(src2));
  ok('it writes currentQuestion', /sessions\/\$\{code\}\/currentQuestion/.test(src2));
  ok('it writes qstate for the live question', /sessions\/\$\{code\}\/qstate\/\$\{qId\}/.test(src2));
  ok('the published id IS the bucket the listener uses', /id: qId,/.test(src2));
  ok('it publishes qIndex so the phone follows this question', /qIndex: idx,/.test(src2));
  ok('status is active, matching presenter.html and overlay.html', /status: 'active'/.test(src2));
  /* A pane with a lapsed token would otherwise look healthy while every phone followed
     the wrong question — the silent version of this bug cost a whole session to find. */
  ok('a failed publish is surfaced, not swallowed', /publishLive failed|Could not tell your audience/.test(src2));
  ok('the round start is persisted per question, like presenter.html', /ql_liveStart_\$\{code\}_\$\{idx\}/.test(src2));
}

console.log('\nThe source still says what it should');
const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint.html'), 'utf8');
/* Superseded: the first fix had the pane READ qstate/<qId>/launchedAt. That was still
   wrong for this product — nobody was writing it, because this pane is the presenter
   surface here. It now OWNS the round start: persists it per question and publishes it. */
ok('goLive derives the cutoff from the persisted round start', /liveStartedAt = savedStart/.test(src));
/* Strip comments first: the fix is explained in a comment that quotes the old broken
   line, and matching that would fail forever while the code is correct. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('the listener no longer invents a cutoff', !/liveStartedAt\s*=\s*Date\.now\(\)/.test(code));
ok('goLive is async (it awaits that read)', /async function goLive/.test(src));

console.log('\nThe content add-in reads decks from the same place the task pane does');
/* The first build queried quiz_builder by an "owner" field. That is not how this
   database is shaped, so the picker silently returned nothing and just said "No
   presentations found on this account" — which reads like an empty account rather
   than a wrong query. Decks live at users/<uid>/presentations, the title field is
   `name` (not `title`), and the session code is a FIELD on the record (sessionCode),
   not the key. Pin all of that to the task pane, which has always had it right. */
{
  const content = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');
  const pane    = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint.html'), 'utf8');
  ok('task pane reads users/<uid>/presentations', /users\/\$\{userId\}\/presentations/.test(pane));
  ok('content add-in reads the same path', /users\/'\s*\+\s*auth\.currentUser\.uid\s*\+\s*'\/presentations/.test(content));
  ok('content add-in no longer queries quiz_builder by owner', !/orderByChild\(\s*'owner'\s*\)/.test(content));
  ok('content add-in uses p.sessionCode, not the record key', /p\.sessionCode/.test(content));
  ok('content add-in uses p.name for the title', /p\.name/.test(content));
}

console.log('\nThe content add-in reads the real question/answer shapes');
/* Second shape bug in this file's history, so it is pinned. Verified against the live
   Reviewer Demo question on 2026-09-21:
     options[i] = { text, img, imgGif }   → the label is .text, NOT the item
     correctAnswer = [2]                  → an ARRAY for multiple_choice_multi
     r.answer = "[2]"                     → a JSON string holding index/indices
   Rendering the option object directly printed "[object Object]" on a slide, and
   Number([2]) is NaN so nothing was ever marked correct. */
{
  const c = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');
  ok('option labels go through a .text accessor', /optLabel/.test(c) && /o\.text/.test(c));
  ok('the raw option object is never interpolated', !/\$\{esc\(o\)\}/.test(c));
  ok('correctAnswer handles an array', /Array\.isArray\(_ca\)\s*\?\s*_ca\s*:\s*\[_ca\]/.test(c));
  ok('an absent/empty correctAnswer is not treated as index 0', /_ca\.length === 0/.test(c));
  ok('answers are JSON-parsed and may be arrays', /JSON\.parse\(r\.answer\)/.test(c) && /Array\.isArray\(a\)\s*\?\s*a\s*:\s*\[a\]/.test(c));
  ok('questions with no options fall back to listing answers', /isChoice/.test(c) && /safeAnswer/.test(c));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
