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

  /* Both read-mode fallbacks are shared in different ways, but the notes marker belongs
     to ONE slide while localStorage holds whatever was bound last anywhere. With the
     cache first, PowerPoint on the web (where settings.get returns null while presenting
     — office-js#3406, the case this chain exists for) showed the SAME question on every
     slide. Order is only reachable when settings are null, so desktop is unaffected. */
  {
    const guard = c.indexOf("if (view !== 'read') return null;");
    const notes = c.indexOf('await readNotesBinding()', guard);
    const cache = c.indexOf('readCachedBinding()', guard);
    ok('the per-slide notes marker is tried before the shared cache',
       notes > -1 && cache > -1 && notes < cache);
  }
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
  /* The phase word itself, and the claim that other surfaces follow it, are now
     checked against presenter.html and companion.html directly — see the vocabulary
     block at the end of this file. Here we only assert a reveal is published at all. */
  ok('reveal publishes the phase', /qstate\/'\+qid\+'\/phase'\)\.set\('revealed'\)/.test(c));
  ok('a failed write still reveals on this slide', /showing it locally anyway/.test(c));

  // 2. no way to reveal without a timer
  ok('a manual Reveal now button exists', /function addRevealButton\(/.test(c));
  ok('it is removed once revealed, however that happened', /getElementById\('psReveal'\)\?\.remove\(\)/.test(c));

  /* 3. phones stayed on the previous question — and all three fixes for it were wrong.
     Publishing currentQuestion from this object is now FORBIDDEN, and these assertions
     are deliberately inverted from the ones they replace.

     Reported 2026-09-22 from a real session: the phone cycled between questions, then
     stopped registering answers at all — for the presenter and for a second phone — and
     presenter view stopped seeing them too. Cause: inside PowerPoint every add-in frame
     reports itself visible, so the object on every slide reclaimed currentQuestion every
     2.5s. answer.html follows that node, and goToQuestion() resets `answered` and swaps
     STABLE_QID mid-flight, so submitted answers landed in a bucket nobody was reading.

     The old behaviour passed its own tests and still destroyed live answers. What is
     guarded here is therefore the ABSENCE of it. Do not "restore" these. */
  ok('the add-in never references currentQuestion in a database path',
     !/ref\([^)]*currentQuestion/.test(c));
  ok('no claim / reclaim machinery survives',
     !/publishWhenVisible|_stopClaim|isOnScreen|meRef/.test(c));

  /* Written as a sweep rather than one fixed string so it keeps holding if the writes
     are refactored: ANY future session write that is not question-scoped fails this. */
  const sessionWrites = [...c.matchAll(/db\.ref\('sessions\/[^)]*\)/g)]
    .filter(m => /^\s*\.(set|update|remove|push)\(/
      .test(c.slice(m.index + m[0].length, m.index + m[0].length + 40)))
    .map(m => m[0]);
  ok('there is at least one session write to check', sessionWrites.length > 0);
  ok('every session write is scoped to this question\'s own qstate node',
     sessionWrites.every(r => /\/qstate\/'\+qid/.test(r)));

  ok('the launch write announces this question only',
     /\.update\(\{ phase:'live', launchedAt: _launchedAt \}\)/.test(c));
  ok('edit view writes nothing to the session at all',
     /if \(!editing && _announced !== qid\) \{[\s\S]{0,160}?qstate\/'\+qid/.test(c));

  /* The reclaim loop is what turned a wrong guess into a repeating one. A timer that
     writes is the shape of that bug, so the tick is checked for database access. */
  const tick = c.slice(c.indexOf('_tick = setInterval('));
  ok('the repeating tick never writes to the database',
     !/db\.ref/.test(tick.slice(0, tick.indexOf('}, 1000);'))));

  ok('the reason is recorded where the next person will look',
     /WHY THIS OBJECT NEVER WRITES sessions\/<code>\/currentQuestion/.test(c));
  /* Superseded. That fix made the clock start on load so it would not wait for the
     publish round-trip — but starting on load was itself the bug: it ran down while
     the room was still reading. The clock now keys off _answerAt, so launchedAt no
     longer gates it at all. See the per-run block below. */
  ok('launchedAt is set locally, not awaited from the database', /_launchedAt = Date\.now\(\);/.test(c));
}

console.log('\nThe reveal is per-run, and the clock waits for the room');
{
  const c = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');

  /* Reported 2026-09-22: "always revealed, and no way to force the counter to start
     after the first answer or reveal now". Three compounding causes:
       1. phase:'reveal' is STICKY in qstate — once revealed, forever revealed, so
          re-presenting the deck came up already showing the answer
       2. the clock ran from launchedAt, so a launchedAt left by an earlier run was
          already expired and it revealed the instant the slide appeared
       3. .on('value') echoes the stored phase immediately, re-revealing a fresh run */

  ok('a run never inherits a previous reveal', /Presenting is not resuming/.test(c));
  /* `post` joined `revealed` when post-reveal landed; BOTH must reset, or a re-present
     would come up on the leaderboard instead of the question. */
  ok('revealed and post both start false every run', /let revealed = false, post = false;\s*\n\s*_answerAt = 0;/.test(c));

  /* Matches powerpoint.html: "responses.length > 0 && !revealArmed && !revealed". */
  ok('the clock measures from the first answer, not launch', /_revealSecs - Math\.floor\(\(Date\.now\(\) - _answerAt\)/.test(c));
  ok('it arms once per run on the first answer', /if \(latest\.length > 0 && !_answerAt && !revealed\) _answerAt = Date\.now\(\)/.test(c));
  ok('no answers means no countdown at all', /waiting for the first answer/.test(c));

  ok('the initial phase echo is ignored', /let _echo = true;/.test(c) && /if \(_echo\)\{ _echo = false; return; \}/.test(c));
  ok('going live clears a stale reveal for other surfaces too', /phase:'live', launchedAt/.test(c));
  ok('manual reveal stays available until something reveals', /function addRevealButton\(/.test(c));
}

console.log('\nWord clouds and ratings draw properly, not as a raw list');
{
  const c = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');
  ok('word_cloud displayMode is routed', /q\.displayMode === 'word_cloud'/.test(c));
  ok('rating type is routed', /q\.type === 'rating'/.test(c));
  ok('stop words are stripped', /STOP_WORDS/.test(c));
  ok('word size tracks frequency', /w\.c\/max/.test(c));
  /* Math.random() reshuffled the whole cloud on every incoming answer, which on a
     projector reads as the slide glitching. The scatter is index-derived instead. */
  ok('the cloud does not reshuffle on each answer', !/\.sort\(\(\)=>Math\.random/.test(c) && /\(i \* 37\) % 15/.test(c));
  ok('ratings show an average', /Average \$\{avg\}/.test(c));
  ok('free text still falls back to listing answers', /class="free"/.test(c));

  /* These renderers were PORTED into the content add-in. The shared audience page and
     the other presenter surfaces must stay untouched — that was the explicit ask. */
  const answer = fs.readFileSync(path.resolve(__dirname, '..', '..', 'answer.html'), 'utf8');
  ok('answer.html still auto-submits single choice and asks Submit for multi',
     /isMulti \? `<button class="btn btn-primary" id="submitBtn"/.test(answer));
  ok('answer.html still remembers a name per session', /ql_pname_\$\{SESSION\}/.test(answer));
}

console.log('\nPost-reveal: the screen after the answer');
{
  const c = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');
  ok('all four types are handled', ['leaderboard','podium','scorecard','explainer'].every(t2 => c.includes("'"+t2+"'")));
  ok('leaderboard is the default', /\|\| 'leaderboard'/.test(c));
  /* Re-gating on postReveal.enabled at render time is what made post-reveal silently
     not appear on the companion (fixed there in v65). Nothing reaches this phase
     unless it was enabled. */
  ok('the phase is honoured without re-checking enabled', /without re-checking postReveal\.enabled/.test(c));
  ok('enabled is still what ARMS it', /if \(!pr \|\| !pr\.enabled \|\| post\) return;/.test(c));
  ok("advanceDelay 'manual' never auto-advances", /if \(!isFinite\(d\) \|\| d <= 0\) return;/.test(c));
  ok('a numeric delay publishes postRevealAt for other surfaces', /postRevealAt: Date\.now\(\) \+ d\*1000/.test(c));
  ok('an externally driven post_reveal is followed', /ph === 'post_reveal' && !post/.test(c));
  ok('the pending timer is cleared when the object is torn down', /clearTimeout\(_prTimer\); _prTimer = null; \};/.test(c));

  /* companion.html indexes heights by RANK as ['60px','90px','44px'], so SECOND place
     gets the tallest podium. Ported faithfully, spotted in a screenshot, fixed here
     only — the companion ships to the Mac app and is not ours to change today. */
  ok('the podium winner is tallest', /const h = \['100%','62%','44%'\]/.test(c));
}

console.log('\nThe question on the slide is never a cached copy');
{
  const c = fs.readFileSync(path.resolve(__dirname, '..', '..', 'powerpoint-content', 'index.html'), 'utf8');
  /* The binding stores a SNAPSHOT of the question taken when it was chosen. Reading it
     froze the slide at that moment: turning post-reveal on in the presenter never
     reached the slide, so post-reveal "never showed up". */
  ok('the deck is refetched every time', /let q = null;\s*\n\s*try \{\s*\n\s*const s = await db\.ref\('quiz_builder\/'/.test(c));
  ok('the snapshot is only a fallback', /if \(!q\) q = b\.q;/.test(c));
  ok('the reason is recorded', /postReveal\.enabled false from before it was turned on/.test(c));
}

console.log('\nThe slide speaks the same phase vocabulary as the rest of the product');
{
  const root = path.resolve(__dirname, '..', '..');
  const c   = fs.readFileSync(path.join(root, 'powerpoint-content', 'index.html'), 'utf8');
  const pres = fs.readFileSync(path.join(root, 'presenter.html'), 'utf8');
  const comp = fs.readFileSync(path.join(root, 'companion.html'), 'utf8');

  /* Found 2026-09-22 auditing why presenter view "did not detect answers". This one was
     not the cause, but it meant reveal never propagated in EITHER direction: this file
     wrote phase 'reveal' while presenter.html writes 'revealed' and companion.html tests
     for 'revealed'. A presenter reveal left the slide counting; a slide reveal left the
     companion counting. Two surfaces, one vocabulary — so the check reads both files
     rather than hard-coding the word here. */
  ok('presenter still writes the phase word this test is anchored to',
     /phase: 'revealed'/.test(pres));
  ok('the companion still tests for it', /presentPhase === 'revealed'/.test(comp));
  ok('the slide writes that same word', /qstate\/'\+qid\+'\/phase'\)\.set\('revealed'\)/.test(c));
  ok('the slide no longer writes the private one', !/\.set\('reveal'\)/.test(c));
  ok('it still accepts the old spelling left in existing sessions',
     /ph === 'revealed' \|\| ph === 'reveal'/.test(c));

  /* An undetached listener kept the dead run's closure alive: it repainted over the live
     run, re-armed its tick, and clobbered the shared _prTimer. */
  ok('the phase listener is detachable', /_phaseOff = \(\) => phRef\.off\('value', phFn\)/.test(c));
  ok('and is detached with the rest of the run', /if \(_phaseOff\)\{ _phaseOff\(\); _phaseOff = null; \}/.test(c));

  /* goLive re-enters on every ActiveViewChanged. Re-stamping phase:'live' dragged the
     companion back to "answering" after the presenter had already revealed. */
  ok('a question is announced once per page-load', /if \(!editing && _announced !== qid\) \{/.test(c));
  ok('the guard is actually set', /_announced = qid;/.test(c));
  ok('first sight still announces, so a stale reveal cannot deadlock the slide',
     /clears a stale 'revealed' left/.test(c));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
