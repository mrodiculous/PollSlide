#!/usr/bin/env node
/* PollSlide LIVE (the in-slide add-in) — going into and out of the slide show.
 *
 * Desktop PowerPoint (Windows and Mac) keeps the SAME frame alive when the presenter
 * starts the slide show and only says so through ActiveViewChanged. The handler for it was
 * attached below the early return for an already-bound slide, so a deck opened after its
 * question was chosen never went live on desktop: the edit bar stayed on the wall and
 * currentQuestion was never published, so phones did not follow.
 *
 * The web is different — a slide show there is a NEW frame that boots straight into 'read'
 * — and it must behave exactly as before. Both are driven here against the real page code
 * in headless Chrome, with Office and Firebase stubbed. Skips (passes) if Chrome is absent.
 *
 * Run: node scripts/tests/powerpoint-content-views.test.js */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find(p => fs.existsSync(p));
console.log('\nPollSlide LIVE: edit view ↔ slide show');
if (!CHROME) { console.log('  (Chrome not found — skipped)\n\n0 passed, 0 failed'); process.exit(0); }

const page = fs.readFileSync(path.join(ROOT, 'powerpoint-content', 'index.html'), 'utf8');
const qidJs = fs.readFileSync(path.join(ROOT, 'qid.js'), 'utf8');

/* Stubs. The scenario sets window.__view before boot; __fire(view) plays ActiveViewChanged. */
const STUB = `<script>
window.__log = []; window.__handlers = []; window.__view = __SCENARIO__.boot;
const BIND = { code:'TEST1', qIdx:0, qid:'q_test', text:'Favourite colour?',
  q:{ text:'Favourite colour?', type:'multiple_choice', options:['Red','Blue'], revealDelay:-1 } };
window.Office = {
  AsyncResultStatus:{ Succeeded:'succeeded' }, EventType:{ ActiveViewChanged:'avc' },
  onReady(fn){ setTimeout(fn, 0); },
  context:{ partitionKey:'t', document:{
    getActiveViewAsync(cb){ cb({ status:'succeeded', value: window.__view }); },
    addHandlerAsync(t, fn){ window.__handlers.push(fn); },
    settings:{ get(){ return __SCENARIO__.bound ? BIND : null; }, set(){}, saveAsync(){} } } } };
window.PowerPoint = { run(){ return Promise.reject(new Error('no')); } };
const DATA = { 'quiz_builder/TEST1/questions/0': BIND.q };
function ref(p){ return {
  get: async () => ({ exists:()=>p in DATA, val:()=>DATA[p] }),
  on(ev, fn){ setTimeout(() => fn({ exists:()=>false, val:()=>null }), 0); return fn; },
  off(){},
  set: async v => { __log.push(['set', p, v]); },
  update: async v => { __log.push(['update', p, v]); },
  transaction: async f => { const v = f(null); __log.push(['tx', p, v]); return { committed:true }; } }; }
window.firebase = { initializeApp(){}, database: () => ({ ref }),
  auth: () => ({ currentUser:null, onAuthStateChanged(fn){ setTimeout(() => fn(null), 0); },
                 signInWithEmailAndPassword: async () => ({}) }) };
window.__fire = async v => { window.__view = v; for (const h of __handlers) await h(); };
</script>`;

const DRIVER = `<script>
const wait = ms => new Promise(r => setTimeout(r, ms));
const snap = () => ({ ctl: !!document.getElementById('psCtl'),
  cq: __log.filter(e => e[0]==='tx' && /currentQuestion$/.test(e[1])).length,
  handlers: __handlers.length, root: (document.getElementById('root')||{}).innerText || '' });
(async () => {
  const out = {};
  await wait(300); out.boot = snap();
  for (const [i, v] of (__SCENARIO__.steps || []).entries()) { await __fire(v); await wait(300); out['s'+i+'_'+v] = snap(); }
  const pre = document.createElement('pre'); pre.id = '__out'; pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
})();
</script>`;

function run(scenario) {
  let html = page
    .replace(/<script src="\/errors\.js"><\/script>/, '')
    .replace(/<script src="\/qid\.js"><\/script>/, '<script>' + qidJs + '</script>')
    .replace(/<script src="https:\/\/appsforoffice[^"]*"[^>]*><\/script>/, STUB.replace(/__SCENARIO__/g, JSON.stringify(scenario)))
    .replace(/<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>/g, '')
    .replace(/<\/body>/, DRIVER.replace(/__SCENARIO__/g, JSON.stringify(scenario)) + '</body>');
  const f = path.join(os.tmpdir(), 'pslive-views-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.html');
  fs.writeFileSync(f, html);
  try {
    const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=8000',
      '--dump-dom', 'file://' + f], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = dom.match(/<pre id="__out">([\s\S]*?)<\/pre>/);
    return m ? JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) : null;
  } finally { fs.unlinkSync(f); }
}

console.log('\n Desktop: a bound deck opened in edit view, then presented, back, presented again');
const d = run({ boot: 'edit', bound: true, steps: ['read', 'edit', 'read'] });
ok('the harness ran', !!d, d);
if (d) {
  ok('editing: the edit bar is there and nothing is published to phones', d.boot.ctl && d.boot.cq === 0, d.boot);
  ok('the view-change handler is attached even though the slide was already bound (the bug)', d.boot.handlers === 1, d.boot);
  ok('slide show: the edit bar is gone from the wall', !d.s0_read.ctl, d.s0_read);
  ok('slide show: the live question is published, so phones follow', d.s0_read.cq === 1, d.s0_read);
  ok('back to editing: the edit bar comes back', d.s1_edit.ctl, d.s1_edit);
  ok('back to editing: nothing new is published', d.s1_edit.cq === 1, d.s1_edit);
  ok('second slide show: bar gone again and the question is published again', !d.s2_read.ctl && d.s2_read.cq === 2, d.s2_read);
}

console.log('\n Desktop: an unbound object presented');
const u = run({ boot: 'edit', bound: false, steps: ['read', 'edit'] });
ok('the harness ran', !!u, u);
if (u) {
  ok('editing: it asks to sign in', /Put live results on this slide/.test(u.boot.root), u.boot.root);
  ok('slide show: it says plainly it is not linked — never a sign-in box', /Not linked to a question/.test(u.s0_read.root) && !/Sign in/.test(u.s0_read.root), u.s0_read.root);
  ok('back to editing: the sign-in returns', /Put live results on this slide/.test(u.s1_edit.root), u.s1_edit.root);
}

console.log('\n Web: the slide show is a fresh frame that boots in read view (must be unchanged)');
const w = run({ boot: 'read', bound: true });
ok('the harness ran', !!w, w);
if (w) {
  ok('no edit bar on the wall', !w.boot.ctl, w.boot);
  ok('the live question is published once', w.boot.cq === 1, w.boot);
  ok('no view handler is attached in a read-view boot, exactly as before', w.boot.handlers === 0, w.boot);
}
const w2 = run({ boot: 'read', bound: false });
ok('web, unbound: "Not linked to a question", no sign-in box', !!w2 && /Not linked to a question/.test(w2.boot.root) && !/Sign in/.test(w2.boot.root), w2 && w2.boot.root);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
