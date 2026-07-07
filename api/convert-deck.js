// PollSlide — deck conversion for "Present from PollSlide".
// Converts an uploaded PowerPoint (.pptx/.ppt) or Keynote (.key) into a PDF so the
// presenter view can render every slide pixel-faithfully (pdf.js on the client).
//
// PROVIDER MODEL (same philosophy as api/translate.js — pluggable + graceful):
//   • Set CONVERT_API_URL to any converter that accepts the raw file and returns a
//     PDF. That can be a self-hosted LibreOffice/unoconv microservice, a CloudConvert
//     wrapper, etc. PollSlide stays provider-agnostic.
//   • If CONVERT_API_URL is unset, we return {ok:false, needsProvider:true} (200) so
//     the client cleanly falls back to its "export to PDF" guidance — never an error
//     the user sees as a crash.
//
//   CONVERT_API_URL      = https://convert.yourdomain.com   (primary — e.g. the Mac
//                          converter-service behind a Cloudflare tunnel)
//   CONVERT_API_KEY      = ...                              (optional bearer)
//   CONVERT_FALLBACK_URL = https://<container-host>         (optional backup — same
//                          converter-service Docker image on Fly/Railway; tried
//                          automatically when the primary is down or errors)
//   CONVERT_FALLBACK_KEY = ...                              (optional bearer)
//
// CONTRACT
//   In : POST raw bytes, header  x-filename: <url-encoded original name>
//   Out: 200 application/pdf  (the converted deck)  |  JSON {ok:false, code, ...}
//
// Each provider receives: POST octet-stream, headers x-filename + x-target:pdf
// (+ Authorization: Bearer <key> if set), and must return application/pdf.

const CONVERT_API_URL      = process.env.CONVERT_API_URL || '';
const CONVERT_API_KEY      = process.env.CONVERT_API_KEY || '';
const CONVERT_FALLBACK_URL = process.env.CONVERT_FALLBACK_URL || '';
const CONVERT_FALLBACK_KEY = process.env.CONVERT_FALLBACK_KEY || '';
const MAX_BYTES       = 50 * 1024 * 1024; // 50 MB upload guard
const UPSTREAM_TIMEOUT_MS = 25000;        // per provider — leaves the fallback room inside the 60s function cap

// Read the request body as a Buffer whether the runtime pre-parsed it or not.
async function getRawBody(req) {
  if (req.body) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

// POST the deck to one provider; returns a PDF Buffer or throws with a reason.
async function tryProvider(url, key, raw, filename) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-filename': encodeURIComponent(filename),
        'x-target': 'pdf',
        ...(key ? { Authorization: 'Bearer ' + key } : {}),
      },
      body: raw,
      signal: ctrl.signal,
    });
  } finally { clearTimeout(timer); }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    throw new Error('provider-failed:' + upstream.status + ':' + detail.slice(0, 200));
  }
  const ct = upstream.headers.get('content-type') || '';
  if (!ct.includes('application/pdf')) {
    const detail = await upstream.text().catch(() => '');
    throw new Error('provider-no-pdf::' + detail.slice(0, 200));
  }
  return Buffer.from(await upstream.arrayBuffer());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // Primary first (Rod's Mac via tunnel), then the container fallback if the
  // primary is down/asleep/erroring. Providers share one contract, so the chain
  // is just "try in order".
  const providers = [
    CONVERT_API_URL      ? { url: CONVERT_API_URL,      key: CONVERT_API_KEY }      : null,
    CONVERT_FALLBACK_URL ? { url: CONVERT_FALLBACK_URL, key: CONVERT_FALLBACK_KEY } : null,
  ].filter(Boolean);

  // No provider configured → tell the client to use the export-to-PDF path. 200 so
  // it's handled as a normal "fall back" branch, not a fetch error.
  if (!providers.length) {
    return res.status(200).json({
      ok: false, needsProvider: true, code: 'no-provider',
      message: 'Deck conversion is not configured (set CONVERT_API_URL). Export your deck to PDF and import that.'
    });
  }

  try {
    const filename = decodeURIComponent(String(req.headers['x-filename'] || 'deck')).slice(0, 200);
    const raw = await getRawBody(req);
    if (!raw || !raw.length) return res.status(400).json({ ok: false, code: 'empty', error: 'Empty upload.' });
    if (raw.length > MAX_BYTES) return res.status(413).json({ ok: false, code: 'too-large', error: 'File too large.' });

    let lastErr = null;
    for (const p of providers) {
      try {
        const pdf = await tryProvider(p.url, p.key, raw, filename);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(pdf);
      } catch (e) { lastErr = e; } // primary failed → next provider
    }

    // Every provider failed — surface the last failure the same way as before.
    const msg = String((lastErr && lastErr.message) || lastErr || '');
    const m = msg.match(/^(provider-failed|provider-no-pdf):([^:]*):(.*)$/s);
    if (m) {
      return res.status(502).json({
        ok: false, code: m[1],
        ...(m[2] ? { status: Number(m[2]) } : {}),
        ...(m[3] ? { detail: m[3] } : {})
      });
    }
    return res.status(502).json({ ok: false, code: 'provider-failed', detail: msg.slice(0, 200) });
  } catch (e) {
    return res.status(500).json({ ok: false, code: 'error', error: String((e && e.message) || e) });
  }
};
