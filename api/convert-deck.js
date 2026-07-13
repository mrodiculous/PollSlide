// PollSlide — deck conversion for "Present from PollSlide".
// Converts an uploaded PowerPoint (.pptx/.ppt) or Keynote (.key) into a PDF so the
// presenter view can render every slide pixel-faithfully (pdf.js on the client).
//
// PROVIDER MODEL (same philosophy as api/translate.js — pluggable + graceful):
//   • PRIMARY (recommended): set CLOUDCONVERT_API_KEY. CloudConvert converts
//     .pptx/.ppt/.key/.odp → PDF reliably, always on, nothing to host — tried first.
//     (Keynote .key is supported — LibreOffice/Google/Microsoft cannot read it.)
//   • FALLBACK: set CONVERT_API_URL to any converter that accepts the raw file and
//     returns a PDF (self-hosted LibreOffice/unoconv microservice, etc.).
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
// PRIMARY converter: CloudConvert — reliably converts .pptx/.ppt/.key/.odp → PDF,
// always on, nothing to maintain. Set CLOUDCONVERT_API_KEY in the app's env.
const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY || '';
const CC_BASE = 'https://api.cloudconvert.com/v2';
const CC_POLL_MS   = 2000;
const CC_DEADLINE  = 48000;               // total wait budget, stays inside the 60s function cap
const MAX_BYTES       = 50 * 1024 * 1024; // 50 MB upload guard
const UPSTREAM_TIMEOUT_MS = 25000;        // per generic provider — leaves the fallback room inside the 60s function cap

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

// CloudConvert format code from the filename (pptx/ppt/key/odp/pdf). Null → let
// CloudConvert auto-detect.
function ccInputFormat(filename) {
  const ext = (String(filename).split('.').pop() || '').toLowerCase();
  return ['pptx', 'ppt', 'key', 'odp', 'pdf'].includes(ext) ? ext : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Convert a deck to PDF via CloudConvert: create a job (upload → convert → export),
// upload the bytes, poll until finished, download the PDF. Uses Node 18+ globals
// (fetch / FormData / Blob) — no dependency needed. Throws on any failure so the
// handler can fall through to the next provider / graceful message.
async function tryCloudConvert(raw, filename) {
  const auth = { Authorization: 'Bearer ' + CLOUDCONVERT_API_KEY };
  const inFmt = ccInputFormat(filename);
  const convert = { operation: 'convert', input: 'upload', output_format: 'pdf' };
  if (inFmt && inFmt !== 'pdf') convert.input_format = inFmt;

  // 1) Create the job.
  const jobRes = await fetch(CC_BASE + '/jobs', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: {
        upload:  { operation: 'import/upload' },
        convert,
        export:  { operation: 'export/url', input: 'convert', archive_multiple_files: false },
      },
    }),
  });
  if (!jobRes.ok) throw new Error('provider-failed:' + jobRes.status + ':' + (await jobRes.text().catch(() => '')).slice(0, 180));
  const job = (await jobRes.json()).data;

  // 2) Upload the file to the form the upload task hands back (parameters first, file last).
  const uploadTask = (job.tasks || []).find((t) => t.name === 'upload');
  const form = uploadTask && uploadTask.result && uploadTask.result.form;
  if (!form || !form.url) throw new Error('provider-no-pdf::cloudconvert-no-upload-form');
  const fd = new FormData();
  for (const [k, v] of Object.entries(form.parameters || {})) fd.append(k, v);
  fd.append('file', new Blob([raw]), filename);
  const up = await fetch(form.url, { method: 'POST', body: fd });
  if (!up.ok) throw new Error('provider-failed:' + up.status + ':cloudconvert-upload');

  // 3) Poll the job until it finishes.
  const deadline = Date.now() + CC_DEADLINE;
  let done = null;
  while (Date.now() < deadline) {
    await sleep(CC_POLL_MS);
    const st = await fetch(CC_BASE + '/jobs/' + job.id + '?include=tasks', { headers: auth });
    if (!st.ok) continue;
    const d = (await st.json()).data;
    if (d.status === 'finished') { done = d; break; }
    if (d.status === 'error') {
      const bad = (d.tasks || []).find((t) => t.status === 'error');
      throw new Error('provider-no-pdf::' + ((bad && bad.message) || 'cloudconvert-job-error'));
    }
  }
  if (!done) throw new Error('provider-failed:504:cloudconvert-timeout');

  // 4) Download the resulting PDF.
  const exp = (done.tasks || []).find((t) => t.name === 'export' && t.status === 'finished');
  const file = exp && exp.result && exp.result.files && exp.result.files[0];
  if (!file || !file.url) throw new Error('provider-no-pdf::cloudconvert-no-export');
  const pdfRes = await fetch(file.url);
  if (!pdfRes.ok) throw new Error('provider-failed:' + pdfRes.status + ':cloudconvert-download');
  return Buffer.from(await pdfRes.arrayBuffer());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  // Provider chain, tried in order until one returns a PDF:
  //   1) CloudConvert (primary) — .pptx/.ppt/.key/.odp, always on, nothing to run.
  //   2) Any legacy generic provider(s) still configured (Mac tunnel / Docker).
  const genericProviders = [
    CONVERT_API_URL      ? { url: CONVERT_API_URL,      key: CONVERT_API_KEY }      : null,
    CONVERT_FALLBACK_URL ? { url: CONVERT_FALLBACK_URL, key: CONVERT_FALLBACK_KEY } : null,
  ].filter(Boolean);
  const haveCloudConvert = !!CLOUDCONVERT_API_KEY;

  // Nothing configured → tell the client to use the export-to-PDF path. 200 so it's
  // handled as a normal "fall back" branch, not a fetch error.
  if (!haveCloudConvert && !genericProviders.length) {
    return res.status(200).json({
      ok: false, needsProvider: true, code: 'no-provider',
      message: 'Deck conversion is not configured. Export your deck to PDF and import that.'
    });
  }

  try {
    const filename = decodeURIComponent(String(req.headers['x-filename'] || 'deck')).slice(0, 200);
    const raw = await getRawBody(req);
    if (!raw || !raw.length) return res.status(400).json({ ok: false, code: 'empty', error: 'Empty upload.' });
    if (raw.length > MAX_BYTES) return res.status(413).json({ ok: false, code: 'too-large', error: 'File too large.' });

    let lastErr = null;

    // 1) CloudConvert — primary.
    if (haveCloudConvert) {
      try {
        const pdf = await tryCloudConvert(raw, filename);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(pdf);
      } catch (e) { lastErr = e; } // CloudConvert failed → try legacy providers
    }

    // 2) Legacy generic providers (only if still configured).
    for (const p of genericProviders) {
      try {
        const pdf = await tryProvider(p.url, p.key, raw, filename);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(pdf);
      } catch (e) { lastErr = e; } // failed → next provider
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
