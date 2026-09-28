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
/* ONE model, kept simple (Rod, 2026-09-28): OPENAI_TEXT_MODEL (e.g. gpt-6-luna) writes every
   Polly question, flashcard and deck, and fact-checks them. The Mac is only the fallback
   here — it invents facts. Jobs that only work on text they're given (translation, themes,
   summaries, grading) run on the Mac first, with this same model as their backup. */
const PREFER_CLOUD = !!process.env.OPENAI_API_KEY;
const OPENAI_BASE       = 'https://api.openai.com/v1';

const LOCAL_LLM_URL     = process.env.LOCAL_LLM_URL || '';      // empty = skip local, go straight to OpenAI
const LOCAL_LLM_MODEL   = process.env.LOCAL_LLM_MODEL || 'qwen3:14b';

// Reasoning models (gpt-oss, qwen3, …) burn a large hidden reasoning budget by default,
// which makes generation far too slow for interactive Polly (gpt-oss:20b measured 8-13×
// slower at default effort than at 'low' on an M4 Pro). Set this to 'low' when
// LOCAL_LLM_MODEL is a reasoning model. Sent ONLY to the local provider (OpenAI's
// non-reasoning models reject the param) and only when non-empty, so it's a safe no-op
// otherwise. Valid: 'low' | 'medium' | 'high'.
const LOCAL_REASONING_EFFORT = process.env.LOCAL_REASONING_EFFORT || '';

const admin = require('firebase-admin');
const { checkQuota, consumeQuota, getApp } = require('../lib/quota');   // server-enforced Polly quota + support log

// Cloudflare Access service-token headers — proves to Cloudflare's edge that this
// request is really PollSlide's server, so the Mac tunnel can reject everyone else.
// Empty until you set the token in Vercel; the tunnel + Access policy does the blocking.
const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? {
      'CF-Access-Client-Id':     process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    }
  : {};

// Env-overridable so a slower local model (gpt-oss:20b measured ~10-25s at low reasoning)
// gets room to win before falling back. Keep LOCAL + CLOUD comfortably under the 60s
// serverless budget (vercel.json). Recommended for gpt-oss:20b: LOCAL_TIMEOUT_MS=42000
// and CLOUD_TIMEOUT_MS=15000 (= 57s, leaves margin).
const LOCAL_TIMEOUT_MS  = parseInt(process.env.LOCAL_TIMEOUT_MS, 10) || 30000;  // Mac's head-start before cloud fallback
const CLOUD_TIMEOUT_MS  = parseInt(process.env.CLOUD_TIMEOUT_MS, 10) || 20000;

// Whole-request time budget for the top-up loop (below). Sits ~15s under the maxDuration in
// vercel.json (180s on the Pro plan), which is what lets the local model carry a whole large
// batch itself instead of the cloud filling the shortfall. The loop still EXITS as soon as it
// reaches `count`, so small generations stay fast — this is only a ceiling for big ones.
// Env-overridable if maxDuration changes.
//
// ⚠️ vercel.json DEPLOY TRAP (cost two failed production builds on 2026-07-27): the `functions`
// block uses ONE pattern, "api/*.js", for every endpoint. Do NOT add a second, more specific
// entry like "api/polly.js" to give this one a longer maxDuration — the broad glob already
// claims every file, so the specific pattern matches nothing and Vercel HARD-FAILS the build
// with "doesn't match any Serverless Functions inside the api directory". Raise the shared
// maxDuration instead. That's safe here because every endpoint enforces its own, much shorter
// AbortController timeout, so the higher ceiling only ever benefits this top-up loop.
const POLLY_BUDGET_MS   = parseInt(process.env.POLLY_BUDGET_MS, 10) || 165000;

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

// ── FULL-DECK generation (PresentSlide) ────────────────────────────────────────
// Returns a complete presentation: informational content slides (title/body/
// speaker notes/imagePrompt) with poll questions placed strategically between
// sections. This is what "build me a 10-slide deck on X" actually delivers.
function buildDeckMessages({ topic, count, includePolls, includeImages, source, language }) {
  const langName = LANG_NAMES[language] || 'English';
  const langRule = language && language !== 'en'
    ? ` Write ALL content in ${langName}. JSON keys stay in English; VALUES are in ${langName}.`
    : '';
  const schema = `{
  "slides": [
    { "kind": "content", "title": "slide heading", "body": "2-4 tight sentences or • bullet lines", "notes": "2-3 sentences the presenter SAYS for this slide (conversational, first person)"${includeImages ? ', "imagePrompt": "a vivid text-to-image prompt for a fitting illustration, or omit if none needed"' : ''} }${includePolls ? `,
    { "kind": "poll", "text": "the audience question", "options": ["option 1","option 2","option 3"], "answers": ["correct option word-for-word, or [] for opinion polls"] }` : ''}
  ]
}`;
  const system =
    `You are Polly, PollSlide's AI presentation designer. Build a COMPLETE, well-structured ${count}-slide deck: ` +
    `an engaging opening slide, a logical narrative through the material, and a strong close.` +
    (includePolls ? ` Place poll questions STRATEGICALLY — after key sections, roughly every 3-4 content slides (2-3 polls in a ${count}-slide deck), never two polls in a row, never the first slide.` : '') +
    (includeImages ? ` Give an "imagePrompt" to the slides that would genuinely benefit from an illustration (about half).` : '') +
    ` Every slide gets speaker notes.${langRule}` +
    ` Return ONLY valid JSON in exactly this shape — no markdown, no commentary. The "slides" array must have exactly ${count} entries total:\n${schema}`;
  const user = source
    ? `Build the ${count}-slide deck from ONLY this source material.` + (topic ? ` Focus: ${topic}.` : '') + `\n\nSOURCE MATERIAL:\n"""\n${source}\n"""`
    : `Topic: ${topic}\nBuild the ${count}-slide deck.`;
  return [ { role: 'system', content: system }, { role: 'user', content: user } ];
}

// Parse model JSON leniently. Reasoning/chatty models (gpt-oss especially) sometimes
// wrap the JSON in prose or a ```json fence, or emit a stray token before it. Try a
// strict parse first, then fall back to the outermost {...} or [...] slice. A deeper
// break — a missing comma mid-object — still fails here, which is intended: it triggers
// the OpenAI fallback in the handler rather than surfacing garbage.
function parseJsonLoose(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const oi = s.indexOf('{'), ai = s.indexOf('[');
  let start = -1;
  if (oi >= 0 && (ai < 0 || oi < ai)) start = oi;
  else if (ai >= 0) start = ai;
  if (start < 0) return null;
  const close = s[start] === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  if (end > start) { try { return JSON.parse(s.slice(start, end + 1)); } catch {} }
  return null;
}

// Shape a deck response: content slides (title required) + polls (options resolved).
/* Plain text only (2026-09-27): models wrap words in **bold**, *italics*, `code` and
   "- " bullets, and every asterisk ended up on the projector. Emojis are kept. */
function plain(v) {
  return String(v == null ? '' : v)
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|[-*•]\s+)/gm, '')
    .replace(/\*+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeDeck(raw) {
  const parsed = parseJsonLoose(raw);
  if (parsed == null) throw new Error('Model did not return valid JSON');
  const list = Array.isArray(parsed) ? parsed : (parsed.slides || []);
  if (!Array.isArray(list) || list.length === 0) throw new Error('No slides in model output');
  return list.map((s) => {
    if (s.kind === 'poll' || (s.options && s.text)) {
      const options = (Array.isArray(s.options) ? s.options : [])
        .map((o) => (typeof o === 'string' ? o : (o && o.text) || '')).filter(Boolean).slice(0, 6);
      if (options.length < 2) return null;
      const correctAnswers = resolveCorrectIndices(s, options);
      return { kind: 'poll', text: plain(s.text), options: options.map(plain), correctAnswers };
    }
    const title = plain(s.title || s.text);
    if (!title) return null;
    return { kind: 'content', title,
      body:  plain(s.body),
      notes: plain(s.notes || s.speakerNotes),
      imagePrompt: String(s.imagePrompt || '').trim() };
  }).filter(Boolean);
}

// Per-run steering to break cross-request sameness. A broad ask ("pub quiz across all
// genres") otherwise returns the model's greatest hits every time; nudging each call
// toward a RANDOM handful of domains + lenses spreads successive runs across the space.
// Only for open-ended generation — grounded (source material) and surveys are left
// alone, since there the phrasing is meant to stay faithful.
// "Pub quiz, all genres" is MEANT to roam; "the French Revolution" is not. One definition,
// used by the variety nudge, the diversity rule and the on-topic check.
const isBroadTopic = (topic) => !topic || /general|mixed|misc|any|all\s*genres?|pub\s*quiz|trivia|random|variety/i.test(topic);

function varietyNudge(topic) {
  const pick = (arr, n) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
  };
  const LENSES = ['surprising firsts', 'origins & etymology', 'record holders', 'lesser-known facts',
    'unexpected connections between fields', 'everyday things seen closely', 'numbers & measurements',
    'the very recent', 'the distant past', 'beyond the Western world'];
  const lenses = pick(LENSES, 2).join(' and ');
  const broad = isBroadTopic(topic);
  if (broad) {
    const GENRES = ['history', 'world geography', 'physics & chemistry', 'biology & nature', 'sport',
      'music', 'film & television', 'literature', 'visual art', 'food & drink', 'technology & computing',
      'mythology & religion', 'language & words', 'space & astronomy', 'inventions & discovery',
      'architecture', 'games & toys', 'economics & money', 'the human body', 'notable people'];
    return ` For freshness on THIS run (do not mention this instruction): draw especially from ${pick(GENRES, 5).join(', ')}, through the lens of ${lenses}. Prefer specific, concrete facts over the most famous textbook examples.`;
  }
  // A specific topic: the lens only changes WHICH facts about the topic are picked. Lenses
  // like "unexpected connections between fields" used to walk questions off the topic.
  return ` For freshness on THIS run (do not mention this instruction): within ${topic} — and only within it — favour ${lenses}, and specific, less-obvious facts over the most famous textbook examples. Never drift into a neighbouring subject to satisfy this.`;
}

function buildMessages({ topic, type, count, difficulty, audience, source, language, avoid }) {
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
    ? `You are Polly, PollSlide's AI study-card designer. Write clear, memorable flashcards: a concise prompt ("front") and its answer ("back"), each with one fitting emoji on the front. Plain text only — no markdown or asterisks. Make the cards memorable and fun to study, but use only well-established facts you are certain of; if unsure, choose another card.${langRule} Return ONLY valid JSON in exactly this shape — no markdown, no commentary:\n${schema}`
    : `You are Polly, PollSlide's AI question designer. You write lively, audience-friendly ${guide}. ` +
      `Always weave in relevant emojis so the content pops. Every question must have exactly 4 options. ` +
      `Write plain text only — no markdown, no asterisks, no bold or italics. ` +
      (isSurvey ? '' : `BE CREATIVE IN HOW YOU ASK, STRICT ABOUT WHAT IS TRUE: surprising angles, vivid wording, playful wrong answers and fun explanations are welcome — invented or doubtful facts are not. Use only well-established facts you are certain of; if you are not sure a fact is true, pick a different question. The marked answer must be unambiguously correct, and every other option must be clearly wrong — never partly true or arguable. Avoid "latest", "current" or record facts that may have changed. `) +
      `${answerRule} Every value in "answers" must match one of the options word-for-word.${langRule} ` +
      `Return ONLY valid JSON in exactly this shape — no markdown, no commentary:\n${schema}`;

  // Within a batch: spell out that the questions must differ. Across batches: a
  // model can only avoid repeating itself if it can SEE what it already produced,
  // so the caller passes the deck's existing questions and they go in verbatim.
  // Without this, "generate 10 more" on the same topic returns the same canonical
  // set every time — the repetition users actually notice.
  const broad = isBroadTopic(topic) && !source;
  const diversityRule = (count > 1
    ? ` All ${count} questions must be clearly distinct from one another — never test the same fact twice, reuse the same answer, or repeat a phrasing pattern.` +
      (broad ? ' Spread them across different subject areas.' : ' Spread them across different aspects of the topic.')
    : '') +
    // The topic lock. "Different subject areas" was said to EVERY request, including specific
    // ones — which is an instruction to leave the topic.
    ((!broad && topic) ? ` Every question must be squarely about: ${topic}. A question that is only loosely connected, or about a neighbouring subject, is wrong — leave it out.` : '');
  const avoidList = (Array.isArray(avoid) ? avoid : [])
    .map(a => (typeof a === 'string' ? a : a && a.text)).filter(Boolean);
  const avoidBlock = avoidList.length
    ? `\n\nALREADY IN THIS DECK — do not repeat any of these, or any reworded version of them:\n` +
      avoidList.map(t => `- ${t}`).join('\n')
    : '';

  // Randomised per-run steering — only for open-ended generation (never for grounded
  // source material or surveys), so identical asks diverge instead of repeating.
  const nudge = (!isSurvey && !source) ? varietyNudge(topic) : '';

  const user = (source
    ? // Grounded generation: questions must come from the supplied material (PDF / notes).
      `Create ${count} ${type} question(s) based ONLY on the source material below. ` +
      `Do not invent facts that aren't supported by it.` +
      (topic ? ` Focus on: ${topic}.` : '') +
      (difficulty ? ` Difficulty: ${difficulty}.` : '') +
      (audience ? ` Audience: ${audience}.` : '') +
      diversityRule +
      `\n\nSOURCE MATERIAL:\n"""\n${source}\n"""`
    : `Topic: ${topic}\n` +
      `Create ${count} ${type} question(s).` +
      (difficulty ? ` Difficulty: ${difficulty}.` : '') +
      (audience ? ` Audience: ${audience}.` : '') +
      diversityRule
  ) + avoidBlock + nudge;

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ];
}

// One helper for BOTH local Ollama and OpenAI — identical request shape.
async function callChat({ baseURL, apiKey, model, messages, timeoutMs, extraHeaders = {}, seed, reasoningEffort, temperature }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseURL}/chat/completions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, ...extraHeaders },
      body: JSON.stringify({
        model,
        messages,
        temperature: temperature == null ? 0.8 : temperature,
        ...(seed != null ? { seed } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
// ─── REPETITION CONTROL ───────────────────────────────────────────────────────
// Polly generates a whole batch in ONE call and has no memory of earlier batches,
// so asking for "10 more" on the same topic reliably returns the same greatest
// hits ("Which planet is known as the Red Planet?"). Measured: two models each
// produced ZERO duplicates *within* a batch — the repetition users notice is
// ACROSS generations. The client now sends what's already in the deck as `avoid`,
// the prompt lists it, and this is the net for what the model repeats anyway.
//
// Matching on question text ALONE is unsafe: "capital of France" and "capital of
// Spain" share 71% of their words and are perfectly good separate questions. So a
// duplicate needs a meaningful text overlap AND the same answer. Where there's no
// answer to compare, only near-identical text counts. Surveys are skipped outright
// — parallel phrasings ("How satisfied are you with X / with Y") are the point.
// Words that carry no topic signal. Leaving them in wrecks the comparison: two
// questions about the SAME joke, worded differently, shared only 12% of their words
// because "which/what/do/for/the" padded both sides of the ratio.
const STOP = new Set(('a an the of in on at to for from by with and or but is are was were ' +
  'be been being do does did what which who whom whose when where why how that this these ' +
  'those it its as if then than so you your yours their there here have has had can could ' +
  'would should will shall may might must about into over under again more most some any ' +
  'according known associate associated call called say said').split(' '));
// Crude stemmer: enough to make "millennial" and "millennials" the same word, which
// is the difference between catching a repeat and missing it. Not linguistics — just
// the endings that show up in question text.
function stem(w) {
  return w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '');
}
function wordSet(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(Boolean).filter(w => !STOP.has(w) && w.length > 1).map(stem));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}
// How much of the SHORTER text is inside the longer one. Jaccard under-detects when
// the two differ a lot in length — a flashcard front ("Mitochondria") against a
// question-phrased one ("What are mitochondria?") scores only 0.33 — so this is the
// second opinion. Only ever consulted when the answers already match, which keeps
// it from firing on genuinely different questions that share a word or two.
function containment(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}
function answerKey(ans) {
  return (Array.isArray(ans) ? ans : [ans])
    .map(a => String(a == null ? '' : a).toLowerCase().trim().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9 ]/g, ''))
    .filter(Boolean).sort().join('|');
}
/* Answers too common to identify anything. Every true/false question in a deck
 * shares the answer "true" — treating that as a repeat would delete most of a quiz. */
const GENERIC_ANSWER = new Set(['true','false','yes','no','none','both','neither','other',
  'all of the above','none of the above','maybe','it depends','0','1']);
function dropRepeats(questions, avoid, type) {
  if (type === 'survey') return questions;
  const isStudy = type === 'study';
  const seen = (Array.isArray(avoid) ? avoid : []).map(a => (typeof a === 'string'
    ? { w: wordSet(a), k: '' }
    : { w: wordSet(a && (a.text || a.front)), k: answerKey(a && (a.answers || a.back)) }
  )).filter(x => x.w.size);

  const kept = [];
  for (const q of questions) {
    const w = wordSet(isStudy ? q.front : q.text);
    const k = isStudy
      ? answerKey(q.back)
      : answerKey((q.correctAnswers || []).map(i => (q.options || [])[i]));
    const dupe = seen.some(s => {
      if (s.k && k) {
        if (s.k !== k) return false;                       // different answer = different question
        /* SAME ANSWER is the signal that actually works.
         * Text similarity alone can never catch the real failure: "What food is
         * blamed for millennials not owning homes?" and "According to boomers,
         * which brunch item cost millennials a mortgage?" share ONE content word
         * and are obviously the same question — because both answer "avocado
         * toast". In a quiz, the answer IS the question's identity.
         *
         * And a quiz with the same answer twice reads as repetitive even when the
         * two questions test different facts, which is the complaint this is
         * fixing. So a repeated distinctive answer is enough on its own.
         * Generic answers (true/false/yes/no) identify nothing and are exempt. */
        if (!GENERIC_ANSWER.has(s.k)) return true;
        return jaccard(w, s.w) > 0.5 || containment(w, s.w) > 0.8;
      }
      // Nothing to compare answers with — content words only, now that stopwords
      // no longer dilute the ratio.
      return jaccard(w, s.w) > 0.6;
    });
    if (!dupe) { kept.push(q); seen.push({ w, k }); }
  }
  return kept;
}

function normalizeQuestions(raw, type) {
  const parsed = parseJsonLoose(raw);
  if (parsed == null) throw new Error('Model did not return valid JSON');

  const list = Array.isArray(parsed) ? parsed : (parsed.questions || []);
  if (!Array.isArray(list) || list.length === 0) throw new Error('No questions in model output');

  if (type === 'study') {
    return list.map(q => ({
      front: plain(q.front || q.text),
      back:  plain(q.back || q.answer),
      emoji: String(q.emoji || '').trim(),
    })).filter(q => q.front && q.back);
  }

  const isSurvey = type === 'survey';
  return list.map((q) => {
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => (typeof o === 'string' ? o : (o && o.text) || ''))
      .filter(Boolean)
      .slice(0, 6);
    while (options.length < 2) options.push('');   // never fewer than 2 options
    let correctAnswers = isSurvey ? [] : resolveCorrectIndices(q, options);
    /* Graded products need a marked answer the model actually GAVE. The old fallback marked
       option A whenever the model's answer didn't match an option word for word, which put
       "A is correct" on questions where it wasn't. Now such a question is dropped and the
       top-up loop asks for a replacement. */
    if (!isSurvey && correctAnswers.length === 0) {
      const i = resolveCorrect(q, options);
      const said = String(q.answer != null ? q.answer : (q.correctAnswer != null ? q.correctAnswer : '')).trim();
      if (!said) return null;
      correctAnswers = [i];
    }
    const kind = (!isSurvey && (q.kind === 'multi' || correctAnswers.length > 1)) ? 'multi' : 'single';
    return {
      text:        plain(q.text),
      emoji:       String(q.emoji || '').trim(),
      kind,
      options:     options.map(plain),
      correctAnswers,
      explanation: plain(q.explanation),
    };
  }).filter((q) => q && q.text && q.options.filter(Boolean).length >= 2);
}

// Best-effort support log: one row per generation under admin/polly_log/<uid> (admin-read
// only; Admin SDK write bypasses rules). Lets the founder answer "Polly gave me junk / it
// didn't generate" by seeing exactly what ran — topic, how many were asked vs delivered,
// which provider, and success/failure. Never throws and never blocks the response meaningfully.
async function logGen(quota, entry) {
  // Daily health counters for the watchdog (feature_health check) — every run, signed in or not.
  try {
    const day = new Date().toISOString().slice(0, 10);
    const h = admin.database(getApp()).ref('admin/feature_health/polly/' + day);
    const bump = (k, by = 1) => h.child(k).transaction(n => (n || 0) + by).catch(() => {});
    bump('runs');
    if (!entry.ok) { bump('fail'); h.child('last').set({ at: Date.now(), code: 'failed', detail: String(entry.error || '').slice(0, 160) }).catch(() => {}); }
    if (entry.short) { bump('short'); h.child('lastShort').set({ at: Date.now(), requested: entry.requested, delivered: entry.delivered, topic: String(entry.topic || '').slice(0, 80) }).catch(() => {}); }
    if (entry.offTopicDropped) bump('offTopicDropped', entry.offTopicDropped);
    if (entry.unchecked) bump('unchecked', entry.unchecked);
  } catch (e) { /* bookkeeping must never affect the user */ }
  if (!quota || !quota.uid) return;   // no Firebase / anonymous → nothing to attribute it to
  try {
    await admin.database(getApp()).ref('admin/polly_log/' + quota.uid).push({ t: Date.now(), ...entry });
  } catch (e) { /* logging must never affect the user */ }
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
  const topic      = String(body.topic || '').trim().slice(0, 2000);
  const type       = ['poll', 'survey', 'quiz', 'study', 'presentation', 'deck'].includes(body.type) ? body.type : 'quiz';
  const includePolls  = body.includePolls  !== false;   // deck only: polls woven in (default on)
  const includeImages = body.includeImages !== false;   // deck only: imagePrompts (default on)
  const count      = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 30);   // clamp 1–10
  const difficulty = body.difficulty ? String(body.difficulty).slice(0, 40) : '';
  const audience   = body.audience   ? String(body.audience).slice(0, 80)   : '';
  // What's already in the deck, so a second "generate" doesn't return the same
  // greatest hits. Accepts plain strings or {text|front, answers|back}.
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).slice(0, 60).map(a => (
    typeof a === 'string' ? String(a).slice(0, 300) : {
      text:    String((a && (a.text || a.front)) || '').slice(0, 300),
      answers: (Array.isArray(a && a.answers) ? a.answers : [a && a.back])
                 .map(x => String(x == null ? '' : x).slice(0, 120)).filter(Boolean),
    }
  )).filter(a => (typeof a === 'string' ? a.trim() : a.text.trim()));
  const language   = body.language   ? String(body.language).slice(0, 8)    : 'en';
  // Optional source material (PDF text / pasted notes) — ground questions in it.
  // NOTE: named sourceMaterial to avoid colliding with the provider `source` below.
  const sourceMaterial = body.source ? String(body.source).slice(0, 12000) : '';

  if (!topic && !sourceMaterial) return res.status(400).json({ error: 'Provide a topic or source material.' });

  // ── Enforce the monthly Polly quota BEFORE generating (tamper-proof, server-side) ──
  let quota = null;
  try { quota = await checkQuota(req); }
  catch (e) { if (e && e.code) return res.status(e.code).json({ error: e.error, overLimit: !!e.overLimit, limit: e.limit, used: e.used }); throw e; }

  // A fresh random seed each call nudges the sampler off any deterministic default.
  const newSeed = () => Math.floor(Math.random() * 2147483647);

  // ── Deck (PresentSlide): single shot. A deck is one structured artefact, not a count
  //    of independent items, so the top-up loop below doesn't apply. ──
  if (type === 'deck') {
    const messages = buildDeckMessages({ topic, count, includePolls, includeImages, source: sourceMaterial, language });
    const seed = newSeed();
    let slides = null, source = '';
    // A deck is facts too: the knowledgeable cloud model writes first, the Mac is the fallback.
    const deckCloud = async () => { slides = normalizeDeck(await callChat({ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL, messages, timeoutMs: CLOUD_TIMEOUT_MS, seed, temperature: 0.7 })); source = 'openai'; };
    const deckLocal = async () => { slides = normalizeDeck(await callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_LLM_MODEL, messages, timeoutMs: LOCAL_TIMEOUT_MS, extraHeaders: CF_ACCESS_HEADERS, seed, reasoningEffort: LOCAL_REASONING_EFFORT })); source = 'local'; };
    if (PREFER_CLOUD) { try { await deckCloud(); } catch (err) { console.warn('Polly: cloud deck failed (' + err.message + ') → local fallback'); } }
    if (!slides && LOCAL_LLM_URL) { try { await deckLocal(); } catch (err) { console.warn('Polly: local deck failed (' + err.message + ')'); } }
    if (!slides && !PREFER_CLOUD) {
      if (!OPENAI_API_KEY) return res.status(503).json({ error: 'Local LLM unavailable and no OpenAI key set.' });
      try { await deckCloud(); }
      catch (err) { console.error('Polly: OpenAI error:', err.message); return res.status(503).json({ error: 'AI generation failed', detail: err.message }); }
    }
    if (!slides) return res.status(503).json({ error: 'AI generation failed', detail: 'no provider produced a deck' });
    await logGen(quota, { topic: topic.slice(0, 120), type, requested: count, delivered: slides.length, source, ok: true });
    try { await consumeQuota(quota); } catch (e) { /* never fail the response over the counter */ }
    return res.status(200).json({ source, type, topic, slides });
  }

  // ── Questions (poll/quiz/survey/study/presentation): TOP-UP LOOP ──
  // A single call is an unreliable way to get exactly `count`: reasoning models routinely
  // stop early (measured on gpt-oss:20b — asked 12, returned 1; asked 20, returned 18;
  // finish_reason "stop", not truncation) AND a big single ask is slow/variable enough to
  // blow the timeout. So we ask for up to MAX_PER_CALL at a time — the size gpt-oss fills
  // reliably and fast (asked 8 → got 8 in 12s) — keep what's new, and ask again for
  // whatever's still MISSING (feeding what we have as `avoid`) until we reach the number,
  // run low on the time budget, or a call adds nothing.
  const DEADLINE     = Date.now() + POLLY_BUDGET_MS;   // whole-request budget (env POLLY_BUDGET_MS); stays under maxDuration
  const MAX_ATTEMPTS = 6;
  const MAX_PER_CALL = 10;                    // reliable/fast batch size for the local model
  const CLOUD_RESERVE = OPENAI_API_KEY ? 15000 : 0;   // keep this much back so a slow local never starves the cloud fill

  // Generate ONE batch of ~`need` questions (local first, OpenAI fallback on
  // unreachable/unparseable/too-slow). Returns { qs, src }; throws only if no provider
  // works. Local is capped to leave CLOUD_RESERVE so a slow gpt-oss run always leaves the
  // cloud enough time to fill the rest within the request budget.
  const genBatch = async (need, avoidList) => {
    const messages = buildMessages({ topic, type, count: need, difficulty, audience, source: sourceMaterial, language, avoid: avoidList });
    const seed = newSeed();
    /* Creative AND factual (Rod, 2026-09-27): the writer stays inventive — only slightly
       cooler for quizzes and flashcards — because truth is enforced by the separate
       temperature-0 review below, not by making every question dull. */
    const temperature = (type === 'poll' || type === 'survey') ? 0.8 : 0.7;
    const viaLocal = async (reserve) => {
      const budget = Math.min(LOCAL_TIMEOUT_MS, Math.max(4000, DEADLINE - Date.now() - reserve));
      return { qs: normalizeQuestions(await callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_LLM_MODEL, messages, timeoutMs: budget, extraHeaders: CF_ACCESS_HEADERS, seed, reasoningEffort: LOCAL_REASONING_EFFORT, temperature }), type), src: 'local' };
    };
    const viaCloud = async () => {
      const budget = Math.min(CLOUD_TIMEOUT_MS, Math.max(4000, DEADLINE - Date.now()));
      return { qs: normalizeQuestions(await callChat({ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL, messages, timeoutMs: budget, seed, temperature }), type), src: 'openai' };
    };
    // The OpenAI model writes first; the Mac only if OpenAI fails (it invents facts).
    if (PREFER_CLOUD) {
      try { return await viaCloud(); }
      catch (err) { console.warn('Polly: cloud batch failed (' + err.message + ') → local fallback'); if (!LOCAL_LLM_URL) throw err; }
      return await viaLocal(0);
    }
    if (LOCAL_LLM_URL) {
      try { return await viaLocal(CLOUD_RESERVE); }
      catch (err) { console.warn('Polly: local batch failed (' + err.message + ') → OpenAI fallback'); }
    }
    if (OPENAI_API_KEY) return await viaCloud();
    throw new Error('Local LLM unavailable and no cloud key set.');
  };

  // Compact avoid-entry for a shaped question, so top-up calls don't repeat what we have.
  const asAvoid = (q) => ({
    text:    q.text || q.front || '',
    answers: q.back ? [q.back] : (q.correctAnswers || []).map(i => (q.options || [])[i]).filter(Boolean),
  });

  let acc = [];
  let source = '';
  let lastErr = null;
  let offTopicDropped = 0;

  /* The second opinion (2026-09-27, replacing a topic-only check).
     Rod: "lots of questions and answers are false". A model grading its own homework is how
     that happens, so every batch is reviewed by a SEPARATE call — the OpenAI model first
     (a different model from the local one that usually writes), temperature 0 — which
     flags any question that is off topic, whose marked answer is wrong, disputed or out of
     date, or where another option is also correct. Flagged questions are dropped and the
     loop writes replacements. With source material, "correct" means "supported by it".
     Fails OPEN (a missing checker never costs the teacher their questions) and says so in
     the log; a verdict against more than 70% of a batch reads as a confused checker. */
  let factDropped = 0, unchecked = 0;
  async function review(qs, topicText, kind, src) {
    if (!qs.length) return new Set();
    const checkTopic = !!topicText && !src && !isBroadTopic(topicText);
    const checkFacts = kind !== 'survey';
    if (!checkTopic && !checkFacts) return new Set();
    const list = qs.map((q, i) => {
      if (q.front) return `${i}. Q: ${q.front.slice(0, 240)}\n   A: ${String(q.back || '').slice(0, 240)}`;
      const opts = (q.options || []).map((o, k) => `${String.fromCharCode(65 + k)}) ${o}${(q.correctAnswers || []).includes(k) ? '  ← marked correct' : ''}`).join('\n   ');
      return `${i}. ${q.text.slice(0, 240)}\n   ${opts}`;
    }).join('\n');
    const tasks = [
      checkFacts ? (src ? 'the marked answer is NOT supported by the source material, or another option is also supported' : 'the marked answer is wrong, disputed, out of date, or only true under some reading — or another option is also correct') : '',
      checkTopic ? 'the question is not clearly about the topic (a neighbouring or merely related subject counts as off topic)' : '',
    ].filter(Boolean);
    const messages = [
      { role: 'system', content: 'You are a meticulous fact-checker for quiz questions shown to live audiences. Flag a question if ANY of these is true: ' + tasks.join('; ') + '. Be strict about facts: if you are not confident the marked answer is right and the others are wrong, flag it. Return ONLY JSON: {"flag":[{"i":index,"why":"short reason"}]}. An empty list means every question passes.' },
      { role: 'user', content: (checkTopic ? `Topic: ${topicText.slice(0, 400)}\n\n` : '') + (src && checkFacts ? `SOURCE MATERIAL:\n"""\n${String(src).slice(0, 12000)}\n"""\n\n` : '') + `Questions:\n${list}` },
    ];
    const tryOne = async (cfg) => {
      const raw = await callChat(Object.assign({ messages, temperature: 0, timeoutMs: Math.min(20000, Math.max(4000, DEADLINE - Date.now() - 2000)) }, cfg));
      const j = parseJsonLoose(raw);
      const arr = j && Array.isArray(j.flag) ? j.flag : null;
      if (!arr) throw new Error('unreadable');
      return arr.map(f => ({ i: Number(f && f.i), why: String((f && f.why) || '').slice(0, 120) })).filter(f => Number.isInteger(f.i) && f.i >= 0 && f.i < qs.length);
    };
    try {
      let flags = null;
      // The same OpenAI model, at temperature 0, in a separate call. Never the Mac — it would
      // be checking facts with the model that makes them up.
      if (OPENAI_API_KEY) { try { flags = await tryOne({ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL }); } catch (e) {} }
      if (!flags) { unchecked += qs.length; console.warn('Polly: review unavailable — batch not fact-checked'); return new Set(); }
      if (flags.length > qs.length * 0.7) { unchecked += qs.length; console.warn(`Polly: review flagged ${flags.length}/${qs.length} — treating as unreliable`); return new Set(); }
      if (flags.length) console.warn(`Polly: review dropped ${flags.length} for "${String(topicText).slice(0, 60)}":`, flags.map(f => `${(qs[f.i].text || qs[f.i].front || '').slice(0, 70)} — ${f.why}`));
      factDropped += flags.length;
      return new Set(flags.map(f => f.i));
    } catch (e) { unchecked += qs.length; return new Set(); }
  }
  /* Exactly `count`, all on topic (2026-09-26: asked 30, got 29, two off topic).
     • Ask for a couple more than are missing: dedupe and the topic check each remove a few,
       and a batch that comes back one short used to leave the deck one short.
     • One empty round is not the end — the next asks with everything so far as `avoid`.
     • Each batch's NEW questions are checked for topic by a second, cheap call and the
       strays dropped before they count; the loop then tops up the gap. */
  let emptyRounds = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS + 2 && acc.length < count && Date.now() < DEADLINE; attempt++) {
    const missing = count - acc.length;
    const need = Math.min(missing + Math.max(1, Math.ceil(missing * 0.15)), MAX_PER_CALL + 2);
    let batch;
    try {
      const r = await genBatch(need, [...avoid, ...acc.map(asAvoid)]);
      batch = r.qs; source = source || r.src;
    } catch (err) { lastErr = err; break; }              // no provider worked — return what we have
    const before = acc.length;
    // Dedup the batch against everything so far (dropRepeats seeds from `avoid`).
    let merged = dropRepeats([...acc, ...batch], avoid, type);
    const fresh = merged.slice(before);
    const strays = await review(fresh, topic, type, sourceMaterial);
    if (strays.size) { offTopicDropped += strays.size; merged = merged.filter((q, i) => i < before || !strays.has(i - before)); }
    acc = merged.slice(0, count);
    if (acc.length === before) { if (++emptyRounds >= 2) break; } else emptyRounds = 0;
  }

  if (!acc.length) {
    await logGen(quota, { topic: topic.slice(0, 120), type, requested: count, delivered: 0, source: source || '', ok: false, error: (lastErr ? String(lastErr.message) : 'no questions produced').slice(0, 200) });
    return res.status(503).json({ error: 'AI generation failed', detail: lastErr ? lastErr.message : 'no questions produced' });
  }

  // Bill ONE quota unit for the whole generation, however many calls it took.
  await logGen(quota, { topic: topic.slice(0, 120), type, requested: count, delivered: acc.length, source, ok: true, short: acc.length < count, offTopicDropped, factDropped, unchecked });
  try { await consumeQuota(quota); } catch (e) { /* never fail the response over the counter */ }
  return res.status(200).json({ source, type, topic, questions: acc, requested: count });
  } catch (fatal) {
    // Anything unhandled (e.g. a provider hang/crash) → JSON, not a non-JSON 502.
    console.error('Polly fatal:', fatal && fatal.message);
    return res.status(503).json({ error: 'Polly failed', detail: String((fatal && fatal.message) || fatal) });
  }
};

// Exported for scripts/tests/polly-dedupe.test.js. Repeat suppression is judged by
// thresholds, and thresholds that nobody measures are just someone's guess.
module.exports.__test = { dropRepeats, wordSet, jaccard, containment, answerKey, buildMessages, varietyNudge, isBroadTopic, plain, normalizeQuestions };
