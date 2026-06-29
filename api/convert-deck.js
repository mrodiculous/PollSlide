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
//   CONVERT_API_URL = https://convert.yourdomain.com/to-pdf   (optional)
//   CONVERT_API_KEY = ...                                     (optional bearer)
//
// CONTRACT
//   In : POST raw bytes, header  x-filename: <url-encoded original name>
//   Out: 200 application/pdf  (the converted deck)  |  JSON {ok:false, code, ...}
//
// The upstream provider receives: POST octet-stream, headers x-filename + x-target:pdf
// (+ Authorization: Bearer <CONVERT_API_KEY> if set), and must return application/pdf.

const CONVERT_API_URL = process.env.CONVERT_API_URL || '';
const CONVERT_API_KEY = process.env.CONVERT_API_KEY || '';
const MAX_BYTES       = 50 * 1024 * 1024; // 50 MB upload guard
const UPSTREAM_TIMEOUT_MS = 60000;

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // No provider configured → tell the client to use the export-to-PDF path. 200 so
  // it's handled as a normal "fall back" branch, not a fetch error.
  if (!CONVERT_API_URL) {
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

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(CONVERT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-filename': encodeURIComponent(filename),
          'x-target': 'pdf',
          ...(CONVERT_API_KEY ? { Authorization: 'Bearer ' + CONVERT_API_KEY } : {}),
        },
        body: raw,
        signal: ctrl.signal,
      });
    } finally { clearTimeout(timer); }

    if (!upstream.ok) {
      return res.status(502).json({ ok: false, code: 'provider-failed', status: upstream.status });
    }
    const ct = upstream.headers.get('content-type') || '';
    if (!ct.includes('application/pdf')) {
      const detail = await upstream.text().catch(() => '');
      return res.status(502).json({ ok: false, code: 'provider-no-pdf', detail: detail.slice(0, 200) });
    }

    const pdf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pdf);
  } catch (e) {
    return res.status(500).json({ ok: false, code: 'error', error: String((e && e.message) || e) });
  }
};
