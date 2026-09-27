/* When an outside service says no, the teacher gets a sentence and Rod gets an alert.
 *
 * 2026-09-26: after "GIFs for every question and answer" on a 30-question deck (145
 * searches), GIPHY's hourly limit ran out. Every picker search then failed, the page showed
 * Safari's "The string did not match the expected pattern", and nothing told anyone.
 * Every earlier test fed the GIF code a HAPPY provider — nothing ever played the provider
 * saying no. These do. Run: node scripts/tests/provider-failures.test.js */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));

// ── A fake Firebase Admin + quota, so the REAL api/gif-search.js runs ─────────────
const writes = [];
function fakeDb() {
  const ref = (p) => ({ child: (c) => ref(p + '/' + c), push: async (v) => writes.push(['push', p, v]), set: async (v) => writes.push(['set', p, v]),
    transaction: async (fn) => { const v = fn(0); writes.push(['tx', p, v]); return { committed: true }; }, get: async () => ({ val: () => null }) });
  return { ref };
}
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'firebase-admin') return { database: () => fakeDb() };
  if (/lib\/quota$/.test(req)) return { getApp: () => ({}), verifyToken: async () => ({ uid: 'u1', email: 't@example.com' }) };
  if (/lib\/guard$/.test(req)) return { rateLimit: async () => ({ allowed: true }), clientIp: () => '1.1.1.1', sweepRateLimits: () => {} };
  return origLoad.apply(this, arguments);
};
process.env.GIPHY_API_KEY = 'test';
const handler = require(path.join(ROOT, 'api', 'gif-search.js'));
Module._load = origLoad;

function call(providerStatus, providerBody) {
  global.fetch = async () => ({ ok: providerStatus < 400, status: providerStatus,
    text: async () => JSON.stringify(providerBody || {}), json: async () => providerBody || {} });
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o }); return this; }, end() { resolve({ code: this.code }); } };
    handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { q: 'koala', limit: 24 } }, res);
  });
}

(async () => {
  console.log('\nGIF search when GIPHY says no');
  writes.length = 0;
  const q = await call(429, { message: 'API rate limit exceeded' });
  ok('an exhausted hourly limit answers 429, not 502', q.code === 429, q.code);
  ok('…with a sentence a teacher understands', /try again in a few minutes/i.test(q.body.error), q.body.error);
  ok('…and a machine-readable code', q.body.code === 'provider_quota');
  ok('…and it is recorded for the watchdog', writes.some(w => /feature_health\/gif_search/.test(w[1]) && w[0] === 'tx'));
  const e = await call(500, {});
  ok('any other provider error answers 503, never 502', e.code === 503 && /having trouble/.test(e.body.error), e);
  const good = await call(200, { data: [] });
  ok('a healthy provider still answers 200', good.code === 200 && good.body.ok === true, good.code);

  console.log('\nNo API answers 502 (a platform may replace a 502 body, which browsers then cannot read)');
  const apis = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'));
  const with502 = apis.filter(f => /status\(\s*502\s*\)/.test(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8')));
  ok('no endpoint sends status 502', !with502.length, with502);

  console.log('\nThe browser reads GIF answers defensively');
  const pres = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
  const calls = pres.split("fetch('/api/gif-search'").length - 1;
  ok('presenter calls /api/gif-search in exactly one place (gifApi)', calls === 1, calls);
  const helper = pres.slice(pres.indexOf('async function gifApi('), pres.indexOf('function runGifSearch('));
  ok('gifApi parses text with a try, never r.json()', /JSON\.parse\(text\)/.test(helper) && !/\.json\(\)/.test(helper));
  ok('gifApi reports failures to Admin → Errors', /psReportError/.test(helper));
  ok('a deck-wide fill stops asking once the hourly limit is hit', /if \(quotaHit\) break;/.test(pres));
  const loop = fs.readFileSync(path.join(ROOT, 'loop.html'), 'utf8');
  ok('LoopSlide GIF search reads defensively too', /fetch\('\/api\/gif-search'[\s\S]{0,200}readJson\(r\)/.test(loop));

  console.log('\nThe watchdog notices');
  const W = require(path.join(ROOT, 'lib', 'watchdog.js'));
  const now = Date.now();
  const r1 = W.evalFeatureHealth({ now, gif: { fail: 16, last: { at: now - 60000, code: 'provider_quota', detail: 'giphy 429' } }, polly: {} });
  ok('16 GIF failures in the last hour opens an incident', r1.ok === false && /16/.test(r1.detail), r1);
  const r2 = W.evalFeatureHealth({ now, probe: { ok: false, status: 429, at: now }, gif: {}, polly: {} });
  ok('a failing hourly probe opens it even when nobody is searching', r2.ok === false && /hourly limit/.test(r2.detail));
  const r3 = W.evalFeatureHealth({ now, gif: { fail: 2, last: { at: now } }, probe: { ok: true, status: 200 }, polly: { runs: 10, short: 1 } });
  ok('a couple of stray failures is not an alarm', r3.ok === true, r3);
  const r4 = W.evalFeatureHealth({ now, gif: {}, polly: { runs: 8, short: 4, lastShort: { requested: 30, delivered: 29, topic: 'volcanoes' } } });
  ok('Polly repeatedly coming up short opens an incident', r4.ok === false && /29\/30/.test(r4.detail), r4);
  const wd = fs.readFileSync(path.join(ROOT, 'api', 'watchdog.js'), 'utf8');
  ok('the feature_health check is wired into the watchdog', /id: 'feature_health'/.test(wd) && /evaluate: evalFeatureHealth/.test(wd));
  ok('a daily health email goes out either way', /Daily health: everything is working/.test(wd) && /lastDigestDay/.test(wd));

  console.log('\nPolly stays on topic');
  const P = require(path.join(ROOT, 'api', 'polly.js')).__test;
  const m = P.buildMessages({ topic: 'the French Revolution', type: 'quiz', count: 30 }).map(x => x.content).join('\n');
  ok('a specific topic is locked in', /squarely about: the French Revolution/.test(m));
  ok('…and is never told to spread across different subject areas', !/different subject areas/.test(m));
  ok('…and the variety lens stays inside the topic', /only within it/.test(P.varietyNudge('the French Revolution')));
  const b = P.buildMessages({ topic: 'pub quiz, all genres', type: 'quiz', count: 30 }).map(x => x.content).join('\n');
  ok('a broad pub-quiz topic may still roam', /different subject areas/.test(b) && !/squarely about/.test(b));
  const polly = fs.readFileSync(path.join(ROOT, 'api', 'polly.js'), 'utf8');
  ok('the top-up asks for spares and survives one empty round', /missing \* 0\.15/.test(polly) && /emptyRounds >= 2/.test(polly));
  ok('each batch gets a second-opinion review (facts + topic)', /await review\(fresh, topic, type, sourceMaterial\)/.test(polly));
  console.log('\nPolly writes plain, checked facts (2026-09-27)');
  ok('markdown and asterisks are stripped, emojis kept', P.plain('**Which** planet is *red*? 🔴 **') === 'Which planet is red? 🔴');
  const nq = P.normalizeQuestions(JSON.stringify({ questions: [
    { text: 'Q1', options: ['A1', 'B1', 'C1', 'D1'], answers: ['Not an option'] },
    { text: '**Q2**', options: ['Mars', 'Venus', 'Earth', 'Jupiter'], answers: ['Mars'], explanation: '*Red* planet' }] }), 'quiz');
  ok('a question whose answer matches no option is dropped, not marked "A"', nq.length === 1 && nq[0].text === 'Q2' && nq[0].correctAnswers[0] === 0, nq);
  ok('…and the survivor is plain text', nq[0].explanation === 'Red planet');
  const qm = P.buildMessages({ topic: 'the planets', type: 'quiz', count: 5 }).map(x => x.content).join('\n');
  ok('the prompt asks for creative questions and strict facts, and forbids markdown', /BE CREATIVE IN HOW YOU ASK, STRICT ABOUT WHAT IS TRUE/.test(qm) && /no markdown, no asterisks/.test(qm));
  ok('surveys are not told there is a right answer', !/STRICT ABOUT WHAT IS TRUE/.test(P.buildMessages({ topic: 'lunch', type: 'survey', count: 3 }).map(x => x.content).join('\n')));
  ok('the writer stays creative (0.7–0.8); the checker is strict (0)', /\(type === 'poll' \|\| type === 'survey'\) \? 0\.8 : 0\.7/.test(polly) && /messages, temperature: 0,/.test(polly));
  ok('every batch is fact-checked by a separate call at temperature 0', /async function review\(/.test(polly) && /messages, temperature: 0,/.test(polly) && /marked answer is wrong, disputed, out of date/.test(polly));
  ok('a stronger checker model can be set on its own (POLLY_CHECK_MODEL)', /process\.env\.POLLY_CHECK_MODEL \|\| OPENAI_TEXT_MODEL/.test(polly));
  ok('an unchecked batch is counted, not hidden', /bump\('unchecked', entry\.unchecked\)/.test(polly));
  ok('a short delivery is told to the teacher', /Polly wrote \$\{added\} of the \$\{data\.requested\}/.test(pres));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
