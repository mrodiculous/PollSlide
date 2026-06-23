// PollSlide — Polly AI Image Generator
// Vercel Serverless Function
//
// Turns an imagePrompt (from /api/polly) into a picture for the question slide.
//
// PROVIDER PRIORITY (local first — same philosophy as Polly's text engine):
//   1) LOCAL image server (LOCAL_IMAGE_URL) — your own Mac, $0 marginal cost. Must
//      speak the OpenAI images format (POST {url}/images/generations). FLUX.1-dev
//      run locally is on par with OpenAI. See the setup note at the bottom.
//   2) fal.ai FLUX (FAL_KEY) — cheap cloud (~$0.003 schnell / ~$0.025 dev), great quality
//   3) OpenAI gpt-image-1 (OPENAI_API_KEY) — last-resort fallback (~$0.04+/image)
//
// VERCEL ENVIRONMENT VARIABLES:
//   LOCAL_IMAGE_URL   = https://img.yourdomain.com/v1  (optional — your Mac tunnel; OpenAI-images compatible)
//   LOCAL_IMAGE_MODEL = flux.1-dev                     (optional)
//   FAL_KEY           = <fal.ai key>                   (recommended cloud primary — cheap + excellent)
//   FAL_IMAGE_MODEL   = fal-ai/flux/schnell            (optional; use fal-ai/flux/dev for higher quality)
//   OPENAI_API_KEY    = sk-...                          (optional cloud fallback)
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET       (locks the Mac tunnel, like Polly)
//   NEXT_PUBLIC_APP_URL = https://app.pollslide.com    (optional, for CORS)
//
// Returns: { source, image: "data:image/...;base64,...." } — a base64 data URI so it
// renders instantly; the client uploads it to Firebase Storage for a small, stable URL.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const FAL_KEY   = process.env.FAL_KEY || '';
// Guard against a misconfigured value (e.g. the env Name/Value swapped). A fal model id
// must look like "fal-ai/..."; anything else would 404 and silently fall back to OpenAI.
const FAL_MODEL = (() => {
  const m = (process.env.FAL_IMAGE_MODEL || '').trim();
  return m.startsWith('fal-ai/') ? m : 'fal-ai/flux/schnell';
})();

const LOCAL_IMAGE_URL   = process.env.LOCAL_IMAGE_URL || '';   // empty = skip local, go to fal/OpenAI
const LOCAL_IMAGE_MODEL = process.env.LOCAL_IMAGE_MODEL || 'flux.1-dev';
const LOCAL_IMAGE_TIMEOUT_MS = 45000;  // local FLUX can take a while; still under the function budget

// Cloudflare Access service-token headers — same as Polly, so the Mac tunnel
// only answers PollSlide's own server.
const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET }
  : {};

// Local FLUX (or any OpenAI-images-compatible server, e.g. LocalAI) on your Mac.
async function localImage(prompt, size) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_IMAGE_TIMEOUT_MS);
  try {
    const r = await fetch(`${LOCAL_IMAGE_URL}/images/generations`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer local', ...CF_ACCESS_HEADERS },
      body: JSON.stringify({ model: LOCAL_IMAGE_MODEL, prompt, size, n: 1, response_format: 'b64_json' }),
      signal: controller.signal,
    });
    if (!r.ok) { const d = await r.text().catch(()=> ''); throw new Error(`HTTP ${r.status} ${d.slice(0,160)}`); }
    const data = await r.json();
    const item = data.data && data.data[0];
    if (item && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item && item.url) {                                  // some servers return a URL instead
      const img = await fetch(item.url);
      const buf = Buffer.from(await img.arrayBuffer());
      const ct  = img.headers.get('content-type') || 'image/png';
      return `data:${ct};base64,${buf.toString('base64')}`;
    }
    throw new Error('local image server returned no image');
  } finally {
    clearTimeout(timer);
  }
}

// fal.ai FLUX — primary generator. Fetches the result and returns a data URI so the
// response format stays identical regardless of provider.
async function falImage(prompt, size) {
  const sizeMap = { '1024x1024':'square_hd', '1536x1024':'landscape_4_3', '1024x1536':'portrait_4_3', 'auto':'square_hd' };
  const r = await fetch('https://fal.run/' + FAL_MODEL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Key ' + FAL_KEY },
    body: JSON.stringify({ prompt, image_size: sizeMap[size] || 'square_hd', num_inference_steps: 4, num_images: 1, enable_safety_checker: true }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail || data.error || `HTTP ${r.status}`);
  const url = data.images && data.images[0] && data.images[0].url;
  if (!url) throw new Error('fal.ai returned no image');
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  const ct  = img.headers.get('content-type') || 'image/jpeg';
  return `data:${ct};base64,${buf.toString('base64')}`;
}

async function openaiImage(prompt, size) {
  const r = await fetch(OPENAI_IMAGE_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `HTTP ${r.status}`);
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image');
  return `data:image/png;base64,${b64}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  if (!LOCAL_IMAGE_URL && !FAL_KEY && !OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No image generator configured. Add LOCAL_IMAGE_URL (your Mac), FAL_KEY (cheap cloud), or OPENAI_API_KEY in Vercel → Settings → Environment Variables.' });
  }

  const body   = req.body || {};
  const prompt = String(body.prompt || '').trim();
  const size   = ['1024x1024', '1024x1536', '1536x1024', 'auto'].includes(body.size) ? body.size : '1024x1024';
  if (!prompt) return res.status(400).json({ error: 'Missing "prompt".' });

  const fellBack = {}; // why each provider was skipped — returned so silent fallbacks are debuggable

  // 1) Try the local Mac first — $0 marginal cost (like Polly's text engine).
  if (LOCAL_IMAGE_URL) {
    try {
      const image = await localImage(prompt, size);
      return res.status(200).json({ source: 'local', image });
    } catch (err) {
      fellBack.local = err.message;
      console.warn('Polly image: local server failed → fal/OpenAI fallback:', err.message);
    }
  }

  // 2) Try fal.ai FLUX — cheap cloud, excellent quality.
  if (FAL_KEY) {
    try {
      const image = await falImage(prompt, size);
      return res.status(200).json({ source: 'fal', image, model: FAL_MODEL });
    } catch (err) {
      fellBack.fal = err.message;
      console.warn('Polly image: fal.ai failed → OpenAI fallback:', err.message);
    }
  }

  // 3) Fall back to OpenAI.
  if (!OPENAI_API_KEY) return res.status(502).json({ error: 'No working image provider (local + fal unavailable and no OpenAI key set).', fellBack });
  try {
    const image = await openaiImage(prompt, size);
    // Include why we didn't use the cheaper providers, so "why is this still OpenAI?" is answerable.
    return res.status(200).json({ source: 'openai', image, ...(Object.keys(fellBack).length ? { fellBack } : {}) });
  } catch (err) {
    console.error('Polly image: OpenAI error:', err.message);
    return res.status(502).json({ error: 'Image generation failed', detail: err.message, fellBack });
  }
};
