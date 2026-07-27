// PollSlide — Polly Live Co-pilot: read the room MID-SESSION and suggest the next question.
//
// While a question is live, the presenter can ask Polly "what should I ask next?" — Polly
// reads what the audience has ALREADY answered and proposes 2-3 ready-to-launch follow-ups
// (multiple choice, correct answer marked where it makes sense). One click adds + launches.
//
// Same local-first provider model as api/polly.js and api/insights.js: the owner's Mac
// (Ollama) answers first, OpenAI is the fallback. Because inference runs locally, doing
// this on EVERY question costs ~nothing — cloud-billed rivals pay per call.
//
// FALLBACK BEHAVIOUR (deliberate, three layers deep — the presenter is on stage, so this
// must never hang or show an error where a suggestion should be):
//   1. Local Mac unreachable / too slow / malformed  → OpenAI.
//   2. OpenAI missing or failing                     → 200 with suggestions:[] + `degraded`
//                                                      so the UI shows a calm "not available
//                                                      right now" instead of an error.
//   3. Nothing is ever auto-launched — the presenter always chooses.
//
// Signed-in presenters only. NOT metered against the monthly Polly quota (same rationale
// as Insights: it analyses data the audience already gave).
//
// POST { question, texts:[], options:[], counts:[], topic, language, sessionCode }
//   → { ok:true, source, suggestions:[{ text, options:[4], answerIndex|null, why }] }

const admin = require('firebase-admin');
const { verifyToken, tokenFrom, getApp } = require('../lib/quota');

const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const OPENAI_BASE       = 'https://api.openai.com/v1';
const LOCAL_LLM_URL     = process.env.LOCAL_LLM_URL || '';
const LOCAL_LLM_MODEL   = process.env.LOCAL_LLM_MODEL || 'qwen3:14b';
const LOCAL_REASONING_EFFORT = process.env.LOCAL_REASONING_EFFORT || '';

const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET }
  : {};

// Tighter than Polly's: the presenter is standing in front of a room. Better to come back
// empty fast than to leave them waiting. Overridable if the local model is slower.
const LOCAL_TIMEOUT_MS = parseInt(process.env.COPILOT_LOCAL_TIMEOUT_MS, 10) || 20000;
const CLOUD_TIMEOUT_MS = parseInt(process.env.COPILOT_CLOUD_TIMEOUT_MS, 10) || 12000;

const LANG_NAMES = { en:'English', es:'Spanish', de:'German', fr:'French', pt:'Portuguese', it:'Italian', nl:'Dutch', ja:'Japanese', zh:'Chinese (Simplified)', ar:'Arabic', hi:'Hindi' };

async function callChat({ baseURL, apiKey, model, messages, timeoutMs, extraHeaders = {}, reasoningEffort }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({
        model, messages, temperature: 0.7,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!r.ok) { const d = await r.text().catch(() => ''); throw new Error(`HTTP ${r.status} ${d.slice(0, 200)}`); }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  } finally { clearTimeout(timer); }
}

function buildMessages({ question, texts, distribution, topic, language }) {
  const langName = LANG_NAMES[language] || 'English';
  const langRule = (language && language !== 'en')
    ? ` Write every question, option and reason in ${langName}.` : '';
  const schema = `{
  "suggestions": [
    {
      "text": "the follow-up question to put on screen",
      "options": ["option 1","option 2","option 3","option 4"],
      "answer": "the correct option copied WORD-FOR-WORD, or \\"\\" if this is an opinion question with no right answer",
      "why": "max 12 words: why THIS question, right now, given what the room just said"
    }
  ]
}`;
  const system =
    `You are Polly, PollSlide's live co-pilot standing beside a presenter mid-session. ` +
    `You have just seen how the audience answered the question on screen. Propose 3 follow-up questions the presenter could launch RIGHT NOW to build on that reaction. ` +
    `Rules: each follow-up must clearly RESPOND to what the room actually said — dig into a split, probe a common misconception, or push the majority view further. ` +
    `Never repeat the question they just answered. Exactly 4 options each. Keep questions short enough to read from the back of a room. ` +
    `Mark the correct option in "answer" for factual questions; use an empty string for opinion questions. ` +
    `The "why" is for the presenter's eyes only — it must reference the actual responses.${langRule} ` +
    `Return ONLY a JSON object of exactly this shape: ${schema}`;

  const parts = [];
  if (topic) parts.push(`Session topic: ${topic}`);
  parts.push(`Question on screen: ${question || '(not provided)'}`);
  if (distribution) parts.push(`How the room answered:\n${distribution}`);
  if (texts && texts.length) parts.push(`Their written answers (${texts.length}):\n` + texts.map((t, i) => `${i + 1}. ${t}`).join('\n'));
  return [{ role: 'system', content: system }, { role: 'user', content: parts.join('\n\n') }];
}

// Normalise into exactly what the presenter can launch: 4 options, a resolved answer index
// (or null for opinion questions). Anything malformed is dropped rather than shown.
function parseSuggestions(raw) {
  if (!raw) return null;
  let obj;
  try { obj = JSON.parse(raw); }
  catch { const m = raw.match(/\{[\s\S]*\}/); try { obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; } }
  const list = Array.isArray(obj) ? obj : (obj && (obj.suggestions || obj.questions));
  if (!Array.isArray(list)) return null;

  const out = [];
  for (const s of list.slice(0, 5)) {
    if (!s || typeof s !== 'object') continue;
    const text = String(s.text || s.question || '').trim().slice(0, 300);
    let options = (Array.isArray(s.options) ? s.options : [])
      .map(o => (typeof o === 'string' ? o : (o && o.text) || ''))
      .map(o => String(o).trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 4);
    if (!text || options.length < 2) continue;
    while (options.length < 4) options.push('');            // the editor expects 4 slots
    const ansRaw = String(s.answer == null ? '' : s.answer).trim().toLowerCase();
    let answerIndex = null;
    if (ansRaw) {
      const i = options.findIndex(o => o.trim().toLowerCase() === ansRaw);
      if (i >= 0) answerIndex = i;
      else if (/^[a-d]$/.test(ansRaw)) answerIndex = ansRaw.charCodeAt(0) - 97;   // letter fallback
    }
    if (answerIndex != null && (answerIndex < 0 || answerIndex >= options.length)) answerIndex = null;
    out.push({ text, options, answerIndex, why: String(s.why || '').trim().slice(0, 140) });
  }
  return out.length ? out : null;
}

// Best-effort support log — shares admin/polly_log/<uid> with Polly so one panel in the
// admin User detail answers "what did the AI do for this user?". Never throws.
async function logCopilot(uid, entry) {
  if (!uid) return;
  try { await admin.database(getApp()).ref('admin/polly_log/' + uid).push({ t: Date.now(), kind: 'copilot', ...entry }); }
  catch (e) { /* logging must never affect the presenter */ }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  let uid = null;
  try {
    // Signed-in presenters only — prevents anonymous abuse of the AI endpoint.
    try { const who = await verifyToken(tokenFrom(req)); uid = who && who.uid; }
    catch (e) { return res.status(401).json({ error: 'Sign in to use the Co-pilot.' }); }

    const body     = req.body || {};
    const question = String(body.question || '').slice(0, 300);
    const topic    = String(body.topic || '').slice(0, 200);
    const language = body.language ? String(body.language).slice(0, 8) : 'en';
    const texts    = (Array.isArray(body.texts) ? body.texts : [])
      .map(t => String(t == null ? '' : t).trim()).filter(Boolean).map(t => t.slice(0, 300)).slice(0, 120);

    // Choice questions arrive as option labels + counts; render them as a readable tally.
    const options = (Array.isArray(body.options) ? body.options : []).map(o => String(o == null ? '' : o).slice(0, 120)).slice(0, 8);
    const counts  = (Array.isArray(body.counts)  ? body.counts  : []).map(n => Math.max(0, parseInt(n, 10) || 0)).slice(0, 8);
    const distribution = options.length
      ? options.map((o, i) => `- ${o}: ${counts[i] || 0} vote(s)`).join('\n')
      : '';

    if (!texts.length && !distribution) {
      return res.status(400).json({ error: 'Need some audience responses first.' });
    }

    const messages = buildMessages({ question, texts, distribution, topic, language });
    let suggestions = null, source = '';

    // 1) The presenter's own Mac first (near-free, private, and usually fastest when warm).
    if (LOCAL_LLM_URL) {
      try {
        const raw = await callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_LLM_MODEL, messages, timeoutMs: LOCAL_TIMEOUT_MS, extraHeaders: CF_ACCESS_HEADERS, reasoningEffort: LOCAL_REASONING_EFFORT });
        suggestions = parseSuggestions(raw);
        if (suggestions) source = 'local';
      } catch (err) { console.warn('Co-pilot: local LLM failed (' + err.message + ') → OpenAI fallback'); }
    }

    // 2) OpenAI fallback — on local unreachable, too slow, OR unparseable output.
    if (!suggestions && OPENAI_API_KEY) {
      try {
        const raw = await callChat({ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL, messages, timeoutMs: CLOUD_TIMEOUT_MS });
        suggestions = parseSuggestions(raw);
        if (suggestions) source = 'openai';
      } catch (err) { console.error('Co-pilot: OpenAI error:', err.message); }
    }

    // 3) Both unavailable → a calm, explicit "not right now". Deliberately 200, not 502:
    //    the presenter is mid-session and this is an optional assist, never an error state.
    if (!suggestions) {
      await logCopilot(uid, { question: question.slice(0, 120), responses: texts.length || counts.reduce((a, b) => a + b, 0), ok: false, degraded: true });
      return res.status(200).json({ ok: true, degraded: true, suggestions: [], source: '',
        note: 'Polly could not reach an AI service just now — your session carries on as normal.' });
    }

    await logCopilot(uid, { question: question.slice(0, 120), responses: texts.length || counts.reduce((a, b) => a + b, 0), delivered: suggestions.length, source, ok: true });
    return res.status(200).json({ ok: true, source, suggestions });
  } catch (e) {
    // Even an unexpected crash degrades gracefully rather than alarming a live presenter.
    console.error('Co-pilot fatal:', e && e.message);
    return res.status(200).json({ ok: true, degraded: true, suggestions: [], source: '',
      note: 'Polly hit a snag — your session carries on as normal.' });
  }
};
