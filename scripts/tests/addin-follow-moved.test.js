#!/usr/bin/env node
/* PollSlide LIVE follows a MOVED question (question reordering A1, 2026-10-06).
 *
 * The add-in remembers its question by position (qIdx) and identity (qid = the response
 * bucket). Before A1, moving questions in the presenter made a slide show the question now
 * sitting at that position over the ORIGINAL question's answers. This runs the REAL page in
 * headless Chrome (Office + Firebase stubbed) and proves:
 *   • a deck that was never reordered behaves exactly as before (no extra read);
 *   • a moved question is found by its id: right text, right answers, binding updated, and
 *     phones are told its real position + link number;
 *   • a deleted question says "Question not found" instead of showing a stranger;
 *   • old decks without ids, and an unreadable deck, keep their previous behaviour;
 *   • a slide-notes marker (a LINK number) is resolved through quiz_builder/$code/homes.
 * Skips the browser part (passes) if Chrome is absent.
 * Run: node scripts/tests/addin-follow-moved.test.js */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 600) : '')));
const page = fs.readFileSync(path.join(ROOT, 'powerpoint-content', 'index.html'), 'utf8');
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
console.log('\nPollSlide LIVE: follows a moved question');
if (!CHROME) { console.log('  (Chrome not found — browser checks skipped)\n\n0 passed, 0 failed'); process.exit(0); }
const qidJs = fs.readFileSync(path.join(ROOT, 'qid.js'), 'utf8');

const STUB = `<script>
const S = __S__;
window.__log = { gets:[], ons:[], set:[], pub:null };
window.Office = { AsyncResultStatus:{ Succeeded:'succeeded' }, EventType:{ ActiveViewChanged:'avc' },
  onReady(fn){ setTimeout(fn, 0); },
  context:{ displayLanguage:'en-US', partitionKey:'t',
    document:{ getActiveViewAsync(cb){ cb({ status:'succeeded', value:S.view }); }, addHandlerAsync(){},
      settings:{ get(){ return S.binding || null; }, set(k, v){ __log.set.push(JSON.parse(JSON.stringify(v))); }, saveAsync(){} } } } };
window.PowerPoint = { run(fn){
  if (S.notes == null) return Promise.reject(new Error('no'));
  const ctx = { presentation:{ getSelectedSlides:() => ({ load(){}, items:[{ getNotesPage:() => ({ body:{ load(){}, text:S.notes } }) }] }) }, sync: async () => {} };
  return Promise.resolve(fn(ctx)); } };
try { if (S.cached) localStorage.setItem('psliveBind_t', JSON.stringify(S.cached)); else localStorage.removeItem('psliveBind_t'); } catch(e){}
function val(p){
  const m = p.match(/^quiz_builder\\/(\\w+)\\/(questions|homes)(?:\\/(\\d+))?$/);
  if (!m) return undefined;
  if (m[2] === 'homes') return S.homes == null ? undefined : S.homes;
  if (m[3] == null) return S.failAll ? '__FAIL__' : (S.questions && S.questions.length ? S.questions : undefined);   // RTDB: no empty arrays
  return S.questions ? S.questions[Number(m[3])] : undefined;
}
function ref(p){ return {
  get: async () => { __log.gets.push(p); const v = val(p); if (v === '__FAIL__') throw new Error('offline');
    return { exists:()=>v !== undefined && v !== null, val:()=>v }; },
  on(ev, fn){ __log.ons.push(p); setTimeout(() => fn({ exists:()=>false, val:()=>null }), 0); return fn; }, off(){},
  set: async () => {}, update: async () => {},
  transaction: async f => { const v = f(null); if (p.endsWith('/currentQuestion')) __log.pub = v; return { committed:true }; } }; }
window.firebase = { initializeApp(){}, database: () => ({ ref }),
  auth: () => ({ currentUser:null, onAuthStateChanged(fn){ setTimeout(() => fn(null), 0); return () => {}; }, signOut: async () => {} }) };
</script>`;
const DRIVER = `<script>setTimeout(() => { const r = document.getElementById('root');
  const out = { text:(r ? r.textContent : '').replace(/\\s+/g, ' ').trim(), log: __log };
  const pre = document.createElement('pre'); pre.id = '__out'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre); }, 1200);</script>`;
function run(s) {
  const html = page.replace(/<script src="\/errors\.js[^"]*"><\/script>/, '')
    .replace(/<script src="\/qid\.js[^"]*"><\/script>/, '<script>' + qidJs + '</script>')
    .replace(/<script src="https:\/\/appsforoffice[^"]*"[^>]*><\/script>/, STUB.replace(/__S__/g, JSON.stringify(s)))
    .replace(/<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>/g, '')
    .replace(/<\/body>/, DRIVER + '</body>');
  const f = path.join(os.tmpdir(), 'pslive-move-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.html');
  fs.writeFileSync(f, html);
  try {
    const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=8000', '--dump-dom', 'file://' + f],
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    const x = dom.match(/<pre id="__out">([\s\S]*?)<\/pre>/);
    return x ? JSON.parse(x[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) : { text: '', log: { gets: [], ons: [], set: [] } };
  } finally { fs.unlinkSync(f); }
}

// A deck after link numbers: A, B, C with homes 0, 1, 2.
const A = { id: 'qzAAA', home: 0, text: 'Alpha question?', type: 'multiple_choice', options: ['a1', 'a2'], revealDelay: -1 };
const B = { id: 'qzBBB', home: 1, text: 'Bravo question?', type: 'multiple_choice', options: ['b1', 'b2'], revealDelay: -1 };
const C = { id: 'qzCCC', home: 2, text: 'Charlie question?', type: 'multiple_choice', options: ['c1', 'c2'], revealDelay: -1 };
const bindB = { code: 'TEST1', qIdx: 1, qid: 'qzBBB_TEST1', text: B.text, q: B };
const resp = r => r.log.ons.filter(p => p.includes('/responses/'));
const fullReads = r => r.log.gets.filter(p => p === 'quiz_builder/TEST1/questions').length;

let r = run({ view: 'read', binding: bindB, questions: [A, B, C], homes: { 0: 0, 1: 1, 2: 2 } });
ok('never reordered: shows its question, reads its answers — exactly as before', /Bravo question\?/.test(r.text) && resp(r).join() === 'sessions/TEST1/responses/qzBBB_TEST1', r);
// (Re-saving the binding unchanged on load is old behaviour — resolveBinding caches it.)
ok('never reordered: no extra read of the whole deck, binding unchanged', fullReads(r) === 0 && r.log.set.every(v => v.qIdx === 1 && v.qid === 'qzBBB_TEST1'), r.log);
ok('presenting tells phones its position AND link number', r.log.pub && r.log.pub.id === 'qzBBB_TEST1' && r.log.pub.qIndex === 1 && r.log.pub.home === 1, r.log.pub);

// B moved to the end: [A, C, B]
r = run({ view: 'read', binding: bindB, questions: [A, C, B], homes: { 0: 0, 2: 1, 1: 2 } });
ok('moved: the slide still shows ITS question (not the one now in its old place)', /Bravo question\?/.test(r.text) && !/Charlie/.test(r.text), r.text);
ok('moved: it still reads its own answers', resp(r).join() === 'sessions/TEST1/responses/qzBBB_TEST1', resp(r));
ok('moved: the binding is updated to the new position', r.log.set.some(v => v.qIdx === 2 && v.qid === 'qzBBB_TEST1'), r.log.set);
ok('moved: phones are sent to the new position, with the unchanged link number', r.log.pub && r.log.pub.qIndex === 2 && r.log.pub.index === 3 && r.log.pub.home === 1 && r.log.pub.text === 'Bravo question?', r.log.pub);

r = run({ view: 'edit', binding: bindB, questions: [B, A, C], homes: { 1: 0, 0: 1, 2: 2 } });
ok('moved, while editing: right question, binding updated', /Bravo question\?/.test(r.text) && r.log.set.some(v => v.qIdx === 0), [r.text, r.log.set]);

// B deleted: [A, C]
r = run({ view: 'read', binding: bindB, questions: [A, C], homes: { 0: 0, 2: 1 } });
ok('deleted: says "Question not found" — never shows another question', /Question not found/.test(r.text) && !/Charlie|Alpha/.test(r.text), r.text);
ok('deleted: nothing is published to phones, no answers read', !r.log.pub && resp(r).length === 0, r.log);

r = run({ view: 'read', binding: { code: 'TEST1', qIdx: 1, qid: 'qzBBB_TEST1', text: B.text, q: B }, questions: null, homes: null });
ok('deck gone (no questions at all): the saved question, as before — not "not found"', /Bravo question\?/.test(r.text) && resp(r).join() === 'sessions/TEST1/responses/qzBBB_TEST1', r);
r = run({ view: 'read', binding: bindB, questions: [A, C, B], failAll: true });
ok('deck cannot be read: falls back to the question saved on the slide (right text, right answers)', /Bravo question\?/.test(r.text) && resp(r).join() === 'sessions/TEST1/responses/qzBBB_TEST1', r);

// An old deck: no ids, no homes. Bucket is positional, binding made by position.
const L0 = { text: 'Legacy zero?', type: 'multiple_choice', options: ['x', 'y'], revealDelay: -1 };
const L1 = { text: 'Legacy one?', type: 'multiple_choice', options: ['x', 'y'], revealDelay: -1 };
r = run({ view: 'read', binding: { code: 'TEST1', qIdx: 1, qid: 'q1_stable_TEST1', text: L1.text, q: L1 }, questions: [L0, L1] });
ok('old deck without ids: unchanged (by position, no extra read)', /Legacy one\?/.test(r.text) && resp(r).join() === 'sessions/TEST1/responses/q1_stable_TEST1' && fullReads(r) === 0, r);
ok('old deck: link number = position', r.log.pub && r.log.pub.home === 1 && r.log.pub.qIndex === 1, r.log.pub);
// The same old deck after the presenter backfilled ids (q1_stable) and moved it to the front.
r = run({ view: 'read', binding: { code: 'TEST1', qIdx: 1, qid: 'q1_stable_TEST1', text: L1.text, q: L1 },
  questions: [Object.assign({ id: 'q1_stable', home: 1 }, L1), Object.assign({ id: 'q0_stable', home: 0 }, L0)], homes: { 1: 0, 0: 1 } });
ok('old deck, ids added then moved: still its question and its answers', /Legacy one\?/.test(r.text) && resp(r).join() === 'sessions/TEST1/responses/q1_stable_TEST1' && r.log.set.some(v => v.qIdx === 0), r);

console.log('\nPollSlide LIVE: slide-notes marker (a link number) while presenting');
r = run({ view: 'read', binding: null, notes: 'Speaker notes <!-- pollslide:TEST1/1 -->', questions: [A, C, B], homes: { 0: 0, 2: 1, 1: 2 } });
ok('marker /1 after B moved to the end → B (resolved through homes)', /Bravo question\?/.test(r.text) && resp(r).join() === 'sessions/TEST1/responses/qzBBB_TEST1', r);
r = run({ view: 'read', binding: null, notes: '<!-- pollslide:TEST1/1 -->', questions: [A, B, C] });
ok('marker on a deck with no homes map → the number is the position, as before', /Bravo question\?/.test(r.text), r.text);
r = run({ view: 'read', binding: null, notes: '<!-- pollslide:TEST1/1 -->', questions: [A, C], homes: { 0: 0, 2: 1 } });
ok('marker for a deleted question → not shown as another question', !/Charlie/.test(r.text), r.text);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
