// PollSlide — AI provider status (read-only, secret-free).
// Powers the admin "AI / Polly Management" panel so you can SEE, at a glance:
//   • which providers are configured for each job (text / summaries / images)
//   • whether your local Mac (Ollama tunnel) is actually awake & reachable right now
//
// Returns ONLY booleans, model names, and reachability — never the keys themselves,
// so it's safe even if the endpoint is hit directly.
//
// GET /api/ai-status  ->  { text:{...}, summaries:{...}, images:{...}, local:{...} }

const OPENAI_API_KEY    = process.env.OPENAI_API_KEY;
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL   = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const LOCAL_LLM_URL     = process.env.LOCAL_LLM_URL || '';
const LOCAL_LLM_MODEL   = process.env.LOCAL_LLM_MODEL || 'qwen3:14b';

const LOCAL_IMAGE_URL   = process.env.LOCAL_IMAGE_URL || '';
const LOCAL_IMAGE_MODEL = process.env.LOCAL_IMAGE_MODEL || 'flux.1-dev';
const FAL_KEY           = process.env.FAL_KEY || '';
const FAL_MODEL         = process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/schnell';

const CF_ACCESS_HEADERS = (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET)
  ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET }
  : {};

// Lightweight reachability probe — GET {baseURL}/models with a short timeout.
async function probe(baseURL) {
  if (!baseURL) return { configured: false, reachable: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  const t0 = Date.now();
  try {
    const r = await fetch(`${baseURL}/models`, { headers: { ...CF_ACCESS_HEADERS }, signal: controller.signal });
    return { configured: true, reachable: r.ok, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { configured: true, reachable: false, error: (e && e.name === 'AbortError') ? 'timeout' : String(e && e.message || e), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const localLLM   = await probe(LOCAL_LLM_URL);
  const localImage = await probe(LOCAL_IMAGE_URL);

  return res.status(200).json({
    ok: true,
    checkedAt: new Date().toISOString(),
    // Polly question generation + live audience translation share this chain.
    text: {
      order: ['local', 'openai'],
      local:  { configured: !!LOCAL_LLM_URL, model: LOCAL_LLM_MODEL, ...localLLM },
      openai: { configured: !!OPENAI_API_KEY, model: OPENAI_TEXT_MODEL },
    },
    // AI response summaries + free-text grading (api/ai.js).
    summaries: {
      order: ['claude', 'openai'],
      claude: { configured: !!ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL },
      openai: { configured: !!OPENAI_API_KEY, model: OPENAI_TEXT_MODEL },
    },
    // Question images (api/polly-image.js).
    images: {
      order: ['local', 'fal', 'openai'],
      local:  { configured: !!LOCAL_IMAGE_URL, model: LOCAL_IMAGE_MODEL, ...localImage },
      fal:    { configured: !!FAL_KEY, model: FAL_MODEL },
      openai: { configured: !!OPENAI_API_KEY, model: 'gpt-image-1' },
    },
    cfAccess: !!(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET),
  });
};
