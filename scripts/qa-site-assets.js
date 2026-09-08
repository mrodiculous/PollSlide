#!/usr/bin/env node
/* PollSlide QA — the marketing site's ?v= matches its files.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * 305 new translations were written, merged, and verified present on disk — and then
 * the browser served 1253 keys instead of 1270, because every page loads
 * `translations.js?v=15` and nobody bumped the 15. On a returning visitor's browser
 * that is not a stale test environment, it is the shipped behaviour: they keep the
 * cached dictionary and never receive a single new translation. The work looks done
 * everywhere except the only place that counts.
 *
 * The app repo has solved this once already (scripts/qa-assets.js). The website repo
 * had nothing, so the same bug was free to happen again — and did.
 *
 * THE FIX IS THE SAME: the version IS the content. `?v=` carries a short hash of the
 * file, so changing the file changes every URL that references it, and forgetting
 * becomes impossible rather than merely unlikely.
 *
 *   node scripts/qa-site-assets.js          check, fail if any are stale
 *   node scripts/qa-site-assets.js --write  rewrite every reference to match
 * --------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SITE = path.resolve(__dirname, '..', '..', 'pollslide-website');
const WRITE = process.argv.includes('--write');

if (!fs.existsSync(SITE)) {
  console.log('\n  – website repo not reachable from here; skipping.\n');
  process.exit(0);
}

const hashOf = (file) => {
  try {
    return crypto.createHash('sha1')
      .update(fs.readFileSync(path.join(SITE, file))).digest('hex').slice(0, 8);
  } catch (e) { return null; }
};

let stale = 0, checked = 0, missing = 0, rewritten = 0;
const problems = [];

console.log('\nSite asset versions match their files\n' + '─'.repeat(62));

for (const page of fs.readdirSync(SITE).filter(f => f.endsWith('.html')).sort()) {
  const p = path.join(SITE, page);
  let html;
  try { html = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }

  const found = [];
  // Local scripts and stylesheets only — a CDN URL is versioned by whoever ships it.
  const updated = html.replace(
    /(<(?:script|link)[^>]*(?:src|href)=")(\/[A-Za-z0-9._-]+\.(?:js|css))(\?v=([^"]*))?(")/g,
    (whole, pre, file, _q, ver, post) => {
      const want = hashOf(file.replace(/^\//, ''));
      if (!want) { missing++; found.push(`${file} — referenced but not in the repo`); return whole; }
      checked++;
      if (ver === want) return whole;
      stale++;
      found.push(`${file} — page says ?v=${ver || '(none)'}, file hashes to ${want}`);
      return `${pre}${file}?v=${want}${post}`;
    });

  if (WRITE && updated !== html) { fs.writeFileSync(p, updated); rewritten++; }
  if (found.length) {
    console.log(`  ${WRITE ? '↻' : '✗'} ${page}`);
    found.forEach(x => console.log('      ' + x));
  }
}

if (!stale && !missing) console.log(`  ✓ ${checked} asset references, all versioned by content`);
console.log('─'.repeat(62));

if (WRITE) {
  console.log(`\nRewrote ${rewritten} page(s). Every ?v= now matches its file.\n`);
  process.exit(0);
}
if (stale || missing) {
  console.log(`\n${stale} stale reference(s).\n\n` +
    'A stale ?v= means returning visitors keep the OLD file. New translations, new copy\n' +
    'and new behaviour reach nobody who has been to the site before — and it looks fine\n' +
    'to you, because your browser fetched it fresh.\n\n' +
    'Fix them all with:  node scripts/qa-site-assets.js --write\n');
  process.exit(1);
}
console.log('\nEvery site asset is versioned by its contents.\n');
process.exit(0);
