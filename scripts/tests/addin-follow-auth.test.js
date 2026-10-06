#!/usr/bin/env node
/* PollSlide LIVE: phones follow the slide even when nobody is signed in (2026-10-06).
 *
 * The database accepts the live pointer (sessions/$code/currentQuestion) and qstate only from
 * a signed-in session. The add-in relied on the PowerPoint user being signed in — until Sign
 * out existed: then every slide's publish was refused SILENTLY and phones stopped following
 * (Rod, PowerPoint for the web, 2026-10-06). This stub ENFORCES that rule and proves:
 *   • signed out, presenting → the add-in signs in anonymously, then publishes (phones follow);
 *   • signed in → nothing changes (no anonymous sign-in);
 *   • an anonymous session is never shown as signed in (sign-in screen, no Sign out);
 *   • anonymous sign-in failing never breaks the slide.
 *
 * (Harness shared with addin-follow-moved.test.js.)
 * Original header of the shared harness follows.
 *
 * PollSlide LIVE follows a MOVED question (question reordering A1, 2026-10-06).
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
console.log('\nPollSlide LIVE: phones follow even when nobody is signed in');
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
  // The real rule: sessions/** writes need auth != null. Refused writes reject, like Firebase.
  set: async () => { if (p.startsWith('sessions/') && !AUTH.currentUser) { __log.denied = (__log.denied||0)+1; throw new Error('PERMISSION_DENIED'); } },
  update: async () => { if (p.startsWith('sessions/') && !AUTH.currentUser) { __log.denied = (__log.denied||0)+1; throw new Error('PERMISSION_DENIED'); } },
  transaction: async f => { if (p.startsWith('sessions/') && !AUTH.currentUser) { __log.denied = (__log.denied||0)+1; throw new Error('PERMISSION_DENIED'); }
    const v = f(null); if (p.endsWith('/currentQuestion')) __log.pub = v; return { committed:true }; } }; }
const AUTH = { currentUser: S.user || null, _l:[], anonCalls:0,
  onAuthStateChanged(fn){ this._l.push(fn); setTimeout(() => fn(this.currentUser), 0); return () => {}; },
  async signInAnonymously(){ this.anonCalls++; __log.anon = this.anonCalls; if (S.anonFails) throw Object.assign(new Error('no'), { code:'auth/operation-not-allowed' });
    this.currentUser = { uid:'anon1', isAnonymous:true }; this._l.forEach(f => f(this.currentUser)); return { user:this.currentUser }; },
  async signOut(){ this.currentUser = null; } };
window.firebase = { initializeApp(){}, database: () => ({ ref }), auth: () => AUTH };
</script>`;
const DRIVER = `<script>setTimeout(() => { const r = document.getElementById('root');
  const so = document.getElementById('cSo');
  const out = { text:(r ? r.textContent : '').replace(/\\s+/g, ' ').trim(), log: __log, signInBox: !!document.getElementById('si'),
    cSo: !!so && so.style.display !== 'none', bar: !!document.getElementById('psCtl'), acct: !!document.querySelector('.acct') };
  const pre = document.createElement('pre'); pre.id = '__out'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre); }, 1200);</script>`;
function run(s) {
  const html = page.replace(/<script src="\/errors\.js[^"]*"><\/script>/, '')
    .replace(/<script src="\/qid\.js[^"]*"><\/script>/, '<script>' + qidJs + '</script>')
    .replace(/<script src="https:\/\/appsforoffice[^"]*"[^>]*><\/script>/, STUB.replace(/__S__/g, JSON.stringify(s)))
    .replace(/<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>/g, '')
    .replace(/<\/body>/, DRIVER + '</body>');
  const f = path.join(os.tmpdir(), 'pslive-auth-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.html');
  fs.writeFileSync(f, html);
  try {
    const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=8000', '--dump-dom', 'file://' + f],
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    const x = dom.match(/<pre id="__out">([\s\S]*?)<\/pre>/);
    return x ? JSON.parse(x[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) : { text: '', log: { gets: [], ons: [], set: [] } };
  } finally { fs.unlinkSync(f); }
}


const Q = { id: 'qzBBB', home: 1, text: 'Bravo question?', type: 'multiple_choice', options: ['b1', 'b2'], revealDelay: -1 };
const QS = [{ id: 'qzAAA', home: 0, text: 'Alpha?', type: 'multiple_choice', options: ['a'] }, Q];
const bind = { code: 'TEST1', qIdx: 1, qid: 'qzBBB_TEST1', text: Q.text, q: Q };
const USER = { uid: 'U1', email: 'appsource-review@pollslide.com', isAnonymous: false };

let r = run({ view: 'read', binding: bind, questions: QS, homes: { 0: 0, 1: 1 }, user: null });
ok('signed out, presenting: signs in anonymously, then tells phones the live question', r.log.anon === 1 && r.log.pub && r.log.pub.id === 'qzBBB_TEST1' && r.log.pub.qIndex === 1, r.log);
ok('signed out, presenting: no write was refused', !r.log.denied, r.log.denied);
ok('signed out, presenting: the slide shows its question and results', /Bravo question\?/.test(r.text), r.text);

r = run({ view: 'read', binding: bind, questions: QS, homes: { 0: 0, 1: 1 }, user: USER });
ok('signed in: publishes as before, with no anonymous sign-in', !r.log.anon && r.log.pub && r.log.pub.qIndex === 1, r.log);

r = run({ view: 'read', binding: bind, questions: QS, homes: { 0: 0, 1: 1 }, user: null, anonFails: true });
ok('anonymous sign-in refused: the slide still shows its results (nothing breaks)', /Bravo question\?/.test(r.text), r.text);

r = run({ view: 'edit', binding: null, questions: QS, user: { uid: 'anon1', isAnonymous: true } });
ok('editing with an anonymous session: shows the sign-in screen, not "Signed in as"', r.signInBox && !r.acct, r);
r = run({ view: 'edit', binding: bind, questions: QS, homes: { 0: 0, 1: 1 }, user: { uid: 'anon1', isAnonymous: true } });
ok('editing a linked slide with an anonymous session: no "Sign out" on the toolbar', r.bar && !r.cSo, r);
r = run({ view: 'edit', binding: null, questions: QS, user: null });
ok('editing, signed out: sign-in screen, and no anonymous sign-in just for looking', r.signInBox && !r.log.anon, r);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
