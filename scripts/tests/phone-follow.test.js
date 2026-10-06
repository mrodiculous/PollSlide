#!/usr/bin/env node
/* Phones follow the presenter — and NEVER jump to a left-over question (2026-10-06).
 *
 * Rod, PowerPoint on the web: scanned the QR for Q1, advanced one slide, and the phone went
 * to Q4 — the last question of his PREVIOUS run, still sitting in currentQuestion. The phone
 * had a follow flag from earlier in the same browser tab, and a flagged phone jumped straight
 * to whatever currentQuestion held. "Catastrophic for a paid customer."
 *
 * This runs the REAL answer page (scripts/video/server.js: real pages, in-memory database)
 * in headless Chrome, one fresh browser context per scenario — like a separate phone — and
 * proves the fix AND that every case customers rely on today is unchanged:
 *   1. left-over follow flag + left-over live question → stays on the scanned question,
 *      then follows the next real change                                    (the fix)
 *   2. scanned the question that is live → follows every change             (unchanged)
 *   3. scanned a question that is NOT live, no flag → stays on it (per-slide QR) (unchanged)
 *   4. just joined by code → follows, including a question already live     (unchanged)
 *   5. scanned a deleted question → waits, then follows                      (unchanged)
 * Skips (passes) if Chrome is absent. Run: node scripts/tests/phone-follow.test.js */
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
console.log('\nPhones: follow the presenter, never a left-over question');
if (!CHROME || typeof WebSocket === 'undefined') { console.log('  (Chrome or WebSocket not available — skipped)\n\n0 passed, 0 failed'); process.exit(0); }

const PORT = 8171, DBG = 9341, BASE = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn(process.execPath, [path.join(ROOT, 'scripts', 'video', 'server.js'), String(PORT)], { stdio: 'ignore' });
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-phone-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} };
process.on('exit', cleanup);

const write = (ops) => fetch(BASE + '/__db/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: 'test', ops }) });
const Q = (i) => ({ id: 'qzT' + i, home: i, text: 'Question ' + 'ABCDE'[i] + '?', type: 'multiple_choice', options: [{ text: 'x' }, { text: 'y' }] });
const QS = [0, 1, 2, 3, 4].map(Q);
const live = (i, ago) => ({ id: 'qzT' + i + '_T1', qIndex: i, index: i + 1, home: i, text: QS[i].text, type: 'multiple_choice', phase: 'live', status: 'active', launchedAt: Date.now() - (ago || 0) });

let ws, seq = 0; const pending = new Map();
function send(method, params, sessionId) {
  const id = ++seq; ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function newPhone() {
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result.value;
  const go = async (url) => { await send('Page.navigate', { url: BASE + url }, sessionId); await sleep(2600); };
  return { evaluate, go, close: () => send('Target.disposeBrowserContext', { browserContextId }) };
}
const hashOf = (p) => p.evaluate('location.hash');

(async () => {
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/__video/config'); break; } catch (e) { await sleep(150); } }
  let wsUrl; for (let i = 0; i < 60 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${DBG}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) { await sleep(150); } }
  ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
  const deck = [['quiz_builder/T1/questions', QS], ['quiz_builder/T1/homes', { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4 }]];

  // 1 — the bug: a follow flag from earlier in this tab, and a left-over live question (Q4).
  await write([...deck, ['sessions/T1/currentQuestion', live(3, 10 * 60000)]]);
  let p = await newPhone();
  await p.go('/qid.js');                                   // same site, so the tab's storage is set up
  await p.evaluate("sessionStorage.setItem('ql_follow_T1','1'); 1");
  await p.go('/answer#T1/0');
  ok('left-over flag + left-over live question: stays on the question it scanned (Q1)', (await hashOf(p)) === '#T1/0', await hashOf(p));
  await write([['sessions/T1/currentQuestion', live(1)]]); await sleep(2200);
  ok('…and follows the presenter\'s next real change (Q2)', (await hashOf(p)) === '#T1/1', await hashOf(p));
  await p.close();

  // 2 — scanned the live question: follows every change.
  await write([...deck, ['sessions/T1/currentQuestion', live(0)]]);
  p = await newPhone(); await p.go('/answer#T1/0');
  await write([['sessions/T1/currentQuestion', live(2)]]); await sleep(2200);
  const h2a = await hashOf(p);
  await write([['sessions/T1/currentQuestion', live(4)]]); await sleep(2200);
  ok('scanned the live question: follows every change (Q3, then Q5)', h2a === '#T1/2' && (await hashOf(p)) === '#T1/4', [h2a, await hashOf(p)]);
  await p.close();

  // 3 — per-slide QR: scanned a question that is not live, no flag → stays on it.
  await write([...deck, ['sessions/T1/currentQuestion', live(3)]]);
  p = await newPhone(); await p.go('/answer#T1/1');
  await write([['sessions/T1/currentQuestion', live(4)]]); await sleep(2200);
  ok('scanned a question that is not live: stays on it, even when the presenter moves', (await hashOf(p)) === '#T1/1', await hashOf(p));
  await p.close();

  // 4 — just joined by code: follows, including a question that was already live.
  await write([...deck, ['sessions/T1/currentQuestion', live(2)]]);
  p = await newPhone(); await p.go('/qid.js');
  await p.evaluate("sessionStorage.setItem('ql_follow_T1','1'); sessionStorage.setItem('ql_join_at_T1', String(Date.now())); 1");
  await p.go('/answer#T1/0');                              // presenter moved on during the join
  ok('just joined by code: goes to the question that is live (Q3)', (await hashOf(p)) === '#T1/2', await hashOf(p));
  await write([['sessions/T1/currentQuestion', live(3)]]); await sleep(2200);
  ok('…and keeps following (Q4)', (await hashOf(p)) === '#T1/3', await hashOf(p));
  await p.close();

  // 5 — scanned a deleted question (link 9 is not in the deck): waits, then follows.
  await write([...deck, ['sessions/T1/currentQuestion', live(1)]]);
  p = await newPhone(); await p.go('/qid.js');
  await p.evaluate("localStorage.setItem('ql_pid_T1','p_test'); localStorage.setItem('ql_pname_T1','Tester'); 1");   // has entered a name
  await p.go('/answer#T1/9');
  await write([['sessions/T1/currentQuestion', live(2)]]); await sleep(2600);
  ok('scanned a deleted question: follows the presenter', (await hashOf(p)) === '#T1/2', await hashOf(p));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  cleanup(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ✗ harness error: ' + e.message); cleanup(); process.exit(1); });
