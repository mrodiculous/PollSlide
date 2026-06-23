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

    const system = `You are a professional translator. Translate each input string into ${targetName}. ` +
      `Keep it natural and concise. Preserve emojis, numbers, and proper nouns. Do NOT add explanations. ` +
      `Return ONLY a JSON object of the form {"translations": [...]} whose array has the SAME order and length as the input.`;
    const messages = [{ role:'system', content: system }, { role:'user', content: JSON.stringify(texts) }];

    let raw = '', provider = '';

    // 1) Try the local Mac (Ollama) first, exactly like Polly.
    if (LOCAL_LLM_URL) {
      try {
        raw = await callChat({ baseURL: LOCAL_LLM_URL, apiKey: 'ollama', model: LOCAL_LLM_MODEL, messages, timeoutMs: LOCAL_TIMEOUT_MS, extraHeaders: CF_ACCESS_HEADERS });
        provider = 'local';
      } catch (err) {
        console.warn('Translate: local LLM unreachable → OpenAI fallback:', err.message);
      }
    }

    // 2) Fall back to OpenAI.
    let translations = parseTranslations(raw, texts.length);
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
