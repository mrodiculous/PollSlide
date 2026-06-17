// PollSlide — Polly AI Image Generator
// Vercel Serverless Function
//
// Turns an imagePrompt (from /api/polly) into a picture for the question slide.
//
// LOCAL-FIRST, CLOUD-FALLBACK:
//   • If DRAWTHINGS_URL is set, it asks your Mac's Draw Things server first.
//   • Otherwise / on failure, it falls back to OpenAI gpt-image-1.
//
// VERCEL ENVIRONMENT VARIABLES:
//   OPENAI_API_KEY  = sk-...                              (REQUIRED — the cloud backup)
//   DRAWTHINGS_URL  = https://img.yourdomain.com          (optional — set once your Mac tunnel is live)
//   CF_ACCESS_CLIENT_ID     = <service-token id>          (locks the Mac tunnel via Cloudflare Access)
//   CF_ACCESS_CLIENT_SECRET = <service-token secret>      (locks the Mac tunnel via Cloudflare Access)
//   NEXT_PUBLIC_APP_URL = https://app.pollslide.com       (optional, for CORS)
//
// Returns: { source, image: "data:image/png;base64,...." }
// NOTE: the image comes back as a base64 data URI so it renders instantly.
//   FORWARD-FEATURE: for production, upload to your image host (see v4 Vid_GIF_Image
//   hosting) and return a short URL instead — keeps Firebase docs small.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const DRAWTHINGS_URL = process.env.DRAWTHINGS_URL || '';

// Cloudflare Access service-token headers (see api/polly.js) — locks the Mac tunnel
// so only PollSlide's server can reach Draw Things.
const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? {
      'CF-Access-Client-Id':     process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    }
  : {};

const DRAWTHINGS_TIMEOUT_MS = 35000;   // leave room inside the 60s function budget for an OpenAI fallback

async function drawThings(prompt, { width, height, steps }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAWTHINGS_TIMEOUT_MS);
  try {
    const r = await fetch(`${DRAWTHINGS_URL}/sdapi/v1/txt2img`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...CF_ACCESS_HEADERS },
      body: JSON.stringify({ prompt, width, height, steps }),
      signal:  controller.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const b64 = data.images && data.images[0];
    if (!b64) throw new Error('Draw Things returned no image');
    return `data:image/png;base64,${b64}`;
  } finally {
    clearTimeout(timer);
  }
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

  if (!OPENAI_API_KEY && !DRAWTHINGS_URL) {
    return res.status(500).json({ error: 'No image generator configured. Add OPENAI_API_KEY in Vercel → Settings → Environment Variables.' });
  }

  const body   = req.body || {};
  const prompt = String(body.prompt || '').trim();
  const size   = ['1024x1024', '1024x1536', '1536x1024', 'auto'].includes(body.size) ? body.size : '1024x1024';
  if (!prompt) return res.status(400).json({ error: 'Missing "prompt".' });

  // map OpenAI size → Draw Things width/height
  const [w, h] = size === 'auto' ? [1024, 1024] : size.split('x').map(Number);

  // 1) Try the user's own Mac (Draw Things) first.
  if (DRAWTHINGS_URL) {
    try {
      const image = await drawThings(prompt, { width: w, height: h, steps: 25 });
      return res.status(200).json({ source: 'local', image });
    } catch (err) {
      console.warn('Polly image: Draw Things unreachable → OpenAI fallback:', err.message);
    }
  }

  // 2) Fall back to OpenAI.
  if (!OPENAI_API_KEY) return res.status(502).json({ error: 'Draw Things unreachable and no OpenAI key set.' });
  try {
    const image = await openaiImage(prompt, size);
    return res.status(200).json({ source: 'openai', image });
  } catch (err) {
    console.error('Polly image: OpenAI error:', err.message);
    return res.status(502).json({ error: 'Image generation failed', detail: err.message });
  }
};
