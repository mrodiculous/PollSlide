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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  // Never hard-fail the audience: on any problem we return the ORIGINAL texts.
  const originals = (req.body && Array.isArray(req.body.texts)) ? req.body.texts.map(String) : [];

  try {
    if (!OPENAI_API_KEY && !LOCAL_LLM_URL) {
      return res.status(200).json({ ok:true, translations: originals, fallback:true, error:'No AI configured (LOCAL_LLM_URL or OPENAI_API_KEY).' });
    }

    const texts  = (Array.isArray(req.body?.texts) ? req.body.texts : []).map(s => String(s == null ? '' : s).slice(0, 600)).slice(0, 40);
    const target = String(req.body?.target || '').slice(0, 8);
    const source = String(req.body?.source || '').slice(0, 8);
    if (!texts.length)         return res.status(400).json({ error: 'No texts to translate.' });
    const targetName = LANG_NAMES[target];
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
