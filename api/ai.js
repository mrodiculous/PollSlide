// PollSlide — AI text features (summaries + grading)
// Vercel Serverless Function.
//
// Tasks:
//   • summarize_responses — turn open-ended answers into themes + sentiment + a blurb
//   • grade              — score free-text answers against an expected answer
//
// PROVIDER (local-first — same scheme as Polly + translation):
//   1) LOCAL LLM (LOCAL_LLM_URL) — your Mac (Ollama via the Cloudflare tunnel), $0
//   2) OpenAI    (OPENAI_API_KEY) — fallback when the Mac is asleep/unreachable
//
// VERCEL ENV: LOCAL_LLM_URL (+ CF_ACCESS_CLIENT_ID/SECRET) and/or OPENAI_API_KEY; optional
//   LOCAL_LLM_MODEL (default qwen3:14b), OPENAI_TEXT_MODEL (gpt-4o-mini), NEXT_PUBLIC_APP_URL (CORS).

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const OPENAI_MODEL    = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const OPENAI_BASE     = 'https://api.openai.com/v1';

const LOCAL_LLM_URL   = process.env.LOCAL_LLM_URL || '';
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen3:14b';

const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET }
  : {};

const LOCAL_TIMEOUT_MS = 30000;  // summaries/grading can be long; give the Mac room
const CLOUD_TIMEOUT_MS = 20000;

// One helper for BOTH local Ollama and OpenAI — identical request shape (mirrors Polly).
async function callChat({ baseURL, apiKey, model, system, user, maxTokens, timeoutMs, extraHeaders = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [{ role:'system', content: system }, { role:'user', content: user }],
      }),
      signal: controller.signal,
    });
    if (!r.ok) { const d = await r.text().catch(()=> ''); throw new Error(`HTTP ${r.status} ${d.slice(0,160)}`); }
    const d = await r.json();
    return d.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}
async function callLLM(system, user, maxTokens) {
  // 1) Local Mac first.
  if (LOCAL_LLM_URL) {
    try {
      const text = await callChat({ baseURL: LOCAL_LLM_URL, apiKey:'ollama', model: LOCAL_LLM_MODEL, system, user, maxTokens, timeoutMs: LOCAL_TIMEOUT_MS, extraHeaders: CF_ACCESS_HEADERS });
      if (text) return { text, source:'local' };
    } catch (err) { console.warn('ai.js: local LLM unreachable → OpenAI fallback:', err.message); }
  }
  // 2) OpenAI fallback.
  if (OPENAI_API_KEY) return { text: await callChat({ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_MODEL, system, user, maxTokens, timeoutMs: CLOUD_TIMEOUT_MS }), source:'openai' };
  throw { code:500, msg:'No AI configured. Add LOCAL_LLM_URL (your Mac) or OPENAI_API_KEY in Vercel → Settings → Environment Variables.' };
}
function extractJSON(t) {
  if (!t) return null;
  const m = t.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch(e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const task = body.task;

    if (task === 'summarize_responses') {
      const question  = String(body.question || '').slice(0, 500);
      const responses = (Array.isArray(body.responses) ? body.responses : []).map(s => String(s||'').slice(0,500)).filter(Boolean).slice(0, 400);
      if (responses.length === 0) return res.status(400).json({ error: 'No responses to summarize.' });
      const system = 'You analyze open-ended audience responses for a presenter. Be concise, neutral, and faithful to the data. Respond with ONLY a JSON object, no prose, no code fences.';
      const user = `Question: "${question}"\n\nResponses (${responses.length}):\n- ${responses.join('\n- ')}\n\n`+
        `Return JSON exactly: {"summary":"2-3 sentence overview of what people said","themes":[{"label":"short theme name","count":<approx number of responses in this theme>}],"sentiment":{"positive":<count>,"neutral":<count>,"negative":<count>},"standout":"one short representative or notable quote"}. Use at most 6 themes. Counts should roughly add up to the total.`;
      const { text, source } = await callLLM(system, user, 900);
      const parsed = extractJSON(text);
      if (!parsed) return res.status(502).json({ error: 'AI returned an unreadable result. Try again.' });
      return res.status(200).json({ ok:true, source, ...parsed });
    }

    if (task === 'grade') {
      const question  = String(body.question || '').slice(0, 500);
      const expected  = String(body.expected || '').slice(0, 1000);
      const responses = (Array.isArray(body.responses) ? body.responses : []).slice(0, 200)
        .map(r => ({ id:String(r.id||''), answer:String(r.answer||'').slice(0,800) }));
      if (!expected)            return res.status(400).json({ error: 'Provide the expected/model answer to grade against.' });
      if (responses.length===0) return res.status(400).json({ error: 'No answers to grade.' });
      const system = 'You are a fair grader. Score each student answer against the model answer on meaning, not wording. Respond with ONLY a JSON object, no prose, no code fences.';
      const user = `Question: "${question}"\nModel answer: "${expected}"\n\nAnswers:\n`+
        responses.map(r => `[${r.id}] ${r.answer}`).join('\n')+
        `\n\nReturn JSON exactly: {"grades":[{"id":"<id>","score":<0..1>,"correct":<true|false>,"feedback":"one short sentence"}]}. score is a fraction 0-1; correct is score>=0.6.`;
      const { text, source } = await callLLM(system, user, 1500);
      const parsed = extractJSON(text);
      if (!parsed || !Array.isArray(parsed.grades)) return res.status(502).json({ error: 'AI returned an unreadable result. Try again.' });
      return res.status(200).json({ ok:true, source, grades: parsed.grades });
    }

    return res.status(400).json({ error: 'Unknown task' });
  } catch (e) {
    const code = Number.isInteger(e.code) ? e.code : 500;
    return res.status(code).json({ error: e.msg || e.message || 'AI error' });
  }
};
