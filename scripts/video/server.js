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
// Support staff, for filming and testing Admin → Accounts (?as=admin).
const ADMINU = { uid: 'demoAdmin00', email: 'help@pollslide.com', displayName: 'Support', createdAt: Date.now() };
const USERS = { owner: USER, member: MEMBER, admin: ADMINU };
/* Demo accounts have already accepted the Terms; otherwise the real sign-up consent gate opens
   mid-video (it checks users/<uid>/signupConsent). */
const CONSENT = { age16: true, termsAndPrivacy: true, at: Date.now(), via: 'stage' };
function seed() {
  return { users: {
    [USER.uid]: { email: USER.email, name: 'Alex', displayName: 'Alex', tier: 'free', createdAt: USER.createdAt, lang: 'en', onboarded: true, signupConsent: CONSENT },
    [MEMBER.uid]: { email: MEMBER.email, name: 'Jamie', displayName: 'Jamie', tier: 'free', createdAt: MEMBER.createdAt, lang: 'en', onboarded: true, signupConsent: CONSENT },
    [ADMINU.uid]: { email: ADMINU.email, name: 'Support', tier: 'free', createdAt: ADMINU.createdAt, signupConsent: CONSENT } } };
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
/* Team videos (2026-10-10): demo content in each video language — stage-i18n.js. */
const SI = require(path.join(__dirname, 'stage-i18n.js'));
function pollyAnswer(body) {
  if (/handbook|onboard|new starter|manual|handbuch|guide d|accueil|integra|inserimento|incorpora/i.test(String(body.topic || '') + ' ' + String(body.source || ''))) {
    const qs = SI.ONBOARD[SI.L(body.language, SI.ONBOARD)];
    return { source: 'cloud', questions: qs.slice(0, Math.max(1, Number(body.count) || 5)).map(([text, options, c]) => ({ text, options, correctAnswers: [c], kind: 'single' })) };
  }
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

function insightsAnswer(body) {
  const T = SI.INSIGHTS[SI.L(body.language, SI.INSIGHTS)];
  const texts = (body.texts || []).map(t => String(t || '').trim()).filter(Boolean);
  const good = texts.filter(t => SI.GOOD.test(t)), hard = texts.filter(t => !SI.GOOD.test(t) && SI.HARD.test(t)), other = texts.filter(t => !SI.GOOD.test(t) && !SI.HARD.test(t));
  const pct = (n) => texts.length ? Math.round(n / texts.length * 100) : 0;
  const themes = [];
  if (good.length) themes.push({ label: T.good, count: good.length, sentiment: 'positive', example: good[0] });
  if (hard.length) themes.push({ label: T.hard, count: hard.length, sentiment: 'negative', example: hard[0] });
  if (other.length) themes.push({ label: T.mixed, count: other.length, sentiment: 'neutral', example: other[0] });
  themes.sort((a, b) => b.count - a.count);
  const pos = pct(good.length), neg = pct(hard.length);
  return { source: 'cloud', count: texts.length, summary: hard.length > good.length ? T.sHard : T.sGood,
    sentiment: { positive: pos, negative: neg, neutral: Math.max(0, 100 - pos - neg) }, themes };
}
function copilotAnswer(body) {
  const C = SI.COPILOT[SI.L((body || {}).language, SI.COPILOT)];
  return { source: 'cloud', suggestions: C.map(([text, options, why]) => ({ text, options, answerIndex: null, why })) };
}

// ── /api/account on the stage: the REAL lib/account.js against the stage database ──
/* So Account settings and Admin → Accounts can be tested and filmed end to end with the
   production logic. Every write is broadcast, so open pages update like with Firebase. */
const AccountLib = require(path.join(ROOT, 'lib', 'account.js'));
function stageDb() {
  const read = p => split(p).reduce((o, k) => (o && typeof o === 'object') ? o[k] : undefined, TREE);
  const clone = v => v === undefined ? null : JSON.parse(JSON.stringify(v));
  const write = (p, v) => { setAt(split(p), v === undefined ? null : clone(v)); broadcast({ client: 'server', ops: [[p, clone(v)]] }); };
  const snap = (key, v) => ({ key, exists: () => v !== undefined && v !== null, val: () => clone(v),
    forEach(fn) { if (v && typeof v === 'object') Object.keys(v).forEach(k => fn(snap(k, v[k]))); } });
  let n = 0;
  const ref = p => ({
    get: async () => snap(split(p).pop(), read(p)),
    set: async v => write(p, v), remove: async () => write(p, null),
    update: async o => { Object.keys(o).forEach(k => write((p === '/' ? '' : p + '/') + k, o[k])); },
    push: async v => { const k = 'x' + Date.now() + (++n); write(p + '/' + k, v); return { key: k }; },
    orderByChild: c => ({ equalTo: x => ({ get: async () => { const all = read(p) || {}; const out = {};
      Object.keys(all).forEach(k => { if (all[k] && all[k][c] === x) out[k] = all[k]; }); return snap(split(p).pop(), Object.keys(out).length ? out : null); } }) }),
  });
  return { ref };
}
async function stageAccount(body, asUser) {
  const db = stageDb(), users = TREE.users || {};
  const find = q => { q = String(q || '').trim();
    const uid = users[q] ? q : Object.keys(users).find(k => String(users[k].email || '').toLowerCase() === q.toLowerCase());
    if (!uid) throw new Error('No account with that email or uid.');
    const r = users[uid]; return { uid, email: r.email || '', emailVerified: true, disabled: false, providers: ['password'],
      created: new Date(r.createdAt || Date.now()).toUTCString(), lastSignIn: new Date().toUTCString(), tier: r.tier || 'free',
      decks: Object.keys(r.presentations || {}).length, classes: Object.keys(r.classes || {}).length, workspaceId: r.workspaceId || null,
      stripeCustomerId: r.stripeCustomerId || null, pendingEmail: r.pendingEmail || null }; };
  const audit = e => db.ref('admin/account_audit').push(Object.assign({ at: Date.now(), by: asUser.email }, e));
  switch (body.action) {
    case 'adminFind': return { ok: true, user: find(body.query) };
    case 'adminChangeEmail': {
      const u = find(body.uid); const next = String(body.newEmail || '').toLowerCase().trim();
      if (!body.reason) throw new Error('Record how you verified the request (SOP step 2).');
      if (Object.values(users).some(x => String(x.email || '').toLowerCase() === next)) throw new Error('Another account already uses that email. Move content instead (SOP: duplicate accounts).');
      const r = await AccountLib.syncEmail(db, { uid: u.uid, newEmail: next, oldEmails: [u.email] });
      await audit({ type: 'email_changed', uid: u.uid, from: u.email, to: next, self: false, reason: body.reason, done: r.done, problems: r.problems });
      return { ok: true, done: r.done, problems: r.problems };
    }
    case 'adminTransferPlan': return { ok: true, plan: await AccountLib.transferPlan(db, body.fromUid, body.toUid) };
    case 'adminTransferRun': {
      if (body.confirm !== 'MOVE') throw new Error('Type MOVE to confirm.');
      if (!body.reason) throw new Error('Record how you verified both accounts belong to this person (SOP).');
      const r = await AccountLib.transferRun(db, body.fromUid, body.toUid, { actor: asUser.email });
      await audit({ type: 'content_moved', uid: body.fromUid, toUid: body.toUid, transfer: r.id, moved: r.moved, reason: body.reason });
      return { ok: true, result: r };
    }
    case 'adminTransferUndo': { const r = await AccountLib.transferUndo(db, body.id); await audit({ type: 'content_move_undone', transfer: r.id }); return { ok: true, result: r }; }
    case 'syncEmail': return { ok: true, changed: false };
  }
  throw new Error('Unknown action.');
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
      /* AI Insights and the live co-pilot on the stage: worked out from the answers actually on
         screen (counted, not invented), so a video shows numbers that match the room. */
      if (p === '/api/insights') return setTimeout(() => json(res, 200, insightsAnswer(body)), 1600);
      if (p === '/api/copilot') return setTimeout(() => json(res, 200, copilotAnswer(body)), 1600);
      // The app falls back to the same database writes the real /api/team makes when the
      // endpoint is unavailable — exactly what a video needs, with nothing to reimplement.
      if (p === '/api/team') {
        /* Team hub actions (library, usage, bulk tools) run the REAL lib/team-hub.js against the
           stage database, so those screens can be built, tested and filmed end to end. Every
           other team action still answers 503, so the app uses its direct-write fallback. */
        const Hub = require(path.join(ROOT, 'lib', 'team-hub.js'));
        if (Hub.HUB_ACTIONS.includes(body.action)) {
          const who = USERS[(req.headers.referer && new URL(req.headers.referer).searchParams.get('as')) || ''] || USER;
          const db = stageDb();
          const ctx = { callerUid: who.uid, callerEmail: who.email, isSiteAdmin: who.email === 'help@pollslide.com',
            mail: async () => {}, detachMember: async (wsId, uid) => { await db.ref('workspaces/' + wsId + '/members/' + uid).remove(); await db.ref('users/' + uid + '/workspaceId').remove(); await db.ref('users/' + uid + '/tier').set('free'); } };
          try { const r = await Hub.handle(db, ctx, body); return json(res, r ? r.status : 400, r ? r.body : { error: 'Unknown action' }); }
          catch (e) { return json(res, 500, { error: e.message }); }
        }
        return json(res, 503, {});
      }
      if (p === '/api/helpbot') {
        /* Slidekick on the stage: the REAL lib/helpbot.js and the real LOCAL model (Ollama on
           this Mac, gemma4 — what production tries first), so it can be tested and filmed
           end to end. No Ollama → keyword search, exactly like production with both AIs down. */
        const H = require(path.join(ROOT, 'lib', 'helpbot.js'));
        const lang = H.LANG_NAMES[body.lang] ? body.lang : 'en', q = String(body.question || '').slice(0, 500);
        if (body.mode === 'quick') return json(res, 200, { ok: true, quick: true, topics: H.cards(H.search(q, 3).map(t => t.id), lang) });
        let out = null;
        try {
          const r = await fetch('http://localhost:11434/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: process.env.STAGE_HELPBOT_MODEL || 'gemma4:latest', messages: H.buildMessages(q, lang), response_format: { type: 'json_object' }, temperature: 0 }) });
          const d = await r.json();
          out = H.validate(String(d.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, ''));
        } catch (e) {}
        if (!out) { const hits = H.search(q, 3); out = { topics: hits.map(t => t.id), answer: '', confident: hits.length > 0 }; }
        return json(res, 200, { ok: true, answer: out.answer, confident: out.confident, topics: H.cards(out.topics, lang) });
      }
      if (p === '/api/account') {
        const who = USERS[(req.headers.referer && new URL(req.headers.referer).searchParams.get('as')) || ''] || USER;
        try { return json(res, 200, await stageAccount(body, who)); } catch (e) { return json(res, 400, { error: e.message }); }
      }
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
