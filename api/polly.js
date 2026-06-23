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

const LOCAL_TIMEOUT_MS  = 30000;  // give the Mac plenty of room to win before falling back to the cloud
const CLOUD_TIMEOUT_MS  = 20000;  // keep LOCAL + CLOUD under the 60s serverless function budget

// Supported content types → how Polly should think about each.
// Forward-feature: matches the Poll/Survey/Quiz/Study product suite.
const TYPE_GUIDE = {
  poll:         'live audience poll questions — each WITH the correct answer(s) marked, so the presenter can reveal them',
  survey:       'survey questions for DATA COLLECTION — there is NO correct answer',
  quiz:         'graded quiz questions — each WITH the correct answer(s) marked',
  study:        'study flashcards — a short prompt and its answer',
  presentation: 'engaging audience questions to punctuate a live presentation, each with the correct answer marked',
};

const LANG_NAMES = { en:'English', es:'Spanish', de:'German', fr:'French', pt:'Portuguese', it:'Italian', nl:'Dutch', ja:'Japanese', zh:'Chinese (Simplified)', ar:'Arabic', hi:'Hindi' };

function buildMessages({ topic, type, count, difficulty, audience, source, language }) {
  const isStudy  = type === 'study';
  const isSurvey = type === 'survey';
  const guide = TYPE_GUIDE[type] || TYPE_GUIDE.quiz;
  const langName = LANG_NAMES[language] || '';
  // Write everything in the deck's language (questions, options, answers, explanations).
  const langRule = (langName && language !== 'en')
    ? ` Write ALL content — every question, option, answer, and explanation — in ${langName}. Use only valid JSON keys in English; the VALUES must be in ${langName}.`
    : '';

  // StudySlide = flashcards (front/back). Everything else = multiple choice with
  // the correct answer(s) marked — except surveys, which have no correct answer.
  const schema = isStudy ? `{
  "questions": [
    { "front": "the prompt or term", "back": "the answer or definition", "emoji": "ONE relevant emoji" }
  ]
}` : `{
  "questions": [
    {
      "text": "the question prompt",
      "emoji": "ONE relevant emoji",
      "kind": "single OR multi (single = exactly one correct option; multi = two or more correct)",
      "options": ["option 1", "option 2", "option 3", "option 4"],
      "answers": ["each CORRECT option copied WORD-FOR-WORD from options"],
      "explanation": "1-2 lively sentences with a couple fitting emojis"
    }
  ]
}`;

  const answerRule = isSurvey
    ? `This is a SURVEY for data collection — there is NO correct answer. "answers" MUST be an empty array []. Use "kind":"single" if respondents pick one option, "multi" if they may pick several.`
    : `Mark the correct answer(s): list each correct option (word-for-word) in "answers". Use "kind":"single" when exactly one option is correct, "kind":"multi" when two or more are. Most questions are single. Never leave "answers" empty.`;

  const system = isStudy
    ? `You are Polly, PollSlide's AI study-card designer. Write clear, memorable flashcards: a concise prompt ("front") and its answer ("back"), each with one fitting emoji on the front.${langRule} Return ONLY valid JSON in exactly this shape — no markdown, no commentary:\n${schema}`
    : `You are Polly, PollSlide's AI question designer. You write lively, audience-friendly ${guide}. ` +
      `Always weave in relevant emojis so the content pops. Every question must have exactly 4 options. ` +
      `${answerRule} Every value in "answers" must match one of the options word-for-word.${langRule} ` +
      `Return ONLY valid JSON in exactly this shape — no markdown, no commentary:\n${schema}`;

  const user = source
    ? // Grounded generation: questions must come from the supplied material (PDF / notes).
      `Create ${count} ${type} question(s) based ONLY on the source material below. ` +
      `Do not invent facts that aren't supported by it.` +
      (topic ? ` Focus on: ${topic}.` : '') +
      (difficulty ? ` Difficulty: ${difficulty}.` : '') +
      (audience ? ` Audience: ${audience}.` : '') +
      `\n\nSOURCE MATERIAL:\n"""\n${source}\n"""`
    : `Topic: ${topic}\n` +
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

// Resolve the correct-option index robustly. Small models return the answer as text,
// a letter, or an index inconsistently — matching on the option TEXT is the reliable
// signal, with letter/number fallbacks. (Fixes Polly defaulting every answer to "A".)
function resolveCorrect(q, options) {
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  const optN = options.map(norm);

  // 1) Preferred: "answer" copied verbatim from the options.
  if (norm(q.answer)) {
    const i = optN.indexOf(norm(q.answer));
    if (i >= 0) return i;
  }
  const raw = String((q.correctAnswer != null ? q.correctAnswer : q.answer) ?? '').trim();
  // 2) A letter A–F.
  if (/^[A-Fa-f]$/.test(raw)) {
    const i = raw.toUpperCase().charCodeAt(0) - 65;
    if (i >= 0 && i < options.length) return i;
  }
  // 3) The answer text living in correctAnswer.
  if (raw && optN.indexOf(raw.toLowerCase()) >= 0) return optN.indexOf(raw.toLowerCase());
  // 4) A number — accept 0-based; shift if it looks 1-based.
  const n = Number(raw);
  if (Number.isInteger(n)) {
    if (n >= 0 && n < options.length) return n;
    if (n >= 1 && n <= options.length) return n - 1;
  }
  return 0;
}

// Resolve MULTIPLE correct option indices from answers[] (text/letter/number).
function resolveCorrectIndices(q, options) {
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  const optN = options.map(norm);
  const texts = Array.isArray(q.answers) ? q.answers : (q.answer != null && q.answer !== '' ? [q.answer] : []);
  const idx = [];
  texts.forEach(a => {
    const an = norm(a);
    let i = optN.indexOf(an);
    if (i < 0 && /^[a-f]$/.test(an)) i = an.charCodeAt(0) - 97;       // letter A–F
    if (i < 0) { const n = Number(a); if (Number.isInteger(n)) i = (n >= 1 && n > options.length - 1) ? n - 1 : n; }
    if (i >= 0 && i < options.length && idx.indexOf(i) < 0) idx.push(i);
  });
  return idx;
}

// Clean and shape whatever the model returned into a predictable, product-aware array.
//   study  → { front, back, emoji }
//   survey → { text, kind, options, correctAnswers: [] }   (no correct answer)
//   poll/quiz → { text, kind, options, correctAnswers: [indices] }  (answer marked)
function normalizeQuestions(raw, type) {
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('Model did not return valid JSON'); }

  const list = Array.isArray(parsed) ? parsed : (parsed.questions || []);
  if (!Array.isArray(list) || list.length === 0) throw new Error('No questions in model output');

  if (type === 'study') {
    return list.map(q => ({
      front: String(q.front || q.text || '').trim(),
      back:  String(q.back || q.answer || '').trim(),
      emoji: String(q.emoji || '').trim(),
    })).filter(q => q.front);
  }

  const isSurvey = type === 'survey';
  return list.map((q) => {
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => (typeof o === 'string' ? o : (o && o.text) || ''))
      .filter(Boolean)
      .slice(0, 6);
    while (options.length < 2) options.push('');   // never fewer than 2 options
    let correctAnswers = isSurvey ? [] : resolveCorrectIndices(q, options);
    // Graded products must mark something — fall back to the single-answer resolver.
    if (!isSurvey && correctAnswers.length === 0) correctAnswers = [resolveCorrect(q, options)];
    const kind = (!isSurvey && (q.kind === 'multi' || correctAnswers.length > 1)) ? 'multi' : 'single';
    return {
      text:        String(q.text || '').trim(),
      emoji:       String(q.emoji || '').trim(),
      kind,
      options,
      correctAnswers,
      explanation: String(q.explanation || '').trim(),
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

  try { // top-level guard — guarantees a JSON response (never a non-JSON 502 crash)
  // ── Inputs (all optional except topic) ─────────────────────────────────────
  const body       = req.body || {};
  const topic      = String(body.topic || '').trim();
  const type       = ['poll', 'survey', 'quiz', 'study', 'presentation'].includes(body.type) ? body.type : 'quiz';
  const count      = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 30);   // clamp 1–10
  const difficulty = body.difficulty ? String(body.difficulty).slice(0, 40) : '';
  const audience   = body.audience   ? String(body.audience).slice(0, 80)   : '';
  const language   = body.language   ? String(body.language).slice(0, 8)    : 'en';
  // Optional source material (PDF text / pasted notes) — ground questions in it.
  // NOTE: named sourceMaterial to avoid colliding with the provider `source` below.
  const sourceMaterial = body.source ? String(body.source).slice(0, 12000) : '';

  if (!topic && !sourceMaterial) return res.status(400).json({ error: 'Provide a topic or source material.' });

  // FORWARD-FEATURE HOOK: before generating, this is where you'd check the user's
  // Polly AI monthly quota (Free/Pro = 20, Team = 100) against their Firebase plan
  // and return 429 if exceeded. Wire in once auth context is passed from the client.

  const messages = buildMessages({ topic, type, count, difficulty, audience, source: sourceMaterial, language });

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
    const questions = normalizeQuestions(raw, type);
    return res.status(200).json({ source, type, topic, questions });
  } catch (err) {
    console.error('Polly: parse error:', err.message, '\nRaw:', String(raw || '').slice(0, 300));
    return res.status(502).json({ error: 'Could not read AI output', detail: err.message });
  }
  } catch (fatal) {
    // Anything unhandled (e.g. a provider hang/crash) → JSON, not a non-JSON 502.
    console.error('Polly fatal:', fatal && fatal.message);
    return res.status(502).json({ error: 'Polly failed', detail: String((fatal && fatal.message) || fatal) });
  }
};
