#!/usr/bin/env node
/* PollSlide — dev-only screenshot receiver.
 * ---------------------------------------------------------------------------
 * A browser cannot write a file to the repo, and the screenshot tooling hands the
 * image back as pixels rather than as a file. So: the page captures itself with
 * html2canvas, POSTs the data URL here, and this writes the PNG into the website
 * repo's marketing assets folder.
 *
 * THIS IS A DEVELOPMENT TOOL. It is never deployed, never referenced by any page, and
 * binds to localhost only. It still refuses anything it does not need to accept —
 * a local server that writes files wherever it is told is a bad habit even when the
 * only client is a script you wrote five minutes ago:
 *   • filenames are [a-z0-9-] plus .png, so nothing can climb out of the directory
 *   • the payload must be a PNG data URL
 *   • there is a size ceiling
 *   • the output directory is fixed, not supplied by the caller
 *
 * Run:  node scripts/shot-server.js        (then POST to http://127.0.0.1:8791/save)
 * --------------------------------------------------------------------------- */
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT_DIR = '/Users/Rod/Documents/GitHub/pollslide-website/marketing';
const PORT = 8791;
const MAX_BYTES = 12 * 1024 * 1024;

try { fs.mkdirSync(OUT_DIR, { recursive: true }); } catch (e) {}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method !== 'POST' || req.url !== '/save') return res.writeHead(404).end('nope');

  let body = '', tooBig = false;
  req.on('data', (c) => {
    body += c;
    if (body.length > MAX_BYTES) { tooBig = true; req.destroy(); }
  });
  req.on('end', () => {
    if (tooBig) return res.writeHead(413).end('too large');
    let payload;
    try { payload = JSON.parse(body); } catch (e) { return res.writeHead(400).end('bad json'); }

    const name = String(payload.name || '');
    if (!/^[a-z0-9][a-z0-9-]{0,60}\.png$/.test(name)) {
      return res.writeHead(400).end('bad filename — [a-z0-9-] and .png only');
    }
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(payload.dataUrl || ''));
    if (!m) return res.writeHead(400).end('expected a png data url');

    const buf = Buffer.from(m[1], 'base64');
    const file = path.join(OUT_DIR, name);
    // Belt and braces: resolve and confirm it really is inside OUT_DIR.
    if (path.dirname(path.resolve(file)) !== path.resolve(OUT_DIR)) {
      return res.writeHead(400).end('path escape');
    }
    try {
      fs.writeFileSync(file, buf);
      console.log(`  saved ${name}  (${(buf.length / 1024).toFixed(0)} KB)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name, bytes: buf.length }));
    } catch (e) {
      res.writeHead(500).end(String(e.message || e));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`shot-server listening on http://127.0.0.1:${PORT}/save`);
  console.log(`writing into ${OUT_DIR}`);
});
