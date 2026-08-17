#!/usr/bin/env node
/*
 * PollSlide — syntax gate for inline <script> blocks.
 *
 * The app pages carry their JS inline, so a syntax error there is invisible to
 * `node --check` (which only sees .js files) and takes the whole page down at runtime.
 * This parses every inline block with the real JS parser.
 *
 * Run before every push, together with scripts/qa-reachability.js:
 *   node scripts/qa-syntax.js && node scripts/qa-reachability.js
 *
 * Exits non-zero on a parse failure so it can gate a commit.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FILES = [
  'presenter.html', 'answer.html', 'live.html', 'report.html', 'recap.html',
  'admin.html', 'present.html', 'companion.html', 'results.html', 'overlay.html',
  'powerpoint.html', 'setup.html',
];
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;

let failed = 0;
for (const f of files) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) { console.log(`${f}: (missing — skipped)`); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, i = 0, bad = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;                       // external file
    if (/type\s*=\s*["'](?!text\/javascript|module|application\/javascript)/i.test(attrs)) continue; // JSON-LD etc.
    i++;
    try { new vm.Script(m[2], { filename: `${f}#script${i}` }); }
    catch (e) { bad++; failed++; console.log(`FAIL ${f} block#${i}: ${e.message}`); }
  }
  console.log(`${f}: ${i} inline block(s), ${bad} failed`);
}

// The api/ and lib/ files are plain modules — parse those too.
for (const dir of ['api', 'lib']) {
  const d = path.join(ROOT, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter(x => x.endsWith('.js'))) {
    try { new vm.Script(fs.readFileSync(path.join(d, f), 'utf8'), { filename: `${dir}/${f}` }); }
    catch (e) { failed++; console.log(`FAIL ${dir}/${f}: ${e.message}`); }
  }
  console.log(`${dir}/: all .js parsed`);
}

console.log(failed ? `\n${failed} syntax failure(s)` : '\nAll clean');
process.exit(failed ? 1 : 0);
