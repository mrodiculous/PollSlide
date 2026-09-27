#!/usr/bin/env node
/* Local stage for recording product videos: serves the REAL app pages with Firebase swapped
 * for scripts/video/fb-stub.js, a shared in-memory demo database, and canned answers for
 * the APIs a video uses (Polly, GIF search). Nothing here reaches the live project.
 *
 *   node scripts/video/server.js [port]      (default 8150)
 *
 * Demo content is deliberately the app's own reviewed material: Polly "writes" the starter
 * animal quiz (starters.js) and GIF search returns the GIFs a person already vetted for it
 * (starter-media.js), so nothing unreviewed can end up in a video.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8150);
const Starters = require(path.join(ROOT, 'starters.js'));
const Media = require(path.join(ROOT, 'starter-media.js'));

const USER = { uid: 'demoTeacher01', email: 'alex@example.com', displayName: 'Alex', createdAt: Date.now() };
// A second person for team videos: the invitee. A page opened with ?as=member signs in as them.
const MEMBER = { uid: 'demoMember02', email: 'jamie@example.com', displayName: 'Jamie', createdAt: Date.now() };
const USERS = { owner: USER, member: MEMBER };
function seed() {
  return { users: {
    [USER.uid]: { email: USER.email, name: 'Alex', displayName: 'Alex', tier: 'free', createdAt: USER.createdAt, lang: 'en', onboarded: true },
    [MEMBER.uid]: { email: MEMBER.email, name: 'Jamie', displayName: 'Jamie', tier: 'free', createdAt: MEMBER.createdAt, lang: 'en', onboarded: true } } };
}
let TREE = seed();
const split = (p) => String(p || '').split('/').filter(Boolean);
function setAt(parts, value) {
  if (!parts.length) { TREE = value || {}; return; }
  let n = TREE; const stack = [];
  for (let i = 0; i < parts.length - 1; i++) { const k = parts[i]; if (n[k] == null || typeof n[k] !== 'object') { if (value === null) return; n[k] = {}; } stack.push([n, k]); n = n[k]; }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete n[last]; else n[last] = value;
  for (let i = stack.length - 1; i >= 0; i--) { const [p, k] = stack[i]; if (p[k] && typeof p[k] === 'object' && !Object.keys(p[k]).length) delete p[k]; }
}
const STREAMS = new Set(), UPLOADS = new Map();
function broadcast(msg) { const s = 'data: ' + JSON.stringify(msg) + '\n\n'; for (const r of STREAMS) r.write(s); }

// ── canned APIs ───────────────────────────────────────────────────────────────
const DEMO = Starters.byId ? Starters.byId('demo-quiz') : (Starters.STARTERS || [])[0];
function pollyAnswer(body) {
  const have = new Set((body.avoid || []).map(a => String(a.text || '').toLowerCase().trim()));
  const qs = DEMO.questions.filter(q => !have.has(q.text.toLowerCase())).slice(0, Math.max(1, Number(body.count) || 4));
  return { source: 'cloud', questions: qs.map(q => ({ text: q.text, options: q.options.map(o => o.text), correctAnswers: [q.correctAnswer], kind: 'single' })) };
}
/* Which vetted slot a search is about. Question searches are reduced to content words by
   gifs.js, so match on the words that identify each demo question or choice. */
const SLOT_WORDS = [
  ['q0', /sleep|alarm|clock/], ['q1', /jump/], ['q2', /heart/], ['q3', /fast/], ['q4', /colou?r|change/],
];
function gifSlot(term) {
  const t = String(term || '').toLowerCase();
  for (const [slot, re] of SLOT_WORDS) if (re.test(t)) return slot;
  for (let qi = 0; qi < DEMO.questions.length; qi++) {
    const q = DEMO.questions[qi];
    for (let oi = 0; oi < q.options.length; oi++) if (t.includes(q.options[oi].text.toLowerCase())) return 'q' + qi + 'o' + oi;
  }
  return null;
}
function gifAnswer(body) {
  const slot = gifSlot(body.q); const m = slot && Media[slot];
  const list = m ? [m, ...(m.alts || [])] : [Media.q0o2, Media.q3];   // an unknown term still gets something safe
  return { attribution: 'Powered by GIPHY', provider: 'giphy', results: list.map(g => ({ url: g.url, still: g.still, alt: g.alt, id: g.id, source: 'giphy', width: 200, height: 200 })) };
}

// ── static files with Firebase swapped out ────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.vtt': 'text/vtt' };
function rewriteHtml(html) {
  let first = true;
  return html.replace(/<script[^>]+src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"[^>]*><\/script>/g, () => {
    if (!first) return ''; first = false; return '<script src="/__video/fb-stub.js"></script>';
  });
}
function readBody(req) { return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); }); }
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); let p = decodeURIComponent(u.pathname);
  try {
    if (p === '/__db/tree') return json(res, 200, TREE);
    if (p === '/__video/config') return json(res, 200, { user: USERS[u.searchParams.get('as')] || USER });
    if (p === '/__db/reset') { TREE = seed(); broadcast({ client: 'server', ops: [['', TREE]] }); return json(res, 200, { ok: true }); }
    if (p === '/__db/write' && req.method === 'POST') {
      const m = JSON.parse((await readBody(req)).toString() || '{}');
      (m.ops || []).forEach(([path_, v]) => setAt(split(path_), v)); broadcast(m); return json(res, 200, { ok: true });
    }
    if (p === '/__db/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(': hi\n\n'); STREAMS.add(res); req.on('close', () => STREAMS.delete(res)); return;
    }
    if (p.startsWith('/__upload/')) {
      if (req.method === 'POST') { UPLOADS.set(p, { type: req.headers['content-type'], body: await readBody(req) }); return json(res, 200, { ok: true }); }
      const f = UPLOADS.get(p); if (!f) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': f.type }); return res.end(f.body);
    }
    if (p.startsWith('/api/')) {
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)).toString() || '{}') : {};
      if (p === '/api/polly') return setTimeout(() => json(res, 200, pollyAnswer(body)), 1800);   // Polly takes a moment
      if (p === '/api/gif-search') return setTimeout(() => json(res, 200, gifAnswer(body)), 120);
      // The app falls back to the same database writes the real /api/team makes when the
      // endpoint is unavailable — exactly what a video needs, with nothing to reimplement.
      if (p === '/api/team') return json(res, 503, {});
      return json(res, 200, {});   // not ok: e.g. /api/team must not report a joined team
    }
    if (p.startsWith('/__video/')) p = '/scripts/video/' + p.slice('/__video/'.length);
    let file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';   // clean URLs, as on Vercel
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file);
    let data = fs.readFileSync(file);
    if (ext === '.html') data = Buffer.from(rewriteHtml(data.toString()));
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (e) { console.error(e); json(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log('video stage on http://localhost:' + PORT));
