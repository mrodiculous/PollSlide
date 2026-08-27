// PollSlide — on-the-fly translation for the audience answer page.
// Each attendee can read questions/options in THEIR language; the deck's language
// is the source. Display-only — stored responses keep the original option indices.
//
// SAME provider model as Polly (api/polly.js) for simplicity:
//   • If LOCAL_LLM_URL is set, translation tries your own Mac (Ollama) first.
//   • If that's unset, times out, or errors, it falls back to OpenAI.
//   Both speak the OpenAI /chat/completions format, so it's one code path.
//
//   OPENAI_API_KEY    = sk-...            (the cloud backup)
//   OPENAI_TEXT_MODEL = gpt-4o-mini       (optional, default below)
//   LOCAL_LLM_URL     = https://llm.yourdomain.com/v1   (optional — your Mac tunnel)
//   LOCAL_LLM_MODEL   = qwen3:14b         (optional, default below)
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET       (locks the Mac tunnel)
//
// POST { texts:[...], target:'es', source:'en' } → { translations:[...] } (same order)

const admin = require('firebase-admin');   // shared cross-viewer translation cache (best-effort)
const { sessionExists, rateLimit, clientIp, sweepRateLimits } = require('../lib/guard');

const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const OPENAI_BASE       = 'https://api.openai.com/v1';

const LOCAL_LLM_URL     = process.env.LOCAL_LLM_URL || '';   // empty = skip local, go straight to OpenAI
const LOCAL_LLM_MODEL   = process.env.LOCAL_LLM_MODEL || 'qwen3:14b';

// Translation gets its OWN model knob, separate from Polly's. The two jobs have
// very different shapes: Polly emits hundreds of tokens (so it wants a small fast
// model), translation emits ~60 (so it can afford a bigger, more faithful one).
// Measured warm on the M4 against 8 real audience strings:
//   llama3.2:3b   1.0s  — drops emoji entirely; rendered "Draft it with Polly AI"
//                         as "Delete it with Polly AI" (and "Download it" on a rerun)
//   gemma4        10.5-12.9s — clean: emoji, brand names and proper nouns all intact
//   qwen3:14b     23.5-25.5s — clean, but past LOCAL_TIMEOUT_MS, so it would fall
//                         through to OpenAI on every single call
// Defaults to gemma4: the audience page no longer AWAITS translation before painting
// (answer.html renders in the deck language and swaps the viewer's language in when it
// lands), so the extra seconds cost nobody a blank screen. Override with
// LOCAL_TRANSLATE_MODEL if you want translation on a different model to Polly's.
// ⚠️ Keep gemma4 warm alongside Polly's model — a cold load measured ~18s.
const LOCAL_TRANSLATE_MODEL = process.env.LOCAL_TRANSLATE_MODEL || 'gemma4:latest';

// Cloudflare Access service-token headers — same as Polly, so the Mac tunnel
// only answers PollSlide's own server.
const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? {
      'CF-Access-Client-Id':     process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    }
  : {};

const LOCAL_TIMEOUT_MS  = 20000;  // the Mac gets first crack, but translation must feel instant to the audience
const CLOUD_TIMEOUT_MS  = 15000;

const LANG_NAMES = { en:'English', es:'Spanish', de:'German', fr:'French', pt:'Portuguese', it:'Italian', nl:'Dutch', ja:'Japanese', zh:'Chinese (Simplified)', ar:'Arabic', hi:'Hindi' };

// One helper for BOTH local Ollama and OpenAI — identical request shape (mirrors Polly).
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
        temperature: 0.2,                          // faithful, not creative
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

// Pull the translations array out of whatever the model returned.
function parseTranslations(raw, expectedLen) {
  if (!raw) return null;
  let obj;
  try { obj = JSON.parse(raw); }
  catch { const m = raw.match(/\{[\s\S]*\}/); try { obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; } }
  let arr = null;
  if (Array.isArray(obj)) arr = obj;
  else if (obj && Array.isArray(obj.translations)) arr = obj.translations;
  else if (obj && Array.isArray(obj.items)) arr = obj.items;
  else if (obj && Array.isArray(obj.t)) arr = obj.t;
  if (!Array.isArray(arr) || arr.length !== expectedLen) return null;
  return arr.map(String);
}

// Mechanical-corruption gate for LOCAL output.
// Small models silently drop emoji or translate the product name — both were
// measured on the real audience payload (🔴 vanished in Spanish, both emoji came
// back as "□" in German). A translation that mangles either is worse than none,
// so it's rejected here and the request falls through to the cloud provider.
// This deliberately only catches MECHANICAL damage — a wrong-but-well-formed
// translation ("Delete it" for "Draft it") still gets through. Only a competent
// model fixes that, which is what LOCAL_TRANSLATE_MODEL is for.
const BRAND_TERMS = ['PollSlide','SurveySlide','QuizSlide','StudySlide','PresentSlide','Polly'];
const EMOJI_RE    = /\p{Extended_Pictographic}/gu;

function qualityOk(sources, out) {
  if (!Array.isArray(out) || out.length !== sources.length) return false;
  for (let i = 0; i < sources.length; i++) {
    const s = String(sources[i] == null ? '' : sources[i]);
    const o = String(out[i]     == null ? '' : out[i]);
    for (const e of (s.match(EMOJI_RE) || [])) if (!o.includes(e)) return false;
    for (const b of BRAND_TERMS) if (s.includes(b) && !o.includes(b)) return false;
  }
  return true;
}

// ── Structured translation (whole questions) ─────────────────────────────────
// The audience page sends an array of question objects — {stem, options:[…], and
// optionally front/back/low/high}. Translating a question as ONE unit (instead of a
// bag of unrelated strings) is what stops the output reading word-for-word: the model
// sees each option IN THE CONTEXT of its question, so short answers land in the right
// sense and the options stay parallel to one another.
const STRUCT_KEYS = ['stem', 'front', 'back', 'low', 'high'];

// Trust nothing from the client: keep only known keys, coerce to strings, cap sizes,
// and cap how many questions / options one call carries. Option slots (including empty
// ones) are preserved in place so answer INDICES line up end-to-end.
function sanitizeQuestions(list) {
  const out = [];
  for (const raw of list.slice(0, 20)) {
    if (!raw || typeof raw !== 'object') continue;
    const q = {};
    for (const k of STRUCT_KEYS) {
      if (typeof raw[k] === 'string' && raw[k].length) q[k] = raw[k].slice(0, 600);
    }
    if (Array.isArray(raw.options)) {
      q.options = raw.options.slice(0, 12).map(s => String(s == null ? '' : s).slice(0, 600));
    }
    out.push(q);
  }
  return out;
}

// Flatten a questions array to its strings in a fixed order — used by the quality gate
// to compare source vs. output character-preservation (emoji, brand names).
function flattenQuestions(qs) {
  const arr = [];
  for (const q of (qs || [])) {
    for (const k of STRUCT_KEYS) if (typeof q[k] === 'string') arr.push(q[k]);
    if (Array.isArray(q.options)) for (const o of q.options) arr.push(String(o == null ? '' : o));
  }
  return arr;
}

// Pull the translated questions out of the model reply and normalise them back to the
// EXACT shape of the input — same count, same keys, same option positions. Anything the
// model dropped falls back to the source string. A mismatched option count fails the
// whole batch (returns null → OpenAI fallback): options are index-critical, so a
// half-aligned set is worse than none.
function parseStructured(raw, inputQs) {
  if (!raw) return null;
  let obj;
  try { obj = JSON.parse(raw); }
  catch { const m = raw.match(/\{[\s\S]*\}/); try { obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; } }
  let arr = null;
  if (Array.isArray(obj)) arr = obj;
  else if (obj && Array.isArray(obj.questions)) arr = obj.questions;
  else if (obj && Array.isArray(obj.items))     arr = obj.items;
  if (!Array.isArray(arr) || arr.length !== inputQs.length) return null;

  const out = [];
  for (let i = 0; i < inputQs.length; i++) {
    const src = inputQs[i] || {};
    const got = (arr[i] && typeof arr[i] === 'object' && !Array.isArray(arr[i])) ? arr[i] : {};
    const q = {};
    for (const k of STRUCT_KEYS) {
      if (typeof src[k] === 'string') q[k] = (typeof got[k] === 'string') ? got[k] : src[k];
    }
    if (Array.isArray(src.options)) {
      const g = Array.isArray(got.options) ? got.options : [];
      if (g.length !== src.options.length) return null;   // index-critical — reject the batch
      q.options = src.options.map((s, j) => (typeof g[j] === 'string') ? g[j] : String(s));
    }
    out.push(q);
  }
  return out;
}

// Same mechanical-corruption gate as the flat path (emoji dropped / brand translated),
// run over the flattened strings. A wrong-but-well-formed translation still passes —
// only the prompt (titles-are-FACTS) defends against that.
function qualityOkStructured(inQs, outQs) {
  return qualityOk(flattenQuestions(inQs), flattenQuestions(outQs));
}

// The structured system prompt. Carries EVERY defence the flat prompt earned the hard
// way (see the ⚠️ note on the flat prompt below) — titles-are-FACTS, emoji pass-through,
// brand verbatim — plus the one thing the flat path can't express: translate each
// question's stem together WITH its options, as a unit.
function buildStructuredSystem(targetName) {
  return `You are a professional translator localising LIVE quiz, poll and survey questions into ${targetName}. ` +
    `You receive a JSON object {"questions":[...]}. Translate the string fields of EACH question into ${targetName}, keeping every key and every array position exactly as given. ` +
    `Translate each question's "stem" TOGETHER WITH its "options" as one unit: use the stem to choose the correct sense of every option, especially short or one-word answers (a single word like "Orange" can be a fruit, a colour or a place — the stem tells you which). ` +
    `Make it sound natural, the way a native ${targetName} quizmaster would say it aloud — NOT word for word. Keep the options parallel to one another in form, tense and length so none stands out. ` +
    `Preserve numbers. ` +
    `Titles of books, films, songs and albums are FACTS, not phrases to translate: reproduce every title EXACTLY as written in the source, character for character. Never substitute a different work. ` +
    `Reproduce other proper nouns exactly too. ` +
    `Copy every emoji through EXACTLY as it appears — never drop one, never replace it with a different character. ` +
    `NEVER translate these product names, reproduce them verbatim: ${BRAND_TERMS.join(', ')}. ` +
    `Do NOT add explanations, and never answer the question. ` +
    `Return ONLY a JSON object {"questions":[...]} whose array has the SAME length and order as the input, each question object with the SAME keys and the SAME number of "options" in the same positions.`;
}

// ── Shared translation cache (Admin SDK; best-effort) ────────────────────────
// Reuses the app's existing firebase-admin pattern (see api/status.js). Returns null
// when Admin creds aren't configured, so caching cleanly no-ops in that case.
function getAdminDb() {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) return null;
    const app = admin.apps.length ? admin.apps[0] : admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    return admin.database(app);
  } catch (e) { return null; }
}

// A stable, RTDB-key-safe id for one source question in one source language. A 32-bit
// FNV-1a is plenty: the keyspace is a single deck's questions, namespaced by target
// language in the path.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
function cacheKey(source, q) {
  return 'q' + fnv1a(source + '\u0000' + JSON.stringify(q));
}

// Run the local→OpenAI provider chain for a set of questions. Returns {outQs, provider}
// where outQs is the normalised translation set, or null when both providers failed.
async function translateStructuredViaProviders(questions, targetName) {
  const units    = flattenQuestions(questions).length || questions.length;
  const messages = [{ role:'system', content: buildStructuredSystem(targetName) },
                    { role:'user',   content: JSON.stringify({ questions }) }];
  let raw = '', provider = '';
  if (LOCAL_LLM_URL) {
    try {
      const localBudget = Math.min(45000, Math.max(LOCAL_TIMEOUT_MS, 12000 + units * 1400));
      raw = await callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_TRANSLATE_MODEL, messages, timeoutMs: localBudget, extraHeaders: CF_ACCESS_HEADERS });
      provider = 'local';
    } catch (err) { console.warn('Translate(structured): local LLM unreachable → OpenAI fallback:', err.message); }
  }
  let outQs = parseStructured(raw, questions);
  if (outQs && provider === 'local' && !qualityOkStructured(questions, outQs)) {
    console.warn(`Translate(structured): ${LOCAL_TRANSLATE_MODEL} returned corrupted output → OpenAI fallback`);
    outQs = null; provider = '';
  }
  if (!outQs && OPENAI_API_KEY) {
    try {
      raw = await callChat({ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL, messages, timeoutMs: CLOUD_TIMEOUT_MS });
      provider = 'openai';
      outQs = parseStructured(raw, questions);
    } catch (err) { console.error('Translate(structured): OpenAI error:', err.message); }
  }
  return { outQs, provider };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  // Never hard-fail the audience: on any problem we return the ORIGINAL texts.
  const originals = (req.body && Array.isArray(req.body.texts)) ? req.body.texts.map(String) : [];

  // ── ABUSE GUARD ──────────────────────────────────────────────────────────
  // This endpoint is deliberately public (the audience is anonymous) but it spends
  // real AI budget, so it must not be an open tap. Two checks, both fail-open so a
  // live room is never blocked:
  //   • the session code must exist — a stranger can't guess one
  //   • per-session and per-IP rate limits — a valid code can't be hammered either
  // On refusal we still return the ORIGINAL text, so the audience sees the question
  // in the deck language rather than an error.
  try {
    const gdb = getAdminDb();
    if (gdb) {
      const code = String(req.body?.session || '');
      const ip = clientIp(req);
      if (!code || !(await sessionExists(gdb, code))) {
        console.warn('translate: refused — unknown session', code ? code.slice(0, 12) : '(none)', 'ip', ip);
        return res.status(200).json({ ok: true, translations: originals, questions: req.body?.questions || [], fallback: true, refused: 'unknown session' });
      }
      const [bySession, byIp] = await Promise.all([
        rateLimit(gdb, 'tr_s_' + code, 120, 60000),   // a big room translating a set
        rateLimit(gdb, 'tr_i_' + ip,   240, 60000),   // one IP, generous for shared wifi
      ]);
      if (!bySession.allowed || !byIp.allowed) {
        console.warn('translate: rate limited', code.slice(0, 12), ip, bySession.count, byIp.count);
        return res.status(200).json({ ok: true, translations: originals, questions: req.body?.questions || [], fallback: true, refused: 'rate limited' });
      }
      sweepRateLimits(gdb);
    }
  } catch (e) { /* guard must never break translation */ }

  try {
    const target = String(req.body?.target || '').slice(0, 8);
    const source = String(req.body?.source || '').slice(0, 8);
    const targetName = LANG_NAMES[target];

    // ── Structured mode ── translate whole questions, stem + options as ONE unit, so
    // the model can pick the right sense of every option (a one-word "Orange" is a
    // fruit, a colour or a place — the stem is what tells it which). This is the path
    // the audience page uses; the flat path below stays for any simple string list.
    if (Array.isArray(req.body?.questions) && req.body.questions.length) {
      const questions = sanitizeQuestions(req.body.questions);
      if (!questions.length)   return res.status(400).json({ error: 'No questions to translate.' });
      if (!targetName)         return res.status(400).json({ error: 'Unsupported target language.' });
      if (target === source)   return res.status(200).json({ ok:true, questions });
      if (!OPENAI_API_KEY && !LOCAL_LLM_URL)
        return res.status(200).json({ ok:true, questions, fallback:true, error:'No AI configured (LOCAL_LLM_URL or OPENAI_API_KEY).' });

      // ── Shared cross-viewer cache ── One translation per (session, question, language)
      // instead of one per VIEWER: 40 people picking Spanish now cost ONE model call, and
      // everyone reads identical wording. It's server-owned (Admin SDK), so the audience
      // never writes to Firebase — no new abuse surface, and no rules change (the cache
      // lives under quiz_builder/$code, which is already per-code readable; Admin writes
      // bypass rules). Best-effort throughout: if Admin creds are absent or a read/write
      // fails, it silently degrades to translating every time, exactly as before.
      const db        = getAdminDb();
      const session   = String(req.body?.session || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      const canCache  = !!(db && session);
      const cacheRoot = canCache ? db.ref(`quiz_builder/${session}/_i18n/${target}`) : null;

      const results = new Array(questions.length);
      const hit     = new Array(questions.length).fill(false);
      if (canCache) {
        // ONE read of the whole language bucket, then match locally. This used to be
        // one Firebase round-trip PER QUESTION — a 20-question deck cost 20 sequential
        // network hops before a single word was translated, on every viewer's request.
        try {
          const snap = await cacheRoot.get();
          const bucket = snap.exists() ? (snap.val() || {}) : {};
          questions.forEach((q, i) => {
            const v = bucket[cacheKey(source, q)];
            if (v) { results[i] = v; hit[i] = true; }
          });
        } catch (e) { /* treat the whole bucket as a miss */ }
      }
      const missQs = [], missIdx = [];
      questions.forEach((q, i) => { if (!hit[i]) { missIdx.push(i); missQs.push(q); } });

      let provider = 'cache';
      if (missQs.length) {
        const r = await translateStructuredViaProviders(missQs, targetName);
        provider = r.provider || provider;
        if (r.outQs) {
          r.outQs.forEach((oq, j) => {
            results[missIdx[j]] = oq;
            if (canCache) cacheRoot.child(cacheKey(source, missQs[j])).set(oq).catch(() => {});  // fire-and-forget
          });
        } else {
          // Translation failed outright — fill the misses with their originals so the
          // audience is never blocked, and DON'T cache a non-translation.
          missIdx.forEach((idx, j) => { results[idx] = missQs[j]; });
          return res.status(200).json({ ok:true, questions: results, fallback:true });
        }
      }
      return res.status(200).json({ ok:true, questions: results, provider, cached: questions.length - missQs.length });
    }

    // ── Flat mode (legacy) ── independent strings, translated one at a time. ──
    if (!OPENAI_API_KEY && !LOCAL_LLM_URL) {
      return res.status(200).json({ ok:true, translations: originals, fallback:true, error:'No AI configured (LOCAL_LLM_URL or OPENAI_API_KEY).' });
    }

    const texts  = (Array.isArray(req.body?.texts) ? req.body.texts : []).map(s => String(s == null ? '' : s).slice(0, 600)).slice(0, 40);
    if (!texts.length)         return res.status(400).json({ error: 'No texts to translate.' });
    if (!targetName)           return res.status(400).json({ error: 'Unsupported target language.' });
    if (target === source)     return res.status(200).json({ ok:true, translations: texts });

    // ⚠️ The "titles are FACTS" sentence is load-bearing, not padding. Without it,
    // gemma4 rewrote "Who wrote the novel To Kill a Mockingbird?" as "…Gone with the
    // Wind?" in 3 of 3 German runs — silently turning a quiz question into one whose
    // listed answer is wrong. With it, 3 of 3 runs kept the title. No output check can
    // catch this (nothing is malformed), so the prompt is the only defence. Re-test
    // this exact case if you ever touch this string or change LOCAL_TRANSLATE_MODEL.
    const system = `You are a professional translator. Translate each input string into ${targetName}. ` +
      `Keep it natural and concise. Preserve numbers and proper nouns. ` +
      `Copy every emoji through EXACTLY as it appears — never drop one, never replace it with a different character. ` +
      `NEVER translate these product names, reproduce them verbatim: ${BRAND_TERMS.join(', ')}. ` +
      `Titles of books, films, songs and albums are FACTS, not phrases to translate: reproduce every title EXACTLY as written in the source, character for character. Never substitute a different work. ` +
      `Do NOT add explanations. ` +
      `Return ONLY a JSON object of the form {"translations": [...]} whose array has the SAME order and length as the input.`;
    const messages = [{ role:'system', content: system }, { role:'user', content: JSON.stringify(texts) }];

    let raw = '', provider = '';

    // 1) Try the local Mac (Ollama) first, exactly like Polly.
    if (LOCAL_LLM_URL) {
      try {
        // Bigger translation models need more headroom than the flat 20s, and the
        // budget should track how much there is to translate.
        const localBudget = Math.min(28000, Math.max(LOCAL_TIMEOUT_MS, 12000 + texts.length * 1200));
        raw = await callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_TRANSLATE_MODEL, messages, timeoutMs: localBudget, extraHeaders: CF_ACCESS_HEADERS });
        provider = 'local';
      } catch (err) {
        console.warn('Translate: local LLM unreachable → OpenAI fallback:', err.message);
      }
    }

    // 2) Fall back to OpenAI — either because local failed outright, or because it
    //    came back corrupted (emoji dropped / brand name translated).
    let translations = parseTranslations(raw, texts.length);
    if (translations && provider === 'local' && !qualityOk(texts, translations)) {
      console.warn(`Translate: ${LOCAL_TRANSLATE_MODEL} returned corrupted output → OpenAI fallback`);
      translations = null;
      provider = '';
    }
    if (!translations && OPENAI_API_KEY) {
      try {
        raw = await callChat({ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL, messages, timeoutMs: CLOUD_TIMEOUT_MS });
        provider = 'openai';
        translations = parseTranslations(raw, texts.length);
      } catch (err) {
        console.error('Translate: OpenAI error:', err.message);
      }
    }

    if (!translations) return res.status(200).json({ ok:true, translations: texts, fallback:true });
    return res.status(200).json({ ok:true, translations, provider });
  } catch (e) {
    return res.status(200).json({ ok:true, translations: originals, fallback:true, error: String(e && e.message || e) });
  }
};
