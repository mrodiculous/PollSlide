// PollSlide — Polly AI Image Generator
// Vercel Serverless Function
//
// Turns an imagePrompt (from /api/polly) into a picture for the question slide.
//
// PROVIDER PRIORITY (best price/quality first):
//   1) fal.ai FLUX (FAL_KEY)  — ~$0.003/image on flux/schnell, near-instant, great quality
//   2) OpenAI gpt-image-1 (OPENAI_API_KEY) — fallback (~$0.04/image)
//
// VERCEL ENVIRONMENT VARIABLES:
//   FAL_KEY          = <fal.ai key>            (RECOMMENDED primary — cheapest + best)
//   FAL_IMAGE_MODEL  = fal-ai/flux/schnell     (optional; use fal-ai/flux/dev for higher quality)
//   OPENAI_API_KEY   = sk-...                   (optional cloud fallback)
//   NEXT_PUBLIC_APP_URL = https://app.pollslide.com  (optional, for CORS)
//
// Returns: { source, image: "data:image/...;base64,...." } — a base64 data URI so it
// renders instantly; the client uploads it to Firebase Storage for a small, stable URL.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const FAL_KEY   = process.env.FAL_KEY || '';
const FAL_MODEL = process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/schnell';

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

  if (!FAL_KEY && !OPENAI_API_KEY) {
    return res.status(500).json({ error: 'No image generator configured. Add FAL_KEY (recommended) or OPENAI_API_KEY in Vercel → Settings → Environment Variables.' });
  }

  const body   = req.body || {};
  const prompt = String(body.prompt || '').trim();
  const size   = ['1024x1024', '1024x1536', '1536x1024', 'auto'].includes(body.size) ? body.size : '1024x1024';
  if (!prompt) return res.status(400).json({ error: 'Missing "prompt".' });

  // 1) Try fal.ai FLUX first — cheapest + best quality.
  if (FAL_KEY) {
    try {
      const image = await falImage(prompt, size);
      return res.status(200).json({ source: 'fal', image });
    } catch (err) {
      console.warn('Polly image: fal.ai failed → OpenAI fallback:', err.message);
    }
  }

  // 2) Fall back to OpenAI.
  if (!OPENAI_API_KEY) return res.status(502).json({ error: 'fal.ai unavailable and no OpenAI key set.' });
  try {
    const image = await openaiImage(prompt, size);
    return res.status(200).json({ source: 'openai', image });
  } catch (err) {
    console.error('Polly image: OpenAI error:', err.message);
    return res.status(502).json({ error: 'Image generation failed', detail: err.message });
  }
};
