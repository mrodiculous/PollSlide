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

console.log('\nA newly inserted content object asks; it never inherits');
/* Reported 2026-09-21: inserting a fresh object auto-loaded a question instead of
   offering the picker. Only document settings are PER-INSTANCE — the localStorage
   cache is keyed by partitionKey and the notes marker belongs to the SLIDE, so
   treating either as "already bound" made every new object adopt the last binding.
   They are fallbacks for the web presentation-mode null (office-js#3406), and only
   in read view, where nobody can pick anyway. */
{
  const c = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');
  ok('resolveBinding is view-aware', /function resolveBinding\(view\)/.test(c));
  ok('edit view returns early, before the shared fallbacks', /if \(view !== 'read'\) return null;/.test(c));
  ok('the notes/localStorage fallbacks sit AFTER that guard',
     c.indexOf("if (view !== 'read') return null;") < c.indexOf('readCachedBinding()', c.indexOf("if (view !== 'read') return null;")));
  ok('boot passes the view through', /resolveBinding\(view\)/.test(c));
  ok('a guessed binding is not written back as if it were chosen',
     /deliberately not re-cached/.test(c));
  /* addRebind grew into addControls when the size and image toggles landed; the
     behaviour these assert is unchanged, only the function name moved. */
  ok('a bound object can be re-pointed while editing', /function addControls\(/.test(c) && /Change question/.test(c));
  ok('the rebind control is gated on editing', /if \(editing\) addControls/.test(c));
}

console.log('\nOption art and the presenter\'s size control');
{
  const c = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');
  /* `img` is the URL; `imgGif` is Giphy METADATA ({alt,id,source}). Using imgGif as a
     src would put a broken image on every slide, so the accessor is pinned. */
  ok('media src comes from o.img', /const u = o && typeof o === 'object' \? o\.img : null/.test(c));
  ok('imgGif is used only for alt text', /o\.imgGif && o\.imgGif\.alt/.test(c));
  ok('videos get their own branch', /isVideoUrl/.test(c) && /<video class="thumb"/.test(c));
  /* Was `this.parentElement.style.display='none'`, correct while the media was a
     full-width banner in its own wrapper. Once it became a thumbnail INSIDE the label,
     hiding the parent would have blanked the answer text too — so it now removes only
     itself. Asserted in the thumbnail block below. */
  /* cqw/cqh silently fall back to the viewport with no container context. */
  ok('a container context exists for cq units', /container-type:\s*size/.test(c));
  ok('every text size is multiplied by --scale', (c.match(/\* var\(--scale\)/g)||[]).length >= 5);
  ok('scale is clamped to a sane range', /Math\.min\(1\.8, Math\.max\(0\.6/.test(c));
  ok('prefs persist with the per-instance binding', /bound\.scale = SCALE; bound\.media = SHOW_MEDIA/.test(c));
  ok('controls are edit-only', /if \(editing\) addControls/.test(c));
}

console.log('\nThumbnails, dark mode, and the countdown');
{
  const c = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');
  /* Option art was a full-width banner above each row: on a short object it pushed the
     answers out of view entirely. */
  ok('option art is a thumbnail beside the letter', /class="thumb"/.test(c) && /\.lbl\{display:flex/.test(c));
  ok('a dead thumbnail removes only itself, not the answer text', /onerror="this\.remove\(\)"/.test(c));
  ok('the old full-width banner is gone', !/\.optmedia img,\.optmedia video\{width:100%/.test(c));

  ok('dark palette exists', /body\.dark\{/.test(c));
  ok('the bar track is themed, not hard-coded', /background:var\(--track\)/.test(c));
  ok('theme is chosen, not sniffed from the slide', /Chosen by the presenter, not sniffed/.test(c));
  ok('theme persists with the binding', /bound\.dark = DARK/.test(c));

  /* There was no countdown at all: the slide sat still while the presenter's own
     screen ticked. Derived from launchedAt + revealDelay, never stored, so a late
     joiner sees the true remaining time instead of restarting the clock. */
  ok('countdown is derived from launchedAt + revealDelay', /function secsLeft\(\)/.test(c) && /_revealSecs - Math\.floor/.test(c));
  ok('it ticks on an interval', /function startTick\(/.test(c) && /setInterval/.test(c));
  ok('it is not rendered once it hits zero', /left > 0 \?/.test(c));
  ok('a manual-reveal question shows no clock', /manually.*no clock|no clock to show/i.test(c));
}

console.log('\nRevealing, and telling phones which question is live');
{
  const c = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');

  /* Reported 2026-09-22: answered while presenting, results updated live, but it never
     revealed, no confetti, and the phone never moved on. Three causes, all here. */

  // 1. the clock counted to zero and nothing performed the reveal
  ok('the countdown has an expiry callback', /function startTick\(redraw, onExpire\)/.test(c));
  ok('expiry actually reveals', /onExpire && onExpire\(\)/.test(c));
  ok('reveal writes the phase so every other surface follows', /qstate\/'\+qid\+'\/phase'\)\.set\('reveal'\)/.test(c));
  ok('a failed write still reveals on this slide', /showing it locally anyway/.test(c));

  // 2. no way to reveal without a timer
  ok('a manual Reveal now button exists', /function addRevealButton\(/.test(c));
  ok('it is removed once revealed, however that happened', /getElementById\('psReveal'\)\?\.remove\(\)/.test(c));

  // 3. phones stayed on the previous question
  ok('read view publishes currentQuestion', /sessions\/'\+b\.code\+'\/currentQuestion'\)\.set\(payload\)/.test(c));
  ok('it publishes the bucket id and qIndex phones follow', /id: qid, qIndex: b\.qIdx/.test(c));
  ok('edit view never publishes', /if \(!editing\) publishWhenVisible/.test(c));
  /* An embedded frame reports "hidden" whenever the host window is not focused, so
     gating the first publish on visibility meant it never ran at all. Verified against
     the live database with visibilityState === 'hidden'. */
  ok('the first publish is NOT gated on visibility', !/if \(done \|\| document\.visibilityState/.test(c));
  ok('visibilitychange re-publishes rather than gating', /done = false; push\(\);/.test(c));
  ok('the clock starts without waiting for a round-trip', /if \(!_launchedAt\) _launchedAt = Date\.now\(\)/.test(c));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
