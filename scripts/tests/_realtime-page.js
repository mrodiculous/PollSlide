#!/usr/bin/env node
/* Test helper (not a test): open an HTML file in headless Chrome in REAL time and print the
 * JSON the page leaves in <pre id="__out">.
 *   node scripts/tests/_realtime-page.js <file.html> [timeoutMs]
 * Why not --virtual-time-budget + --dump-dom: virtual time never paints, and the browser only
 * measures what is on screen (IntersectionObserver) when it paints — so a page that waits for
 * that measurement never sees it under virtual time (2026-10-06). */
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const file = process.argv[2], limit = Number(process.argv[3]) || 30000;
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
const port = 9400 + Math.floor(Math.random() * 400);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-rt-'));
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--window-size=800,600', '--user-data-dir=' + prof, 'file://' + path.resolve(file)], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const done = (s, code) => { try { ch.kill(); } catch (e) {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} if (s) process.stdout.write(s); process.exit(code); };
(async () => {
  const t0 = Date.now();
  let t; while (!t && Date.now() - t0 < limit) { try { t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.type === 'page'); } catch (e) {} if (!t) await sleep(150); }
  if (!t) return done('', 1);
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  const ev = (e) => new Promise(res => { const id = Math.floor(Math.random() * 1e9);
    const h = m => { const d = JSON.parse(m.data); if (d.id === id) { ws.removeEventListener('message', h); res(d.result && d.result.result && d.result.result.value); } };
    ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: e, returnByValue: true } })); });
  while (Date.now() - t0 < limit) { const out = await ev("(document.getElementById('__out')||{}).textContent||''"); if (out) { ws.close(); return done(out, 0); } await sleep(200); }
  ws.close(); done('', 1);
})().catch(() => done('', 1));
