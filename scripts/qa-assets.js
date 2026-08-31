#!/usr/bin/env node
/* PollSlide QA — the ?v= on every shared script matches the file's contents.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * Three times in one working session, a change to a shared .js file did nothing in the
 * browser because the page still asked for `?v=1` and the browser served what it had
 * cached. The file on disk was right; the file being run was not. Each time it looked
 * like a logic bug, and each time the fix was a number nobody remembered to change.
 *
 * This is not a testing quirk. Returning visitors hit exactly the same cache, so a
 * forgotten bump ships a fix that reaches only people who have never visited before.
 *
 * THE FIX: the version IS the content. `?v=` carries a short hash of the file, so
 * changing the file changes the URL and forgetting is impossible.
 *
 *   node scripts/qa-assets.js          check, and fail if any are stale
 *   node scripts/qa-assets.js --write  rewrite every reference to match
 * --------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const WRITE = process.argv.includes('--write');

// Pages that load shared scripts, and the scripts they may load.
const PAGES = ['presenter.html', 'answer.html', 'present.html', 'live.html', 'report.html',
               'admin.html', 'recap.html', 'results.html', 'overlay.html', 'companion.html',
               'powerpoint.html'];

const hashOf = (file) => {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, file))).digest('hex').slice(0, 8);
  } catch (e) { return null; }
};

let stale = 0, checked = 0, missing = 0, rewritten = 0;
console.log('\nCache-busting versions match file contents\n' + '─'.repeat(60));

for (const page of PAGES) {
  const p = path.join(ROOT, page);
  let html;
  try { html = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }

  const problems = [];
  // Only LOCAL scripts — a CDN URL is versioned by whoever publishes it.
  const updated = html.replace(/(<script[^>]*\bsrc=")(\/[A-Za-z0-9._-]+\.js)(\?v=([^"]*))?(")/g,
    (whole, pre, file, _q, ver, post) => {
      const want = hashOf(file.replace(/^\//, ''));
      if (!want) { missing++; problems.push(`${file} — referenced but not found on disk`); return whole; }
      checked++;
      if (ver === want) return whole;
      stale++;
      problems.push(`${file} — page says ?v=${ver || '(none)'}, contents hash to ${want}`);
      return `${pre}${file}?v=${want}${post}`;
    });

  if (WRITE && updated !== html) { fs.writeFileSync(p, updated); rewritten++; }
  if (problems.length) {
    console.log(`  ${WRITE ? '↻' : '✗'} ${page}`);
    problems.forEach(x => console.log('      ' + x));
  }
}

if (!stale && !missing) console.log(`  ✓ ${checked} script references, all versioned by content`);
console.log('─'.repeat(60));

if (WRITE) {
  console.log(`\nRewrote ${rewritten} page(s). Every ?v= now matches its file.\n`);
  process.exit(0);
}
if (stale || missing) {
  console.log('\nA stale ?v= means the browser keeps serving the OLD file — to you AND to\n' +
              'every returning visitor. The change is on disk and not in anyone\'s browser.\n' +
              'Fix them all with:  node scripts/qa-assets.js --write\n');
  process.exit(1);
}
console.log('\nEvery shared script is versioned by its contents.\n');
process.exit(0);
