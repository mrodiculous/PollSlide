// PollSlide — Polly Insights: turn free-text audience responses into live THEMES,
// sentiment, and a one-line summary — on the big screen, in seconds.
//
// Same local-first provider model as api/polly.js: the presenter's own Mac (Ollama)
// answers first, OpenAI is the fallback. Because inference runs locally, analyzing
// every response costs ~nothing — a differentiator cloud-billed rivals can't match.
//
// Signed-in presenters only. NOT metered against the monthly Polly question quota
// (this is a lightweight, presenter-side analysis of data the audience already gave).
//
// POST { question, texts:[...], language } →
//   { source, count, summary, sentiment:{positive,neutral,negative}, themes:[{label,count,sentiment,example}] }

const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const OPENAI_BASE       = 'https://api.openai.com/v1';
const LOCAL_LLM_URL     = process.env.LOCAL_LLM_URL || '';
const LOCAL_LLM_MODEL   = process.env.LOCAL_LLM_MODEL || 'qwen3:14b';

const { verifyToken, tokenFrom } = require('../lib/quota');

const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET }
  : {};

const LOCAL_TIMEOUT_MS = 30000;
const CLOUD_TIMEOUT_MS = 20000;

const LANG_NAMES = { en:'English', es:'Spanish', de:'German', fr:'French', pt:'Portuguese', it:'Italian', nl:'Dutch', ja:'Japanese', zh:'Chinese (Simplified)', ar:'Arabic', hi:'Hindi' };

async function callChat({ baseURL, apiKey, model, messages, timeoutMs, extraHeaders = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({ model, messages, temperature: 0.3, response_format: { type: 'json_object' } }),
      signal: controller.signal,
    });
    if (!r.ok) { const d = await r.text().catch(() => ''); throw new Error(`HTTP ${r.status} ${d.slice(0, 200)}`); }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  } finally { clearTimeout(timer); }
}

function buildMessages(question, texts, language) {
  const langName = LANG_NAMES[language] || 'English';
  const langRule = (language && language !== 'en') ? ` Write every label, example and the summary in ${langName}.` : '';
  const schema = `{
  "summary": "one plain-language sentence capturing the overall response",
  "sentiment": { "positive": <int>, "neutral": <int>, "negative": <int> },
  "themes": [ { "label": "2-4 word theme", "count": <how many answers fit it>, "sentiment": "positive|neutral|negative", "example": "one short verbatim example from the answers" } ]
}`;
  const system =
    `You are Polly, PollSlide's live audience analyst. Read the audience's free-text answers to a presenter's question and distill them so the presenter can react on stage. ` +
    `Identify 3-6 clear THEMES (most common first) with a rough count each, estimate overall sentiment as three integer percentages that sum to about 100, and write ONE plain summary sentence. ` +
    `Use ONLY what the answers actually say — never invent opinions or examples.${langRule} ` +
    `Return ONLY a JSON object of exactly this shape: ${schema}`;
  const user = `Question: ${question || '(not provided)'}\n\nAnswers (${texts.length} total):\n` + texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function parseInsights(raw) {
  if (!raw) return null;
  let obj;
  try { obj = JSON.parse(raw); }
  catch { const m = raw.match(/\{[\s\S]*\}/); try { obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; } }
  if (!obj || typeof obj !== 'object') return null;
  const clampPct = n => Math.max(0, Math.min(100, parseInt(n, 10) || 0));
  const themes = Array.isArray(obj.themes) ? obj.themes.slice(0, 8).map(t => ({
    label: String(t.label || '').slice(0, 60),
    count: Math.max(0, parseInt(t.count, 10) || 0),
    sentiment: ['positive', 'neutral', 'negative'].includes(t.sentiment) ? t.sentiment : 'neutral',
    example: String(t.example || '').slice(0, 160),
  })).filter(t => t.label) : [];
  const s = obj.sentiment || {};
  return {
    summary: String(obj.summary || '').slice(0, 400),
    sentiment: { positive: clampPct(s.positive), neutral: clampPct(s.neutral), negative: clampPct(s.negative) },
    themes,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });
  if (!OPENAI_API_KEY && !LOCAL_LLM_URL) return res.status(500).json({ error: 'No AI configured.' });

  try {
    // Signed-in presenters only — prevents anonymous abuse of the AI endpoint.
    try { await verifyToken(tokenFrom(req)); }
    catch (e) { return res.status(401).json({ error: 'Sign in to use Insights.' }); }

    const body     = req.body || {};
    const question = String(body.question || '').slice(0, 300);
    const language = body.language ? String(body.language).slice(0, 8) : 'en';
    let texts = Array.isArray(body.texts) ? body.texts : [];
    texts = texts.map(t => String(t == null ? '' : t).trim()).filter(Boolean).map(t => t.slice(0, 400)).slice(0, 300);
    if (texts.length < 2) return res.status(400).json({ error: 'Need at least 2 responses to analyze.' });

    const messages = buildMessages(question, texts, language);
    let raw = '', source = '';

    // 1) The presenter's own Mac first (near-free, private).
    if (LOCAL_LLM_URL) {
      try { raw = await callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_LLM_MODEL, messages, timeoutMs: LOCAL_TIMEOUT_MS, extraHeaders: CF_ACCESS_HEADERS }); source = 'local'; }
      catch (err) { console.warn('Insights: local LLM unreachable → OpenAI fallback:', err.message); }
    }
    // 2) OpenAI fallback.
    if (!raw) {
      if (!OPENAI_API_KEY) return res.status(502).json({ error: 'Local LLM unreachable and no OpenAI key set.' });
      try { raw = await callChat({ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL, messages, timeoutMs: CLOUD_TIMEOUT_MS }); source = 'openai'; }
      catch (err) { return res.status(502).json({ error: 'Insights failed', detail: err.message }); }
    }

    const insights = parseInsights(raw);
    if (!insights) return res.status(502).json({ error: 'Could not parse insights.' });
    return res.status(200).json({ source, count: texts.length, ...insights });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
