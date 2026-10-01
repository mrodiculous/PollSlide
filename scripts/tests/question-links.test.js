#!/usr/bin/env node
/* Question links follow their question (2026-10-01).
 *
 * A QR code / answer link is answer#CODE/<n>, where <n> is the question's LINK NUMBER
 * (qid.js "home") — its position until the deck is reordered or a question deleted, then
 * fixed to the question. The rules themselves are tested in qid.test.js; this file locks
 * the WIRING in every surface that makes or reads a link, and runs the presenter's
 * live-pointer update (A2) against a fake database. Verified end to end on the demo stage
 * (move the live question, old QR after a move, delete, deleted-question QR, a deck with
 * no link numbers, the Mac companion page, copy to an un-numbered deck).
 * Run: node scripts/tests/question-links.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')));
const grab = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) return '';
  let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; } return src.slice(i, j + 1); };

const P = read('presenter.html'), A = read('answer.html'), C = read('companion.html'), O = read('overlay.html'),
      S = read('present.html'), T = read('powerpoint.html');

console.log('\nPresenter — makes the links, keeps the live pointer on the right question');
ok('every question link uses its link number', /return `\$\{BASE_URL\}#\$\{code\}\/\$\{PSQid\.homeOf\(questions\[idx\], idx\)\}`/.test(P));
ok('no presenter link is built from a bare position', !/answer#\$\{[^}]*sessionCode[^}]*\}\/\$\{idx\}`/.test(P) && !/`\$\{BASE_URL\}#\$\{code\}\/\$\{idx\}`/.test(P));
ok('numbers are assigned when decks load, and saved with the ids', /const homed = PSQid\.ensureHomes\(qarr\);\s*if \(PSQid\.backfill\(qarr\) \|\| migrated \|\| homed\)/.test(P));
ok('numbers are assigned on open and on every save', /questions = toQArr\(pres\.questions\);\s*PSQid\.ensureHomes\(questions\);/.test(P) && /PSQid\.ensureHomes\(Array\.isArray\(pres\.questions\)/.test(P));
ok('the homes map is published with the questions (open + save + copy)', (P.match(/quiz_builder\/\$\{[^}]+\}\/homes`\)\.set\(PSQid\.homesMap/g) || []).length === 3);
ok('the live pointer moves only AFTER the new order is published', /\/questions`\)\.set\(pres\.questions\);[\s\S]{0,200}\/homes`\)\.set\([\s\S]{0,600}syncLivePosition\(pres\.sessionCode, pres\.questions\)/.test(P));
ok('both "question is live" payloads carry the link number', (P.match(/total: questions\.length, home: PSQid\.homeOf\(q, idx\)/g) || []).length === 2);
ok('move, delete and undo re-point the live question by id (and keep the old position rule when no id was saved)',
   /if \(liveQId\) resyncLiveIdx\(\);\s*else if \(liveQIdx===idx\) liveQIdx=ni;/.test(grab(P, 'moveQ'))
   && /else if \(liveQId\) resyncLiveIdx\(\);\s*else if \(liveQIdx>idx\) liveQIdx--;/.test(grab(P, 'deleteQ'))
   && /selIdx=idx; resyncLiveIdx\(\);/.test(grab(P, 'deleteQ')));
ok('a pending "not available" re-check is cancelled once the phone moves to a question', /clearTimeout\(_waitRetry\);\s*\/\/ a pending re-check/.test(A) && /if \(!_linkResolved\) loadQuestion\(\);/.test(A));
ok('a collaborator\'s reorder keeps the live pointer and the selection on the same question', /questions = remoteQs;\s*PSQid\.ensureHomes\(questions\);\s*_orderSig = orderSignature\(\);\s*resyncLiveIdx\(\);/.test(P) && /selId \? questions\.findIndex/.test(P));
ok('a copied question drops its old number and gets one in its new deck', /delete q\.home;[\s\S]{0,400}PSQid\.ensureHomes\(targetQs\);\s*targetQs\.push\(q\);\s*PSQid\.ensureHomes\(targetQs\);/.test(P));
ok('"session started" times are keyed by question, not position (A3)', /const startKey = liveStartKey\(stableQId\);/.test(P) && !/localStorage\.setItem\(`ql_liveStart_/.test(P));

// syncLivePosition against a fake db: update() only, never set(); only position fields.
{
  const code = 'ABC1234', writes = [];
  const qs = [{ id: 'qa', home: 0 }, { id: 'qc', home: 2 }, { id: 'qb', home: 1 }];
  const db = { ref: p => ({
    get: async () => ({ val: () => ({ id: 'qc_' + code, qIndex: 2, index: 3, total: 3, home: 2, phase: 'revealed', launchedAt: 111, text: 'C' }) }),
    update: async o => writes.push(['update', p, o]), set: async o => writes.push(['set', p, o]) }) };
  const ctx = { db, window: {}, console };
  vm.createContext(ctx); vm.runInContext(read('qid.js'), ctx);
  ctx.PSQid = ctx.window.PSQid;
  vm.runInContext('async ' + grab(P, 'syncLivePosition'), ctx);
  (async () => {
    await ctx.syncLivePosition(code, qs);
    const w = writes[0] || [];
    ok('A2: the live question moved → ONE update of its position (never set)', writes.length === 1 && w[0] === 'update' && w[1] === `sessions/${code}/currentQuestion`, writes);
    ok('A2: only qIndex/index change — its reveal phase, timer and link number are untouched', w[2] && w[2].qIndex === 1 && w[2].index === 2 && !('phase' in w[2]) && !('launchedAt' in w[2]) && !('home' in w[2]), w[2]);
    writes.length = 0;
    await ctx.syncLivePosition(code, [{ id: 'qa', home: 0 }, { id: 'qb', home: 1 }, { id: 'qc', home: 2 }]);
    ok('A2: nothing moved → nothing written', writes.length === 0, writes);
    await ctx.syncLivePosition(code, [{ id: 'qa', home: 0 }]);
    ok('A2: the live question was deleted → the pointer is left alone (the next launch replaces it)', writes.length === 0, writes);
    rest();
  })().catch(e => { console.error(e); process.exit(1); });
}

function rest() {
  console.log('\nAnswer page — turns a link number into the question');
  ok('the link number is resolved (quiz_builder/$code/homes) before the first load', /if \(!\(await resolveLink\(\)\)\)/.test(A) && A.indexOf('await resolveLink()') < A.indexOf('quiz_builder/${SESSION}/questions/${Q_INDEX}'));
  ok('an unknown number is NEVER read as a position — it waits and follows the presenter', /renderWaitingForQuestion\(\);\s*followLive\(true\);/.test(A));
  ok('"follow along" compares the question, not the position', /cq\.home != null \? Number\(cq\.home\) === Q_LINK/.test(A));
  ok('the live question moving does not reload it (a half-made selection survives)', /cq\.id && cq\.id === STABLE_QID\) \{\s*Q_INDEX = idx;/.test(A));
  ok('the address bar keeps the link number', /history\.replaceState\(null, '', '#' \+ SESSION \+ '\/' \+ Q_LINK\)/.test(A) && !/'#' \+ SESSION \+ '\/' \+ idx\)/.test(A));
  ok('joining by code lands on the live question\'s link number', /cq\.home != null \? cq\.home : cq\.qIndex/.test(A));
  ok('only one follow listener however often it is asked', /_following\) return;/.test(A) && /_following = true;/.test(A));
  ok('the new message is translated (es/de/fr/pt/it)', ['es', 'de', 'fr', 'pt', 'it'].every(l => new RegExp('I18N\\.' + l + ', \\{ waitingTitle:').test(A)));

  console.log('\nMac companion page, overlay, slideshow editor, side-panel add-in');
  ok('companion: a slide QR number is resolved — every installed Mac app follows a reordered deck', /PSQid\.resolve\(hs && hs\.exists\(\) \? hs\.val\(\) : null, link\)/.test(C));
  ok('companion: its own QR and its publish carry the link number', /#\$\{sessionCode\}\/\$\{curQ\.home != null \? curQ\.home : qIdx\}/.test(C) && /home: \(home != null \? home : qIdx\)/.test(C));
  ok('overlay: the QR uses the published link number (it used to fall back to question 1 for new questions)', /const qIdx = \(_overlayLink != null\) \? _overlayLink : guess;/.test(O));
  ok('slideshow editor: imported slides keep the source question\'s link number', /const ln=PSQid\.homeOf\(qq,qi\);/.test(S));
  ok('slideshow editor: an imported slide tells phones the question\'s CURRENT position', /PSQid\.resolve\(h&&h\.exists\(\)\?h\.val\(\):null, idx\)/.test(S) && /home: idx,/.test(S));
  ok('side-panel add-in: QR, notes marker and auto-detect use link numbers', /PSQid\.homeOf\(questions\[idx\], idx\)/.test(T) && /writeSlideNotesMetadata\(code, link\)/.test(T) && /const pos = PSQid\.resolve\(homes, qIdx\);/.test(T));
  ok('PollSlide LIVE (in Microsoft review) is untouched', !/homes/.test(read('powerpoint-content/index.html')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
