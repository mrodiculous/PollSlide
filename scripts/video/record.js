#!/usr/bin/env node
/* Records a product video from a scene script (e.g. getting-started.js).
 *
 *   node scripts/video/record.js getting-started [--voice "Samantha"] [--rate 175]
 *
 * 1. Speaks each scene's narration with macOS `say` (swap --voice for a nicer installed
 *    voice, e.g. a Premium one from System Settings → Accessibility → Spoken Content).
 * 2. Starts the local stage (server.js) and headless Chrome, and drives the scenes on the
 *    REAL app pages while Chrome's screencast captures every frame with its timestamp.
 *    Each scene lasts as long as its narration (or its actions, whichever is longer).
 * 3. Hands frames + narration to assemble.swift → out/<id>.mp4, plus captions (.vtt),
 *    a poster and the animated email preview (make-preview.py).
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync } = require('child_process');
const HERE = __dirname, ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const ID = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--voice' && args[args.indexOf(a) - 1] !== '--rate') || 'getting-started';
const VOICE = flag('voice', 'Samantha'), RATE = flag('rate', '172');
const SCRIPT = require(path.join(HERE, ID + '.js'));
const WORK = path.join(os.tmpdir(), 'ps-video-' + ID); const OUT = path.join(HERE, 'out');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8161, DBG = 9337;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(path.join(WORK, 'frames'), { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

// ── 1. narration ──────────────────────────────────────────────────────────────
const lines = SCRIPT.scenes.map((s, i) => {
  const f = path.join(WORK, `say-${i}.aiff`);
  execFileSync('say', ['-v', VOICE, '-r', RATE, '-o', f, s.say]);
  const info = execFileSync('afinfo', [f]).toString();
  const dur = parseFloat((info.match(/estimated duration: ([\d.]+)/) || [])[1] || '3');
  const m4a = f.replace(/\.aiff$/, '.m4a');            // AAC, so the final mux can copy streams as-is
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac@44100', '-b', '96000', f, m4a]);
  return { file: m4a, dur };
});
console.log('narration:', lines.map(l => l.dur.toFixed(1) + 's').join(' '), '=', lines.reduce((a, l) => a + l.dur, 0).toFixed(1) + 's');

// ── 2. stage + Chrome ─────────────────────────────────────────────────────────
const server = spawn(process.execPath, [path.join(HERE, 'server.js'), String(PORT)], { stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DBG}`, '--window-size=1920,1080', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check', '--mute-audio', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--user-data-dir=' + path.join(WORK, 'profile'), 'about:blank'],
  { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) {} try { server.kill(); } catch (e) {} };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(1); });

async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json(); const p = l.find(t => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } catch (e) {}
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

(async () => {
  const ws = new WebSocket(await cdpConnect());
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(), handlers = {};
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method && handlers[m.method]) handlers[m.method](m.params);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  handlers['Runtime.consoleAPICalled'] = (p) => { if (p.type === 'error') console.log('  [page error]', p.args.map(a => a.value || a.description).join(' ').slice(0, 200)); };
  const loaded = new Promise(r => { handlers['Page.loadEventFired'] = r; });
  await send('Page.navigate', { url: `http://localhost:${PORT}/__video/stage.html` });
  await loaded; await sleep(1200);

  // Frames: Chrome sends one whenever the picture changes, stamped with wall-clock time.
  const frames = []; let n = 0;
  handlers['Page.screencastFrame'] = (p) => {
    const f = path.join(WORK, 'frames', String(n++).padStart(6, '0') + '.jpg');
    fs.writeFileSync(f, Buffer.from(p.data, 'base64'));
    frames.push({ f, t: p.metadata.timestamp || Date.now() / 1000 });
    send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  };
  // A scene's optional `pre` runs before capture starts, so the video opens on a finished picture.
  if (SCRIPT.scenes[0].pre) { await evaluate(`(${SCRIPT.scenes[0].pre.toString()})(window.D)`); await sleep(1500); }
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await sleep(400);

  // ── scenes ──
  const t0 = Date.now() / 1000; const audio = [], cues = [], sceneTimes = [];
  for (let i = 0; i < SCRIPT.scenes.length; i++) {
    const s = SCRIPT.scenes[i], line = lines[i];
    const start = Date.now() / 1000;
    audio.push({ file: line.file, t: start - t0 + 0.25 }); sceneTimes.push({ id: s.id, t: start - t0 });
    cues.push({ from: start - t0 + 0.25, to: start - t0 + 0.25 + line.dur, text: s.say });
    process.stdout.write(`scene ${i + 1}/${SCRIPT.scenes.length} ${s.id} … `);
    try { await evaluate(`(${s.run.toString()})(window.D)`); }
    catch (e) {
      console.log('\n  ✗ scene failed: ' + e.message);
      try { const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'failed-scene.png'), Buffer.from(shot.data, 'base64')); console.log('  screenshot → out/failed-scene.png'); } catch (x) {}
      cleanup(); process.exit(1);
    }
    const took = Date.now() / 1000 - start, need = line.dur + 0.25 + 0.7;
    if (took < need) await sleep((need - took) * 1000);
    console.log(`${(Date.now() / 1000 - start).toFixed(1)}s (actions ${took.toFixed(1)}s, voice ${line.dur.toFixed(1)}s)`);
  }
  await sleep(1500);
  const end = Date.now() / 1000 - t0;
  await send('Page.stopScreencast'); await sleep(300);
  cleanup();

  // Frame times relative to the start; the first frame covers anything before it.
  const rel = frames.map(x => ({ f: x.f, t: Math.max(0, x.t - t0) })).filter((x, i, a) => i === 0 || x.t >= a[i - 1].t);
  const manifest = { width: 1920, height: 1080, end, frames: rel, audio, scenes: sceneTimes, out: path.join(OUT, ID + '.mp4') };
  fs.writeFileSync(path.join(WORK, 'manifest.json'), JSON.stringify(manifest));
  console.log(`captured ${rel.length} frames over ${end.toFixed(1)}s`);

  // Captions (WebVTT) from the narration.
  const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = (s % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x}`; };
  fs.writeFileSync(path.join(OUT, ID + '.en.vtt'), 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${ts(c.from)} --> ${ts(c.to)}\n${c.text}\n`).join('\n'));
  fs.writeFileSync(path.join(OUT, ID + '.cues.json'), JSON.stringify(cues, null, 1));

  // ── 3. assemble ──
  execFileSync('swift', [path.join(HERE, 'assemble.swift'), path.join(WORK, 'manifest.json')], { stdio: 'inherit' });
  execFileSync('python3', [path.join(HERE, 'make-preview.py'), path.join(WORK, 'manifest.json'), path.join(OUT, ID)], { stdio: 'inherit' });
  console.log('done →', OUT);
})().catch(e => { console.error(e); cleanup(); process.exit(1); });
