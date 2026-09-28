/* Polly on OpenAI, end to end against api/polly.js with a pretend OpenAI (2026-09-28).
 *
 * Rod: "⚠️ Polly hit a server error (524)… it was also taking very long". Two causes:
 *   • Newer OpenAI models refuse a custom temperature. Every call failed, and Polly quietly
 *     fell back to the Mac — slow, and the model that invents facts.
 *   • Batches ran one after another, so 30 questions ran past Cloudflare's 100-second limit.
 * Run: node scripts/tests/polly-openai.test.js */
const path = require('path'), Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));

process.env.OPENAI_API_KEY = 'sk-test';
process.env.OPENAI_TEXT_MODEL = 'gpt-6-luna';
process.env.LOCAL_LLM_URL = 'http://mac.local:11434/v1';
const fakeDb = { ref: () => ({ push: async () => {}, set: async () => {}, child: () => ({ transaction: async () => {}, set: async () => {} }), transaction: async () => {} }) };
const orig = Module._load;
Module._load = function (req) {
  if (req === 'firebase-admin') return { database: () => fakeDb };
  if (/lib\/quota$/.test(req)) return { checkQuota: async () => ({ uid: 'u1', ok: true }), consumeQuota: async () => {}, getApp: () => ({}) };
  return orig.apply(this, arguments);
};
const handler = require(path.join(ROOT, 'api', 'polly.js'));
Module._load = orig;

let calls = [], inFlight = 0, maxInFlight = 0, qn = 0;
global.fetch = async (url, o) => {
  const body = JSON.parse(o.body || '{}');
  calls.push({ url, body });
  if (url.startsWith('http://mac.local')) return { ok: true, json: async () => ({ choices: [{ message: { content: '{"questions":[]}' } }] }) };
  // This model, like newer OpenAI models, refuses a custom temperature.
  if ('temperature' in body && body.temperature !== 1) {
    return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported." } }) };
  }
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise(r => setTimeout(r, 60));
  inFlight--;
  const sys = body.messages[0].content;
  if (/fact-checker/.test(sys)) return { ok: true, json: async () => ({ choices: [{ message: { content: '{"flag":[]}' } }] }) };
  const m = /Create (\d+) quiz question/.exec(body.messages[1].content); const k = m ? +m[1] : 5;
  const qs = Array.from({ length: k }, () => { qn++; return { text: `Planet fact number ${qn} about moon count ${qn * 7}?`, options: [`A${qn}`, `B${qn}`, `C${qn}`, `D${qn}`], answers: [`A${qn}`], kind: 'single', explanation: `Because ${qn}.` }; });
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ questions: qs }) } }] }) };
};
function run(body) {
  return new Promise((resolve) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); return this; }, end() { resolve({ code: this.code }); } };
    handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res);
  });
}

(async () => {
  console.log('\nPolly with a model that refuses a custom temperature');
  const t0 = Date.now();
  const r = await run({ topic: 'the planets of the solar system', type: 'quiz', count: 30 });
  const ms = Date.now() - t0;
  ok('30 questions come back', r.code === 200 && r.body.questions && r.body.questions.length === 30, r.body && (r.body.questions || []).length);
  ok('…written by OpenAI, not the Mac', r.body.source === 'openai' && !calls.some(c => c.url.startsWith('http://mac.local')), r.body.source);
  const oa = calls.filter(c => c.url.includes('api.openai.com'));
  const withT = oa.map((c, i) => ('temperature' in c.body) ? i : -1).filter(i => i >= 0);
  ok('the refused setting is dropped and remembered (only the first parallel calls ever send it)', withT.length <= 4 && withT.every(i => i < 4) && oa.length > 8, withT);
  ok('OpenAI is asked to think briefly (reasoning_effort low)', calls.filter(c => c.url.includes('api.openai.com')).every(c => c.body.reasoning_effort === 'low'));
  ok('batches run in parallel', maxInFlight >= 3, maxInFlight);
  ok('every batch is fact-checked', calls.filter(c => /fact-checker/.test((c.body.messages || [])[0]?.content || '')).length >= 3);
  ok('it finishes well inside the time limit', ms < 5000, ms);
  const src = require('fs').readFileSync(path.join(ROOT, 'api', 'polly.js'), 'utf8');
  ok('the whole request is capped under Cloudflare\'s 100 seconds', /Math\.min\(parseInt\(process\.env\.POLLY_BUDGET_MS, 10\) \|\| 80000, 85000\)/.test(src));
  const pres = require('fs').readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
  ok('a timeout reads "took too long", not "check the AI key"', /r\.status === 524 \|\| r\.status === 504\) \? 'Polly took too long/.test(pres) && !/Check the AI key in Vercel/.test(pres));
  ok('teachers never see which AI or computer wrote the questions', !/your Mac 🖥️|OpenAI ☁️/.test(pres));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
