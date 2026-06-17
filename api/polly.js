// PollSlide — Polly AI Question Designer
// Vercel Serverless Function
//
// Generates rich, emoji-flavored questions (poll / quiz / survey / study / presentation)
// as clean JSON the presenter can drop straight into a slide.
//
// LOCAL-FIRST, CLOUD-FALLBACK:
//   • If LOCAL_LLM_URL is set, Polly tries your own Mac (Ollama) first.
//   • If that's unset, times out, or errors, she falls back to OpenAI.
//   Both speak the same OpenAI /chat/completions format, so it's one code path.
//
// VERCEL ENVIRONMENT VARIABLES:
//   OPENAI_API_KEY    = sk-...            (REQUIRED — the cloud backup)
//   OPENAI_TEXT_MODEL = gpt-4o-mini       (optional, default below)
//   LOCAL_LLM_URL     = https://llm.yourdomain.com/v1   (optional — set once your Mac tunnel is live)
//   LOCAL_LLM_MODEL   = qwen3:14b         (optional, default below)
//   CF_ACCESS_CLIENT_ID     = <service-token id>      (locks the Mac tunnel via Cloudflare Access)
//   CF_ACCESS_CLIENT_SECRET = <service-token secret>  (locks the Mac tunnel via Cloudflare Access)
//   NEXT_PUBLIC_APP_URL = https://app.pollslide.com     (optional, for CORS)
//
// USAGE (from presenter.html):
//   fetch('/api/polly', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ topic: 'The Solar System', type: 'quiz', count: 3 })
//   });

const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const OPENAI_BASE       = 'https://api.openai.com/v1';

const LOCAL_LLM_URL     = process.env.LOCAL_LLM_URL || '';      // empty = skip local, go straight to OpenAI
const LOCAL_LLM_MODEL   = process.env.LOCAL_LLM_MODEL || 'qwen3:14b';

// Cloudflare Access service-token headers — proves to Cloudflare's edge that this
// request is really PollSlide's server, so the Mac tunnel can reject everyone else.
// Empty until you set the token in Vercel; the tunnel + Access policy does the blocking.
const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? {
      'CF-Access-Client-Id':     process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    }
  : {};

const LOCAL_TIMEOUT_MS  = 8000;   // fail fast to the cloud if the Mac is asleep/away
const CLOUD_TIMEOUT_MS  = 30000;

// Supported content types → how Polly should think about each.
// Forward-feature: matches the Poll/Survey/Quiz/Study product suite.
const TYPE_GUIDE = {
  poll:         'opinion poll questions with NO single correct answer (set correctAnswer to -1)',
  survey:       'survey questions that gather opinions or feedback (set correctAnswer to -1)',
  quiz:         'fun trivia/quiz questions, each with exactly ONE correct answer',
  study:        'study-flashcard recall questions, each with one correct answer and a teaching explanation',
  presentation: 'engaging audience questions to punctuate a live presentation on the topic',
};

function buildMessages({ topic, type, count, difficulty, audience }) {
  const guide = TYPE_GUIDE[type] || TYPE_GUIDE.quiz;
  const schema = `{
  "questions": [
    {
      "text": "the question or poll prompt",
      "emoji": "ONE relevant emoji for this question",
      "options": ["option 1", "option 2", "option 3", "option 4"],
      "correctAnswer": 0,
      "explanation": "1-2 lively sentences, sprinkle in a couple fitting emojis",
      "imagePrompt": "a vivid, detailed visual description an image generator can use to illustrate this question"
    }
  ]
}`;

  const system =
    `You are Polly, PollSlide's AI question designer. ` +
    `You write lively, audience-friendly ${guide}. ` +
    `Always weave in relevant emojis so the content pops. ` +
    `Every question must have exactly 4 options. ` +
    `correctAnswer is the 0-based index of the right option, or -1 when there is no right answer. ` +
    `Return ONLY valid JSON in exactly this shape — no markdown, no commentary:\n${schema}`;

  const user =
    `Topic: ${topic}\n` +
    `Create ${count} ${type} question(s).` +
    (difficulty ? ` Difficulty: ${difficulty}.` : '') +
    (audience ? ` Audience: ${audience}.` : '');

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ];
}

// One helper for BOTH local Ollama and OpenAI — identical request shape.
async function callChat({ baseURL, apiKey, model, messages, timeoutMs, extraHeaders = {} }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseURL}/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.8,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} ${detail.slice(0, 200)}`);
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

// Clean and shape whatever the model returned into a predictable array.
function normalizeQuestions(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Model did not return valid JSON'); }

  const list = Array.isArray(parsed) ? parsed : (parsed.questions || []);
  if (!Array.isArray(list) || list.length === 0) throw new Error('No questions in model output');

  return list.map((q) => {
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => (typeof o === 'string' ? o : (o && o.text) || ''))
      .filter(Boolean)
      .slice(0, 6);
    while (options.length < 2) options.push('');   // never fewer than 2 options
    let correct = Number.isInteger(q.correctAnswer) ? q.correctAnswer : 0;
    if (correct >= options.length) correct = 0;
    return {
      text:        String(q.text || '').trim(),
      emoji:       String(q.emoji || '').trim(),
      options,
      correctAnswer: correct,
      explanation: String(q.explanation || '').trim(),
      imagePrompt: String(q.imagePrompt || q.image_prompt || '').trim(),
    };
  }).filter((q) => q.text);
}

module.exports = async function handler(req, res) {
  // CORS — same-origin in production, so this only matters for tooling/dev.
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  if (!OPENAI_API_KEY && !LOCAL_LLM_URL) {
    return res.status(500).json({ error: 'No AI configured. Add OPENAI_API_KEY in Vercel → Settings → Environment Variables.' });
  }

  // ── Inputs (all optional except topic) ─────────────────────────────────────
  const body       = req.body || {};
  const topic      = String(body.topic || '').trim();
  const type       = ['poll', 'survey', 'quiz', 'study', 'presentation'].includes(body.type) ? body.type : 'quiz';
  const count      = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 10);   // clamp 1–10
  const difficulty = body.difficulty ? String(body.difficulty).slice(0, 40) : '';
  const audience   = body.audience   ? String(body.audience).slice(0, 80)   : '';

  if (!topic) return res.status(400).json({ error: 'Missing "topic".' });

  // FORWARD-FEATURE HOOK: before generating, this is where you'd check the user's
  // Polly AI monthly quota (Free/Pro = 20, Team = 100) against their Firebase plan
  // and return 429 if exceeded. Wire in once auth context is passed from the client.

  const messages = buildMessages({ topic, type, count, difficulty, audience });

  let raw = '';
  let source = '';

  // 1) Try the user's own Mac first (if configured).
  if (LOCAL_LLM_URL) {
    try {
      raw = await callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_LLM_MODEL, messages, timeoutMs: LOCAL_TIMEOUT_MS, extraHeaders: CF_ACCESS_HEADERS });
      source = 'local';
    } catch (err) {
      console.warn('Polly: local LLM unreachable → OpenAI fallback:', err.message);
    }
  }

  // 2) Fall back to OpenAI.
  if (!raw) {
    if (!OPENAI_API_KEY) return res.status(502).json({ error: 'Local LLM unreachable and no OpenAI key set.' });
    try {
      raw = await callChat({ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL, messages, timeoutMs: CLOUD_TIMEOUT_MS });
      source = 'openai';
    } catch (err) {
      console.error('Polly: OpenAI error:', err.message);
      return res.status(502).json({ error: 'AI generation failed', detail: err.message });
    }
  }

  // 3) Shape the result.
  try {
    const questions = normalizeQuestions(raw);
    return res.status(200).json({ source, type, topic, questions });
  } catch (err) {
    console.error('Polly: parse error:', err.message, '\nRaw:', raw.slice(0, 300));
    return res.status(502).json({ error: 'Could not read AI output', detail: err.message });
  }
};
