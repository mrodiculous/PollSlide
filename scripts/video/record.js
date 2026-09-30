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
const ID = args.find(a => !a.startsWith('--') && !['--voice', '--rate', '--lang'].includes(args[args.indexOf(a) - 1])) || 'getting-started';
/* --lang es|de|fr|pt|it (2026-09-30): a fully localized version — the app itself switched to
   that language, narration read from <id>.captions.json in that language (a cue may carry a
   separate spoken form, e.g. "es_say", for things like email addresses), and the best
   installed voice for it. Written as <id>-<lang>.mp4 with its own <id>-<lang>.vtt. */
const LANG = flag('lang', 'en');
const LOCALE = { en: 'en_US', es: 'es_ES', de: 'de_DE', fr: 'fr_FR', pt: 'pt_PT', it: 'it_IT' }[LANG];
if (!LOCALE) { console.error('Unknown --lang ' + LANG); process.exit(1); }
/* Zoe (Premium) since 2026-09-27 (Rod downloaded it). Falls back to Samantha on a Mac without it.
   No rate by default: premium voices sound most natural at their own pace. */
const INSTALLED = execFileSync('say', ['-v', '?']).toString();
/* Best voice for a language: a Premium voice if one is downloaded, then Enhanced, then the
   standard voice we chose for that language. Premium voices sound far more natural — download
   them in System Settings → Accessibility → Spoken Content → System voice → Manage Voices. */
const FALLBACK = { es_ES: 'Mónica', de_DE: 'Anna', fr_FR: 'Thomas', pt_PT: 'Joana', it_IT: 'Alice' };
/* Spanish may also use a high-quality Latin American voice: the scripts are written in
   neutral Spanish, and a natural es_MX voice beats the robotic standard es_ES one. Not done
   for Portuguese — the text is European Portuguese, and a Brazilian voice would misread it. */
const ALSO = { es_ES: ['es_MX', 'es_US'] };
function bestVoice(locale) {
  const all = INSTALLED.split('\n').map(l => { const m = /^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#/.exec(l); return m ? { name: m[1].trim(), loc: m[2] } : null; }).filter(Boolean);
  const rows = all.filter(r => r.loc === locale), alt = all.filter(r => (ALSO[locale] || []).includes(r.loc));
  const pick = (list, re) => (list.find(r => re.test(r.name)) || {}).name;
  return pick(rows, /\(Premium\)/) || pick(rows, /\(Enhanced\)/) || pick(alt, /\(Premium\)/) || pick(alt, /\(Enhanced\)/)
      || (rows.find(r => r.name === FALLBACK[locale]) || {}).name || (rows[0] || {}).name;
}
const VOICE = flag('voice', LANG === 'en' ? (/^Zoe \(Premium\)/m.test(INSTALLED) ? 'Zoe (Premium)' : 'Samantha') : bestVoice(LOCALE)), RATE = flag('rate', '');
if (!VOICE) { console.error('No voice installed for ' + LOCALE); process.exit(1); }
const SCRIPT = require(path.join(HERE, ID + '.js'));
const OID = LANG === 'en' ? ID : ID + '-' + LANG;          // output name
const CAPS = LANG === 'en' ? null : JSON.parse(fs.readFileSync(path.join(HERE, ID + '.captions.json'), 'utf8')).cues;
if (CAPS && CAPS.length !== SCRIPT.scenes.length) { console.error('captions.json has ' + CAPS.length + ' cues for ' + SCRIPT.scenes.length + ' scenes'); process.exit(1); }
const sayOf = (s, i) => LANG === 'en' ? s.say : (CAPS[i][LANG + '_say'] || CAPS[i][LANG]);
const textOf = (s, i) => LANG === 'en' ? s.say : CAPS[i][LANG];
const WORK = path.join(os.tmpdir(), 'ps-video-' + OID); const OUT = path.join(HERE, 'out');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8161, DBG = 9337;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(path.join(WORK, 'frames'), { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

// ── 1. narration ──────────────────────────────────────────────────────────────
const lines = SCRIPT.scenes.map((s, i) => {
  const f = path.join(WORK, `say-${i}.aiff`);
  execFileSync('say', ['-v', VOICE, ...(RATE ? ['-r', RATE] : []), '-o', f, sayOf(s, i)]);
  const info = execFileSync('afinfo', [f]).toString();
  const dur = parseFloat((info.match(/estimated duration: ([\d.]+)/) || [])[1] || '3');
  const m4a = f.replace(/\.aiff$/, '.m4a');            // AAC, so the final mux can copy streams as-is
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac@44100', '-b', '96000', f, m4a]);
  return { file: m4a, dur };
});
console.log('lang:', LANG, '· voice:', VOICE, '· narration:', lines.map(l => l.dur.toFixed(1) + 's').join(' '), '=', lines.reduce((a, l) => a + l.dur, 0).toFixed(1) + 's');

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
  handlers['Runtime.consoleAPICalled'] = (p) => {
    const text = p.args.map(a => a.value || a.description).join(' ');
    if (p.type === 'error') console.log('  [page error]', text.slice(0, 200));
    const m = /^SNAP:([\w-]+)$/.exec(text);          // D.snap('name') → a full-quality still
    if (m) send('Page.captureScreenshot', { format: 'png' }).then(r => {
      const f = path.join(OUT, ID + '-' + m[1] + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  still →', path.basename(f));
    }).catch(() => {});
  };
  const loaded = new Promise(r => { handlers['Page.loadEventFired'] = r; });
  await send('Page.navigate', { url: `http://localhost:${PORT}/__video/stage.html` });
  await loaded; await sleep(1200);
  // The app's own interface language, and the script's on-screen words (chips, title cards).
  await evaluate(`(function(){ try { ${LANG === 'en' ? "localStorage.removeItem('ps_ui_lang')" : `localStorage.setItem('ps_ui_lang', ${JSON.stringify(LANG)})`}; } catch (e) {}
    window.VT = ${JSON.stringify((SCRIPT.t && SCRIPT.t[LANG]) || {})}; window.VLANG = ${JSON.stringify(LANG)}; })()`);

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
    cues.push({ from: start - t0 + 0.25, to: start - t0 + 0.25 + line.dur, text: textOf(s, i) });
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
  const manifest = { width: 1920, height: 1080, end, frames: rel, audio, scenes: sceneTimes, preview: SCRIPT.preview || null, previewLabel: SCRIPT.previewLabel || null, out: path.join(OUT, OID + '.mp4') };
  fs.writeFileSync(path.join(WORK, 'manifest.json'), JSON.stringify(manifest));
  // Scene start times, for chapter buttons on the page that shows this video.
  fs.writeFileSync(path.join(OUT, OID + '.scenes.json'), JSON.stringify(sceneTimes.map(x => ({ id: x.id, t: Math.round(x.t * 10) / 10 }))));
  console.log(`captured ${rel.length} frames over ${end.toFixed(1)}s`);

  // Captions (WebVTT) from the narration.
  const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = (s % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x}`; };
  const vtt = 'WEBVTT\n\n' + cues.map((c, i) => `${i + 1}\n${ts(c.from)} --> ${ts(c.to)}\n${c.text}\n`).join('\n');
  if (LANG === 'en') {
    fs.writeFileSync(path.join(OUT, ID + '.en.vtt'), vtt);
    fs.writeFileSync(path.join(OUT, ID + '.cues.json'), JSON.stringify(cues, null, 1));
  } else fs.writeFileSync(path.join(OUT, OID + '.vtt'), vtt);

  // ── 3. assemble ──
  execFileSync('swift', [path.join(HERE, 'assemble.swift'), path.join(WORK, 'manifest.json')], { stdio: 'inherit' });
  execFileSync('python3', [path.join(HERE, 'make-preview.py'), path.join(WORK, 'manifest.json'), path.join(OUT, OID)], { stdio: 'inherit' });
  if (LANG === 'en' && fs.existsSync(path.join(HERE, ID + '.captions.json'))) execFileSync('python3', [path.join(HERE, 'captions.py'), ID], { stdio: 'inherit' });
  console.log('done →', OUT);
})().catch(e => { console.error(e); cleanup(); process.exit(1); });
