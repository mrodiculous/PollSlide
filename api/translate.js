// PollSlide — on-the-fly translation for the audience answer page.
// Each attendee can read questions/options in THEIR language; the deck's language
// is the source. Display-only — stored responses keep the original option indices.
//
// Provider: Claude (ANTHROPIC_API_KEY) preferred, OpenAI fallback.
// POST { texts:[...], target:'es', source:'en' } → { translations:[...] } (same order)

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const OPENAI_MODEL      = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';

const LANG_NAMES = { en:'English', es:'Spanish', de:'German', fr:'French', pt:'Portuguese', it:'Italian', nl:'Dutch', ja:'Japanese', zh:'Chinese (Simplified)', ar:'Arabic', hi:'Hindi' };

async function callClaude(system, user) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'content-type':'application/json', 'x-api-key':ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 2000, system, messages:[{ role:'user', content:user }] }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
  return (d.content && d.content[0] && d.content[0].text) || '';
}
async function callOpenAI(system, user) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{ 'content-type':'application/json', 'authorization':'Bearer '+OPENAI_API_KEY },
    body: JSON.stringify({ model: OPENAI_MODEL, max_tokens: 2000, messages:[{ role:'system', content:system }, { role:'user', content:user }] }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
  return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
}
function extractArray(t) {
  if (!t) return null;
  const m = t.match(/\[[\s\S]*\]/);
  try { return m ? JSON.parse(m[0]) : null; } catch(e) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  try {
    const body   = req.body || {};
    const texts  = (Array.isArray(body.texts) ? body.texts : []).map(s => String(s == null ? '' : s).slice(0, 600)).slice(0, 40);
    const target = String(body.target || '').slice(0, 8);
    const source = String(body.source || '').slice(0, 8);
    if (!texts.length) return res.status(400).json({ error: 'No texts to translate.' });
    const targetName = LANG_NAMES[target];
    if (!targetName) return res.status(400).json({ error: 'Unsupported target language.' });
    if (target === source) return res.status(200).json({ ok:true, translations: texts });

    const system = `You are a professional translator. Translate each input string into ${targetName}. ` +
      `Keep it natural and concise. Preserve any emojis, numbers, and proper nouns. Do NOT add explanations. ` +
      `Return ONLY a JSON array of the translated strings, in the SAME order and length as the input — no other text.`;
    const user = JSON.stringify(texts);

    let out;
    if (ANTHROPIC_API_KEY)      out = await callClaude(system, user);
    else if (OPENAI_API_KEY)    out = await callOpenAI(system, user);
    else return res.status(500).json({ error: 'No AI configured (ANTHROPIC_API_KEY or OPENAI_API_KEY).' });

    const arr = extractArray(out);
    if (!Array.isArray(arr) || arr.length !== texts.length) {
      // Don't break the audience — fall back to the originals.
      return res.status(200).json({ ok:true, translations: texts, fallback:true });
    }
    return res.status(200).json({ ok:true, translations: arr.map(String) });
  } catch (e) {
    return res.status(200).json({ ok:true, translations: (req.body && req.body.texts) || [], fallback:true, error: String(e && e.message || e) });
  }
};
