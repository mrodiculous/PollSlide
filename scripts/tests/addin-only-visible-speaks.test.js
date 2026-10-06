#!/usr/bin/env node
/* PollSlide LIVE: only the slide ON SCREEN tells phones where to go (2026-10-06).
 *
 * Measured on PowerPoint for the web (Rod, Reviewer Demo XZESB7L): when the presenter moved
 * to slide 3, the object on slide 5 — two ahead, loaded in the background — ALSO announced
 * itself, within a second; on slide 4, slide 6 did. Its later announcement took the follow
 * pointer and the phone jumped to Q5 while the room was on Q3.
 *
 * This test runs THREE real copies of the add-in in one page, sharing one database: slide 1
 * in the window, slides 2 and 3 parked off-screen like PowerPoint's look-ahead. It proves:
 *   • only the visible slide claims the follow pointer, however the others start or fire
 *     visibilitychange;
 *   • "advancing" (slide 2 into view, slide 1 out) hands the pointer to slide 2 at once;
 *   • the slide that stays off-screen never speaks.
 * Skips (passes) if Chrome is absent. Run: node scripts/tests/addin-only-visible-speaks.test.js */
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 500) : '')));
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
console.log('\nPollSlide LIVE: only the slide on screen tells phones where to go');
if (!CHROME) { console.log('  (Chrome not found — skipped)\n\n0 passed, 0 failed'); process.exit(0); }

const page = fs.readFileSync(path.join(ROOT, 'powerpoint-content', 'index.html'), 'utf8');
const qidJs = fs.readFileSync(path.join(ROOT, 'qid.js'), 'utf8');

// Inside each slide object: Office + Firebase stubs backed by the PARENT page's database.
const STUB = `<script>
const P = window.parent, S = window.__S;
window.Office = { AsyncResultStatus:{ Succeeded:'succeeded' }, EventType:{ ActiveViewChanged:'avc' },
  onReady(fn){ setTimeout(fn, 0); },
  context:{ displayLanguage:'en-US', partitionKey:'t'+S.slide, requirements:{ isSetSupported:()=>false },
    document:{ getActiveViewAsync(cb){ cb({ status:'succeeded', value:'read' }); }, addHandlerAsync(){},
      settings:{ get(){ return S.binding; }, set(){}, saveAsync(){} } } } };
window.PowerPoint = { run(){ return Promise.reject(new Error('no')); } };
function ref(p){ return {
  get: async () => { const v = P.DB.get(p); return { exists:()=>v !== undefined && v !== null, val:()=>v }; },
  on(ev, fn){ return fn; }, off(){},
  set: async v => { P.DB.set(p, v); }, update: async v => { P.DB.update(p, v); },
  transaction: async f => { const v = f(P.DB.get(p) || null); if (v !== undefined) { P.DB.set(p, v); if (p.endsWith('/currentQuestion')) P.CLAIMS.push({ slide:S.slide, at:Date.now() }); } return { committed: v !== undefined }; } }; }
window.firebase = { initializeApp(){}, database: () => ({ ref }),
  auth: () => ({ currentUser:{ uid:'U1', isAnonymous:false, email:'x@y.z' }, onAuthStateChanged(fn){ setTimeout(()=>fn(this.currentUser),0); return ()=>{}; }, signInAnonymously: async()=>({}) }) };
</script>`;
const objectHtml = page.replace(/<script src="\/errors\.js[^"]*"><\/script>/, '')
  .replace(/<script src="\/qid\.js[^"]*"><\/script>/, '<script>' + qidJs + '<\/script>')
  .replace(/<script src="https:\/\/appsforoffice[^"]*"[^>]*><\/script>/, STUB)
  .replace(/<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>/g, '');

const Q = (i) => ({ id: 'qzS' + i, home: i, text: 'Slide question ' + i + '?', type: 'multiple_choice', options: ['a', 'b'], revealDelay: -1 });
const host = `<!doctype html><html><body style="margin:0;width:800px;height:600px;overflow:hidden;position:relative">
<script>
const STORE = { quiz_builder:{ T1:{ questions:[${[0, 1, 2].map(i => JSON.stringify(Q(i))).join(',')}], homes:{0:0,1:1,2:2} } } };
const seg = p => p.split('/').filter(Boolean);
window.DB = {
  get(p){ let o = STORE; for (const k of seg(p)) { if (o == null) return undefined; o = o[k]; } return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); },
  set(p, v){ const k = seg(p); let o = STORE; for (const x of k.slice(0, -1)) { o[x] = (o[x] && typeof o[x] === 'object') ? o[x] : {}; o = o[x]; } o[k[k.length-1]] = v; },
  update(p, v){ for (const k in v) this.set(p + '/' + k, v[k]); } };
window.CLAIMS = [];
const HTML = ${JSON.stringify(objectHtml).replace(/<\//g, '<\\/')};
const slides = [];
for (const i of [0, 1, 2]) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:absolute;border:0;width:400px;height:300px;top:0;left:' + (i === 0 ? '0px' : (-3000 * i) + 'px');
  const binding = { code:'T1', qIdx:i, qid:'qzS' + i + '_T1', text:'Slide question ' + i + '?', q:${JSON.stringify(Q(0))} };
  binding.q = STORE.quiz_builder.T1.questions[i];
  f.srcdoc = HTML.replace('<head>', '<head><script>window.__S=' + JSON.stringify({ slide:i, binding }) + '<\\/script>');
  document.body.appendChild(f); slides.push(f);
}
const out = {};
const pointer = () => { const c = DB.get('sessions/T1/currentQuestion'); return c ? c.qIndex : null; };
const fireVis = () => slides.forEach(f => { try { f.contentDocument.dispatchEvent(new Event('visibilitychange')); } catch(e){} });
setTimeout(() => {
  out.afterStart = pointer(); out.claimsAfterStart = CLAIMS.map(c => c.slide);
  fireVis();                                                       // PowerPoint toggles page visibility
  setTimeout(() => {
    out.afterVis = pointer(); out.claimsAfterVis = CLAIMS.map(c => c.slide);
    slides[0].style.left = '-6000px'; slides[1].style.left = '0px';  // advance: slide 2 into view
    setTimeout(() => {
      out.afterAdvance = pointer(); out.claimsAll = CLAIMS.map(c => c.slide);
      const pre = document.createElement('pre'); pre.id = '__out'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre);
    }, 1500);
  }, 800);
}, 2000);
<\/script></body></html>`;

const f = path.join(os.tmpdir(), 'pslive-visible-' + process.pid + '.html');
fs.writeFileSync(f, host);
/* Real time, not --virtual-time-budget: the browser only re-measures what is on screen when it
   actually paints, and virtual time never paints — so "advancing" would be invisible to it. */
const { spawn } = require('child_process');
const DBG = 9343, prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-vis-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, '--no-first-run', '--window-size=800,600', '--user-data-dir=' + prof, 'file://' + f], { stdio: 'ignore' });
const sleep = ms => new Promise(res => setTimeout(res, ms));
async function readOut() {
  let target;
  for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!target) await sleep(150); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(res => ws.addEventListener('open', res));
  const ev = (expr) => new Promise(res => { const id = Math.floor(Math.random() * 1e9);
    const h = m => { const d = JSON.parse(m.data); if (d.id === id) { ws.removeEventListener('message', h); res(d.result && d.result.result && d.result.result.value); } };
    ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
  for (let i = 0; i < 60; i++) { const v = await ev("(document.getElementById('__out')||{}).textContent || ''"); if (v) { ws.close(); return JSON.parse(v); } await sleep(250); }
  ws.close(); return null;
}
let r = null;
(async () => {
try { r = await readOut(); } catch (e) { console.log('  ✗ harness: ' + e.message); }
finally { try { chrome.kill(); } catch (e) {} try { fs.unlinkSync(f); fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} }
r = r || {};
ok('three slides started (one on screen, two loaded ahead): phones are sent to the one on screen', r.afterStart === 0, r);
ok('the slides loaded ahead never claimed the pointer', (r.claimsAfterStart || []).every(s => s === 0) && (r.claimsAfterStart || []).length > 0, r.claimsAfterStart);
ok('a page-visibility event does not let a hidden slide take over', r.afterVis === 0 && (r.claimsAfterVis || []).every(s => s === 0), r);
ok('advancing to slide 2 hands phones to slide 2', r.afterAdvance === 1, r);
ok('slide 3 (still off-screen) never spoke', !(r.claimsAll || []).includes(2), r.claimsAll);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
