#!/usr/bin/env node
/* Admin → SEO: a failed check explains itself in plain words (2026-10-07). It used to show the
 * raw "TypeError: Cannot read properties of undefined" when the reply was not a full report.
 * Runs the REAL runSEOScan from admin.html against stand-in replies.
 * Run: node scripts/tests/seo-errors.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const A = fs.readFileSync(path.join(__dirname, '..', '..', 'admin.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')));
const grab = (sig) => { const i = A.indexOf(sig); let d = 0, j = A.indexOf('{', i); for (; j < A.length; j++) { if (A[j] === '{') d++; else if (A[j] === '}' && !--d) break; } return A.slice(i, j + 1); };
const src = [grab('function seoErrorMessage('), grab('async function runSEOScan('), A.match(/const SEO_SEV = \{[^\n]*\};/)[0], grab('function esc(')].join('\n');

async function scan(reply) {
  const els = { seoBody: { innerHTML: '' }, seoBadge: { style: {} }, seoPages: { innerHTML: '' }, seoChecklist: { innerHTML: '' } };
  const ctx = { console: { error() {} }, document: { getElementById: id => els[id] || null }, auth: { currentUser: { getIdToken: async () => 't' } },
    fetch: async () => { if (reply === 'offline') throw new TypeError('Failed to fetch'); return reply; } };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  await ctx.runSEOScan();
  return els;
}
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const html = (status) => ({ ok: status < 400, status, json: async () => { throw new SyntaxError('Unexpected token <'); } });
const noRaw = t => !/TypeError|SyntaxError|undefined|Unexpected token/.test(t);

(async () => {
  console.log('\nAdmin → SEO: failures in plain words, never a raw error');
  let e = await scan(html(524));
  ok('Cloudflare timeout page (HTML, 524) → "took too long … try again"', /took too long/.test(e.seoBody.innerHTML) && noRaw(e.seoBody.innerHTML), e.seoBody.innerHTML);
  e = await scan(html(200));
  ok('a 200 that is not JSON → "not a report", no raw error', /not a report/.test(e.seoBody.innerHTML) && noRaw(e.seoBody.innerHTML), e.seoBody.innerHTML);
  e = await scan(json(401, { error: 'Not allowed' }));
  ok('lapsed sign-in → "sign in as help@pollslide.com"', /sign in as help@pollslide\.com/.test(e.seoBody.innerHTML));
  e = await scan(json(404, {}));
  ok('not deployed → says so', /not deployed/.test(e.seoBody.innerHTML));
  e = await scan(json(500, { error: 'Firebase admin not configured' }));
  ok('server error → plain sentence with the server\'s reason', /server hit an error/.test(e.seoBody.innerHTML) && /Firebase admin not configured/.test(e.seoBody.innerHTML));
  e = await scan('offline');
  ok('no connection → "check your internet"', /check your internet/.test(e.seoBody.innerHTML) && noRaw(e.seoBody.innerHTML));
  e = await scan(json(200, { origin: 'https://pollslide.com' }));
  ok('a reply with no summary → "came back incomplete" (this was the TypeError)', /incomplete/.test(e.seoBody.innerHTML) && noRaw(e.seoBody.innerHTML), e.seoBody.innerHTML);
  ok('every failure offers "Try again"', /Try again/.test(e.seoBody.innerHTML));
  e = await scan(json(200, { origin: 'https://pollslide.com', summary: { pages: 3, errors: 0, warnings: 1, notes: 0, issues: [{ severity: 'weird', msg: 'Odd thing', path: '/x' }] } }));
  ok('partial report (no pages/checklist/sitemap) and an unknown severity still render', /Odd thing/.test(e.seoBody.innerHTML) && noRaw(e.seoBody.innerHTML), e.seoBody.innerHTML.slice(0, 300));
  e = await scan(json(200, { origin: 'https://pollslide.com', summary: { pages: 2, errors: 0, warnings: 0, notes: 0, issues: [] }, sitemap: { count: 2 }, robots: { exists: true }, pages: [], checklist: [] }));
  ok('a normal clean report is unchanged', /Nothing to fix/.test(e.seoBody.innerHTML) && /sitemap lists 2 URLs/.test(e.seoBody.innerHTML));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
