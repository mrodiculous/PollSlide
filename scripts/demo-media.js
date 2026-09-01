#!/usr/bin/env node
/* PollSlide — dev-only. Fetches the media for a marketing demo deck.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * Marketing shots of the app were coming out mundane because the demo deck was a
 * plain text quiz: no question media, no GIF on any option. Hand-picking Giphy IDs
 * instead produced the opposite problem — a "seedling unfurling" caption next to a
 * man at a chalkboard, which misrepresents the one feature the picture is selling.
 *
 * So this searches for real GIFs, through THE SAME selection code the product runs
 * (PSGifs.normalizeGiphy + PSGifs.pickBest). What ends up in the screenshot is a
 * genuine result for a genuine search term — the same thing a teacher would get.
 *
 * THE KEY is read from ~/.pollslide-giphy-key (or $GIPHY_API_KEY) and is never
 * printed, never written to the output, and never committed. The last key that got
 * pasted into a file had to be rotated; this one stays out of the repo.
 *
 *   node scripts/demo-media.js                → writes demo-media.json beside itself
 *   node scripts/demo-media.js --out <path>   → writes somewhere else
 * --------------------------------------------------------------------------- */
const fs = require('fs');
const os = require('os');
const path = require('path');
const PSGifs = require(path.resolve(__dirname, '..', 'gifs.js'));

const KEY_FILE = path.join(os.homedir(), '.pollslide-giphy-key');

function readKey() {
  if (process.env.GIPHY_API_KEY) return process.env.GIPHY_API_KEY.trim();
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) { return ''; }
}

/* The demo deck. Chosen so the four options look OBVIOUSLY different from each other —
 * four cities read at a glance from the back of a room, where four phrasings of a
 * biology definition do not. The hero is the thing being asked about; each option gets
 * its own GIF so no single card is decorated. */
const DECK = {
  question: 'Which city is this?',
  hero: 'Eiffel Tower Paris',
  options: [
    { text: 'Paris',    term: 'Paris France' },
    { text: 'Rome',     term: 'Rome Italy' },
    { text: 'London',   term: 'London England' },
    { text: 'New York', term: 'New York City' },
  ],
  correct: 0,
};

async function search(key, term, seed) {
  const u = new URL('https://api.giphy.com/v1/gifs/search');
  u.searchParams.set('api_key', key);
  u.searchParams.set('q', term);
  u.searchParams.set('limit', '12');
  u.searchParams.set('rating', 'g');          // server-side literal, same as the endpoint
  u.searchParams.set('lang', 'en');
  const r = await fetch(u);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (d && d.meta && d.meta.msg) || ('HTTP ' + r.status);
    throw new Error(`Giphy said ${msg} for "${term}"`);
  }
  const recs = PSGifs.normalizeMany(d.data || [], 'giphy');
  const best = PSGifs.pickBest(recs, { seed });
  if (best) best.term = term;
  return best;
}

(async () => {
  const key = readKey();
  if (!key) {
    console.error(`\nNo Giphy key found.\n\n  printf '%s' 'YOUR_KEY' > ${KEY_FILE} && chmod 600 ${KEY_FILE}\n\n` +
                  `…or set GIPHY_API_KEY in the environment. The key is only read, never written out.\n`);
    process.exit(1);
  }

  const out = { question: DECK.question, correct: DECK.correct, options: [], hero: null };
  try {
    console.log(`\nFetching demo media  (key loaded, ${key.length} chars — not shown)\n` + '─'.repeat(58));
    out.hero = await search(key, DECK.hero, 'hero');
    console.log(`  hero    "${DECK.hero}"`.padEnd(38) + (out.hero ? '✓ ' + (out.hero.alt || '').slice(0, 40) : '— nothing usable'));

    for (let i = 0; i < DECK.options.length; i++) {
      const o = DECK.options[i];
      const g = await search(key, o.term, 'opt' + i);
      out.options.push({ text: o.text, gif: g });
      console.log(`  ${'ABCD'[i]}       "${o.term}"`.padEnd(38) + (g ? '✓ ' + (g.alt || '').slice(0, 40) : '— nothing usable'));
    }
  } catch (e) {
    console.error('\n' + String(e.message || e) + '\n');
    process.exit(1);
  }

  const distinct = new Set(out.options.filter(o => o.gif).map(o => o.gif.id)).size;
  console.log('─'.repeat(58));
  console.log(`  ${distinct} of ${out.options.length} options got a DISTINCT GIF` +
              (distinct === out.options.length ? '' : '  ← repeats would look like a bug'));

  const outPath = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]
    : path.join(__dirname, 'demo-media.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}\n`);
})();
