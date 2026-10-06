#!/usr/bin/env node
/* PollSlide LIVE: sign in, sign up AND sign out (Microsoft policy 1100.5.7.1, 2026-10-06).
 *
 * Microsoft returned the first submission because the add-in had no way to sign out. This
 * clicks through the REAL page in headless Chrome (Office and Firebase stubbed) and proves:
 *   • the sign-in screen has a working "Create a free account" link (opens the browser);
 *   • once signed in, "Sign out" is on the presentation list, the question list, and the
 *     editing toolbar of a slide that already shows a question;
 *   • signing out returns to the sign-in screen, and signing back in moves on to the
 *     presentation list (it used to stay stuck on the sign-in box on a linked slide);
 *   • a slide show shows results only: no sign-in, no sign-out.
 * Skips the browser part (passes) if Chrome is absent.
 * Run: node scripts/tests/addin-account-links.test.js */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 500) : '')));
const page = fs.readFileSync(path.join(ROOT, 'powerpoint-content', 'index.html'), 'utf8');
const P = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');

console.log('\nPollSlide LIVE: account links in the code');
ok('sign-up goes to the PollSlide sign-up form', /const SIGNUP_URL = 'https:\/\/app\.pollslide\.com\/presenter\?signup=1';/.test(page));
ok('the presenter opens on "Create your account" for ?signup=1 (and only then)',
  /get\('signup'\) === '1' && authMode === 'signin'[^\n]*toggleAuthMode\(\)/.test(P));
ok('Slide Show (read view) never draws sign-in or sign-out', !/view === 'read'\) \{[^}]*(showSignIn|acctLine|signOut)/.test(page));

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!CHROME) { console.log('  (Chrome not found — browser checks skipped)'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
const qidJs = fs.readFileSync(path.join(ROOT, 'qid.js'), 'utf8');

const STUB = `<script>
const S = __S__;
window.__log = [];
const Q = { text:'Favourite colour?', type:'multiple_choice', options:['Red','Blue'], revealDelay:-1 };
const BIND = { code:'TEST1', qIdx:0, qid:'q_test', text:'Favourite colour?', q:Q };
window.Office = { AsyncResultStatus:{ Succeeded:'succeeded' }, EventType:{ ActiveViewChanged:'avc' },
  onReady(fn){ setTimeout(fn, 0); },
  context:{ displayLanguage:'en-US', partitionKey:'t',
    requirements:{ isSetSupported:(n, v) => S.browserApi && n === 'OpenBrowserWindowApi' },
    ui:{ openBrowserWindow:(u) => __log.push('openBrowserWindow ' + u) },
    document:{ getActiveViewAsync(cb){ cb({ status:'succeeded', value:S.view }); },
      addHandlerAsync(){}, settings:{ get(){ return S.bound ? BIND : null; }, set(){}, saveAsync(){} } } } };
window.open = (u) => { __log.push('window.open ' + u); return null; };
window.PowerPoint = { run(){ return Promise.reject(new Error('no')); } };
const DATA = { 'quiz_builder/TEST1/questions/0': Q,
  'users/U1/presentations': { p1:{ name:'Reviewer Demo', sessionCode:'TEST1', createdAt:1, questions:[Q] } } };
function ref(p){ return { get: async () => ({ exists:()=>p in DATA, val:()=>DATA[p] }),
  on(ev, fn){ setTimeout(() => fn({ exists:()=>false, val:()=>null }), 0); return fn; }, off(){},
  set: async () => {}, update: async () => {}, transaction: async f => { f(null); return { committed:true }; },
  onDisconnect: () => ({ remove(){}, set(){} }) }; }
const AUTH = { currentUser:null, _l:[],
  onAuthStateChanged(fn){ this._l.push(fn); setTimeout(() => fn(this.currentUser), 0); return () => {}; },
  _set(u){ this.currentUser = u; this._l.forEach(f => f(u)); },
  async signInWithEmailAndPassword(e, p){ if (p !== 'pw') throw new Error('bad'); __log.push('signIn'); this._set({ uid:'U1', email:e }); return {}; },
  async signOut(){ __log.push('signOut'); this._set(null); } };
// The account the browser remembers is restored a moment after the page starts, as in Firebase.
if (S.signedIn) setTimeout(() => AUTH._set({ uid:'U1', email:'appsource-review@pollslide.com' }), 150);
window.firebase = { initializeApp(){}, database: () => ({ ref }), auth: () => AUTH };
</script>`;

// Each scenario's steps run in the page; snap() records what is on screen at that moment.
const DRIVER = `<script>
const wait = ms => new Promise(r => setTimeout(r, ms));
const vis = el => !!el && el.style.display !== 'none';
function snap(){ const r = document.getElementById('root');
  return { text:(r ? r.textContent : '').replace(/\\s+/g, ' ').trim(),
    su: (document.getElementById('su') || {}).href || null,
    so: vis(document.getElementById('so')), cSo: vis(document.getElementById('cSo')),
    bar: !!document.getElementById('psCtl'), signInBox: !!document.getElementById('si'), log: __log.slice() }; }
(async () => { const out = {}; await wait(500);
  try { await (__STEPS__)(out); } catch (e) { out.error = String(e && e.stack || e); }
  const pre = document.createElement('pre'); pre.id = '__out'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre); })();
</script>`;

function run(s, steps) {
  const html = page.replace(/<script src="\/errors\.js[^"]*"><\/script>/, '')
    .replace(/<script src="\/qid\.js[^"]*"><\/script>/, '<script>' + qidJs + '</script>')
    .replace(/<script src="https:\/\/appsforoffice[^"]*"[^>]*><\/script>/, STUB.replace(/__S__/g, JSON.stringify(s)))
    .replace(/<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>/g, '')
    .replace(/<\/body>/, DRIVER.replace('__STEPS__', steps) + '</body>');
  const f = path.join(os.tmpdir(), 'pslive-acct-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.html');
  fs.writeFileSync(f, html);
  try {
    const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=10000', '--dump-dom', 'file://' + f],
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    const x = dom.match(/<pre id="__out">([\s\S]*?)<\/pre>/);
    const res = x ? JSON.parse(x[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) : {};
    // A step that could not run (e.g. a missing button) leaves later screens empty: they fail, not crash.
    return new Proxy(res, { get: (t, k) => (k in t ? t[k] : { text: '', log: [] }) });
  } finally { fs.unlinkSync(f); }
}

console.log('\nA slide with no question yet, signed out');
let r = run({ view: 'edit', bound: false, signedIn: false, browserApi: true }, `async out => {
  out.start = snap();
  document.getElementById('su').click(); await wait(50); out.afterSu = snap();
  document.getElementById('em').value = 'appsource-review@pollslide.com'; document.getElementById('pw').value = 'pw';
  document.getElementById('si').click(); await wait(400); out.picker = snap();
  document.querySelector('.item').click(); await wait(200); out.questions = snap();
  document.getElementById('so').click(); await wait(300); out.signedOut = snap();
  document.getElementById('em').value = 'appsource-review@pollslide.com'; document.getElementById('pw').value = 'pw';
  document.getElementById('si').click(); await wait(400); out.again = snap(); }`);
ok('the sign-in screen offers "Create a free account", linking to the sign-up form', r && (r.start||{}).signInBox && /Create a free account/.test(r.start.text) && (r.start||{}).su === 'https://app.pollslide.com/presenter?signup=1', r && r.start);
ok('clicking it opens the sign-up form in the browser (Office openBrowserWindow)', r && ((r.afterSu||{}).log||[]).includes('openBrowserWindow https://app.pollslide.com/presenter?signup=1') && (r.afterSu||{}).signInBox, r && r.afterSu);
ok('after signing in: the presentation list says who is signed in, with "Sign out"', r && /Which presentation\?/.test(r.picker.text) && /Signed in as appsource-review@pollslide\.com/.test(r.picker.text) && (r.picker||{}).so, r && r.picker);
ok('the question list has "Sign out" too', r && /Which question\?/.test(r.questions.text) && (r.questions||{}).so, r && r.questions);
ok('"Sign out" signs out and returns to the sign-in screen', r && ((r.signedOut||{}).log||[]).includes('signOut') && (r.signedOut||{}).signInBox && !(r.signedOut||{}).so, r && r.signedOut);
ok('signing back in moves on to the presentation list', r && /Which presentation\?/.test(r.again.text) && (r.again||{}).so, r && r.again);

r = run({ view: 'edit', bound: false, signedIn: false, browserApi: false }, `async out => {
  document.getElementById('su').click(); await wait(50); out.afterSu = snap(); }`);
ok('where Office cannot open a browser window, the link still opens (window.open)', r && ((r.afterSu||{}).log||[]).includes('window.open https://app.pollslide.com/presenter?signup=1'), r && r.afterSu);

console.log('\nA slide that already shows a question, while editing');
r = run({ view: 'edit', bound: true, signedIn: true, browserApi: true }, `async out => {
  await wait(300); out.start = snap();
  document.getElementById('cSo').click(); await wait(300); out.signedOut = snap();
  document.getElementById('em').value = 'appsource-review@pollslide.com'; document.getElementById('pw').value = 'pw';
  document.getElementById('si').click(); await wait(400); out.again = snap(); }`);
ok('signed in: the toolbar has "Sign out" (shown once the account is restored)', r && (r.start||{}).bar && (r.start||{}).cSo, r && r.start);
ok('"Sign out" signs out, removes the toolbar and shows the sign-in screen', r && ((r.signedOut||{}).log||[]).includes('signOut') && !(r.signedOut||{}).bar && (r.signedOut||{}).signInBox, r && r.signedOut);
ok('signing back in moves on to the presentation list (used to stay on the sign-in box)', r && /Which presentation\?/.test(r.again.text) && (r.again||{}).so, r && r.again);

r = run({ view: 'edit', bound: true, signedIn: false, browserApi: true }, `async out => {
  await wait(300); out.start = snap();
  document.getElementById('cRe').click(); await wait(100); out.change = snap();
  document.getElementById('em').value = 'appsource-review@pollslide.com'; document.getElementById('pw').value = 'pw';
  document.getElementById('si').click(); await wait(400); out.again = snap(); }`);
ok('signed out: the toolbar has no "Sign out" (nothing to sign out of)', r && (r.start||{}).bar && !(r.start||{}).cSo, r && r.start);
ok('"Change question" → sign in → the presentation list (no longer stuck)', r && (r.change||{}).signInBox && /Which presentation\?/.test(r.again.text), r && [r.change, r.again]);

console.log('\nDuring a slide show');
r = run({ view: 'read', bound: true, signedIn: true, browserApi: true }, `async out => { await wait(300); out.show = snap(); }`);
ok('results only: no sign-in box, no "Sign out", no toolbar', r && !(r.show||{}).signInBox && !(r.show||{}).so && !(r.show||{}).cSo && !(r.show||{}).bar && /Favourite colour\?/.test(r.show.text), r && r.show);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
