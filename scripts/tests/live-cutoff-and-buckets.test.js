/* Two production bugs found 2026-09-22, both of the same family: a value that decides
 * which answers "count" was derived in two places that disagreed.
 *
 * These run the REAL source extracted from presenter.html / present.html rather than a
 * paraphrase, so they fail if the shipped code drifts — a restated copy of the logic
 * would happily keep passing while the product broke.
 *
 * Several assertions here guard against the FIX, not just the bug: the first attempt at
 * each of these was red-teamed and found to introduce something worse. Those are marked
 * REGRESSION GUARD and should not be relaxed.
 *
 * Run: node scripts/tests/live-cutoff-and-buckets.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

/* ───────────────────────────────────────────────────────────────────────────
   BUG A — a presenter reload restarted the live cutoff, so answers already given
   were filtered out by listenResponses and the tally read 0 while the answers sat
   in the database. launchQuestion kept the cutoff in the in-memory _qLaunchedAt map,
   which a reload wipes.
   ───────────────────────────────────────────────────────────────────────── */
console.log('\nBUG A — the live cutoff survives a reload, but never outlives the run');
{
  const src = read('presenter.html');
  const pane = read('powerpoint.html');

  /* A missing block means the fix was reverted or refactored past. Report it rather
     than throw — a crash here would take the rest of the file's assertions with it and
     read as "no coverage". */
  const grab = (re, label) => { const m = src.match(re); ok('presenter.html still has: ' + label, !!m); return m ? m[0] : null; };
  const LAUNCH = grab(/const runKey = 'ql_runStart_' \+ qId;[\s\S]*?const launchedAt = _qLaunchedAt\[qId\];/, 'the launchQuestion cutoff');
  const FILTER = grab(/const responses = allResponses\.filter\(r => \(r\.submittedAt \|\| 0\) >= liveStartedAt\);/, 'the listenResponses filter');

  ok('the cutoff is no longer kept in memory only',
     !/_qLaunchedAt\[qId\] = _qLaunchedAt\[qId\] \|\| Date\.now\(\)/.test(src));

  /* REGRESSION GUARD — the first attempt keyed this off ql_liveStart_<code>_<idx>.
     That key is per-INDEX and is remapped by neither moveQ nor deleteQ, so reordering
     questions mid-session would have handed a question its neighbour's cutoff. It is
     also written by powerpoint.html:492 under the identical name, which would have made
     the presenter silently inherit the add-in's timestamp. Stay keyed by qId. */
  ok('the run cutoff is keyed by question id, not by index', /'ql_runStart_' \+ qId/.test(src));
  ok('launchQuestion does not read the per-index key',
     !!LAUNCH && !/ql_liveStart_/.test(LAUNCH));
  ok('the PowerPoint pane keeps its own separate key', /ql_liveStart_\$\{code\}_\$\{idx\}/.test(pane));

  if (!LAUNCH || !FILTER) { console.log('  … skipping the runtime cutoff checks'); }
  else {
    // Run the real block against a fake tab.
    const run = (tab, mem, qId, now) => new Function('TAB', 'MEM', 'qId', 'NOW', `
        const sessionStorage = TAB; let _qLaunchedAt = MEM;
        const Date = { now: () => NOW };
        ${LAUNCH}
        return { launchedAt, mem: _qLaunchedAt };`)(tab, mem, qId, now);
    const counted = (cutoff, rows) =>
      new Function('allResponses', 'liveStartedAt', `${FILTER} return responses.length;`)(rows, cutoff);
    const tabStore = () => { const o = {}; return { getItem: k => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: k => { delete o[k]; }, _o: o }; };

    const QID = 'qzmtseycnxb9ork_XZESB7L';
    const answers = [{ submittedAt: 1200 }, { submittedAt: 1400 }, { submittedAt: 1600 }];

    const tab = tabStore();
    const a = run(tab, {}, QID, 1000);
    ok('while live, every answer is counted', counted(a.launchedAt, answers) === 3, counted(a.launchedAt, answers));

    // reload of the SAME tab: the in-memory map is gone, sessionStorage survives
    const b = run(tab, {}, QID, 5000);
    ok('a reload keeps the same cutoff', b.launchedAt === a.launchedAt, { before: a.launchedAt, after: b.launchedAt });
    ok('a reload still counts the answers already given', counted(b.launchedAt, answers) === 3, counted(b.launchedAt, answers));

    /* REGRESSION GUARD — "presenting is not resuming". The first attempt persisted to
       localStorage, which is permanent and is also stamped merely by clicking a question
       in the editor. Presenting on Tuesday then adopted Monday's cutoff and counted
       Monday's class: the chart was pre-populated, and because beginRevealCountdown is
       gated on the POST-filter count, the answer auto-revealed on slide entry. */
    const freshTab = tabStore();
    const c = run(freshTab, {}, QID, 1000 + 86400000);
    ok('a NEW presentation does not adopt an earlier run\'s cutoff', c.launchedAt > 1600, c.launchedAt);
    ok('and therefore does not count the previous session\'s answers', counted(c.launchedAt, answers) === 0);
  }

  /* A reset has to clear every store, or _qLaunchedAt keeps the pre-reset value and the
     next launch re-publishes the OLD launchedAt to currentQuestion/qstate — which
     companion.html and live.html adopt as their own cutoff, bringing the answers you
     just cleared back onto the Mac companion. */
  const reset = src.match(/async function resetQuestionTally[\s\S]*?\n\}/);
  ok('presenter.html still has: resetQuestionTally', !!reset);
  if (reset) {
    ok('a reset clears the persisted per-index start', /localStorage\.setItem\(`ql_liveStart_/.test(reset[0]));
    ok('a reset clears the in-memory map too', /delete _qLaunchedAt\[stableQId\]/.test(reset[0]));
    ok('a reset clears this run\'s cutoff too', /removeItem\('ql_runStart_' \+ stableQId\)/.test(reset[0]));
  }
}

/* ───────────────────────────────────────────────────────────────────────────
   BUG B — present.html wrote quiz_builder questions with their `id` stripped, while
   publishPresentSlide published the bucket derived FROM that id. Readers of
   quiz_builder (companion.html QR-targeted mode, the PowerPoint content add-in)
   therefore watched the positional bucket while phones answered into the id bucket.
   ───────────────────────────────────────────────────────────────────────── */
console.log('\nBUG B — a question keeps one identity everywhere present.html publishes it');
{
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(read('qid.js'), ctx);
  const PSQid = ctx.window.PSQid;

  const present = read('present.html');
  const m = present.match(/const _qid = \(s\.question\.id[\s\S]*?noTranslate: !!s\.question\.noTranslate \}; \}\);/);
  ok('present.html still has: the go-live question map', !!m);

  /* A copy used to keep the original's question.id: two slides, one response bucket,
     one shared tally — and a copy of an IMPORTED question inherited an id from another
     deck's index space, which can collide with an unrelated question in this deck. */
  ok('a duplicated slide gets its own question id', /function duplicateSlide\(\)[^\n]*_freshQid\(c\)/.test(present));
  ok('a pasted slide does too', /Paste slide[\s\S]{0,200}?_freshQid\(c\)/.test(present));
  ok('and the new id is a fresh one, not an index-derived one', /_freshQid[\s\S]{0,260}?PSQid\.fresh/.test(present));

  if (!m) { console.log('  … skipping the bucket-agreement checks'); }
  else {
    const MAP = 'const questions = live.map((s,i)=>{ s.question=s.question||{}; s.question.sessionCode=code; s.question.qIndex=i;\n' + m[0];
    const CODE = 'ABC1234';
    const stored = q => new Function('live', 'code', 'plain', 'PSQid', `${MAP} return questions;`)(
      [{ kind: 'poll', question: q }], CODE, s => s, PSQid)[0];

    // The property that matters: what phones write to == what readers look in.
    const agrees = q => PSQid.bucket(q, 0, CODE) === PSQid.bucket(stored(q), 0, CODE);

    ok('a question with a fresh id agrees',
       agrees({ id: 'qzmtseycnxb9ork', text: 'Q', type: 'multiple_choice', options: [{ text: 'A' }], correctAnswer: 0 }));
    ok('a question that never had an id agrees, exactly as before',
       agrees({ text: 'Q', type: 'multiple_choice', options: [{ text: 'A' }], correctAnswer: 0 }));

    /* REGRESSION GUARD — a legacy 'q<n>_stable' id encodes a position in ANOTHER deck's
       array. Re-emitting it here would derive q<n>_stable_<thisCode> and collide with
       whatever native question sits at index n in THIS deck. It is redundant anyway:
       an absent id already derives the identical positional key. */
    ok('a legacy positional id is NOT carried across decks',
       stored({ id: 'q3_stable', text: 'Q' }).id === undefined,
       stored({ id: 'q3_stable', text: 'Q' }).id);
    ok('so a legacy-id question still resolves positionally, as it always did',
       PSQid.bucket(stored({ id: 'q3_stable', text: 'Q' }), 0, CODE) === 'q0_stable_' + CODE);

    ok('an id-less question still resolves to its legacy positional bucket',
       PSQid.bucket(stored({ text: 'Q' }), 3, CODE) === 'q3_stable_' + CODE,
       PSQid.bucket(stored({ text: 'Q' }), 3, CODE));

    ok('the go-live map never mints an id', !/PSQid\.(fresh|backfill)/.test(m[0]));

    const study = new Function('live', 'code', 'plain', 'PSQid', `${MAP} return questions;`)(
      [{ kind: 'study', question: { id: 'qzstudy1', front: 'F', back: 'B' } }], CODE, s => s, PSQid)[0];
    ok('the flashcard branch carries its id too', study.id === 'qzstudy1', study);
  }

  ok('present.html still publishes the bucket from the slide question',
     /id: PSQid\.bucket\(q, idx, code\)/.test(present));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
