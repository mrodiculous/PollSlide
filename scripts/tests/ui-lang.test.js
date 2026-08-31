/* Tests for the presenter + big-screen interface language (ui-lang.js).
 *
 * The failure this exists to catch is silent: someone adds a `data-i18n` button and
 * forgets the dictionary entry. Nothing errors — the string simply stays English while
 * everything around it is in German, and nobody notices unless they happen to switch
 * language and look at that exact control.
 *
 * So this checks the two directions that matter:
 *   • every string TAGGED in the markup has a translation in all five languages
 *   • the five dictionaries have identical key sets (no half-added string)
 *
 * Plus the rules that would be embarrassing to break: brand names survive, emoji
 * survive, and nothing that is a URL or an example gets translated.
 *
 * Run: node scripts/tests/ui-lang.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

// Load the dictionary the way a browser would.
const win = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'ui-lang.js'), 'utf8'))(win);
const D = win.PS_UI;
const LANGS = ['es', 'de', 'fr', 'pt', 'it'];

console.log('\nThe dictionary is complete and consistent');
ok('all five languages are present', LANGS.every(l => D[l] && typeof D[l] === 'object'), Object.keys(D || {}));
const ref = Object.keys(D.es).sort();
ok('every language has the same keys — no half-added string',
   LANGS.every(l => JSON.stringify(Object.keys(D[l]).sort()) === JSON.stringify(ref)),
   LANGS.map(l => l + ':' + Object.keys(D[l]).length));
ok('there are a meaningful number of them', ref.length > 150, ref.length);
ok('no entry is empty', LANGS.every(l => Object.values(D[l]).every(v => v && v.trim().length)));
/* Some strings are the same in every language and that is correct — a brand name and a
 * file format. Everything ELSE being identical across all five would mean somebody
 * pasted English into the dictionary. */
const SAME_EVERYWHERE = new Set(['✨ Polly', '⬇ CSV']);
const untranslated = ref.filter(k => !SAME_EVERYWHERE.has(k) && LANGS.every(l => D[l][k] === k));
ok('nothing is English in all five languages (except a brand name and a file format)',
   untranslated.length === 0, untranslated);

/* Pull every string the markup actually asks to be translated. If it is tagged and
 * missing, a user switching language sees one English word in a German sentence. */
function taggedStrings(file) {
  const t = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const body = t.slice(t.indexOf('<body'));
  const el = [...body.matchAll(/data-i18n(?:-title|-ph)?>([^<]+)</g)].map(m => m[1]);
  const ti = [...body.matchAll(/title="([^"]+)"\s+data-i18n-title/g)].map(m => m[1]);
  const ph = [...body.matchAll(/placeholder="([^"]+)"\s+data-i18n-ph/g)].map(m => m[1]);
  const dec = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  /* Drop fragments of JavaScript. `'<span data-i18n>' + m.label + '</span>'` is a
   * perfectly good tag at runtime, but reading the SOURCE captures the concatenation
   * itself. Those labels are checked separately — they come from JS arrays, not markup. */
  const isSource = s => /\+|\$\{|^'|'$/.test(s);
  return [...new Set([...el, ...ti, ...ph].map(dec))].filter(s => s && !isSource(s));
}

/* Deliberately untranslated: the product name, and literal examples a user is meant to
 * copy. Translating an example URL or address would make it wrong, not localised. */
const NEVER = new Set([
  'PollSlide',
  'alice@example.com, bob@example.com',
  'https://app.pollslide.com/answer?session=YOUR_CODE',
]);

for (const file of ['presenter.html', 'live.html']) {
  console.log(`\nEvery tagged string in ${file} has a translation`);
  const tagged = taggedStrings(file);
  ok('the file has tagged strings', tagged.length > 0, tagged.length);
  const missing = tagged.filter(s => !NEVER.has(s) && !(s in D.es));
  ok(`all ${tagged.length} are translated (or deliberately exempt)`,
     missing.length === 0, missing);
  const partial = tagged.filter(s => (s in D.es) && LANGS.some(l => !(s in D[l])));
  ok('none is translated into only some languages', partial.length === 0, partial);
}

console.log('\nThings that must survive translation');
const brandBad = [], emojiBad = [], urlBad = [];
LANGS.forEach(l => Object.entries(D[l]).forEach(([k, v]) => {
  if (/PollSlide/.test(k) && !/PollSlide/.test(v)) brandBad.push(l + ': ' + k);
  if (/Polly/.test(k) && !/Polly/.test(v)) brandBad.push(l + ': ' + k);
  // The leading glyph is how people find a control before they read it.
  const glyph = k.match(/^([\u{1F300}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}]+)/u);
  if (glyph && !v.startsWith(glyph[1].trim().slice(0, 2))) emojiBad.push(l + ': ' + k + ' → ' + v);
  if (/https?:\/\//.test(k) && k !== v) urlBad.push(l + ': ' + k);
}));
ok('brand names are never translated', brandBad.length === 0, brandBad.slice(0, 4));
ok('a leading emoji stays at the front', emojiBad.length === 0, emojiBad.slice(0, 4));
ok('no URL is translated', urlBad.length === 0, urlBad.slice(0, 4));
ok('the exempt strings really are absent from the dictionary',
   [...NEVER].every(s => !(s in D.es)), [...NEVER].filter(s => s in D.es));

console.log('\nBoth screens share one dictionary');
const p = taggedStrings('presenter.html'), l = taggedStrings('live.html');
ok('both screens draw from the same dictionary file, so a string is translated once',
   ['presenter.html', 'live.html'].every(f =>
     fs.readFileSync(path.join(ROOT, f), 'utf8').includes('/ui-lang.js')));
ok('and neither declares its own competing dictionary',
   ['presenter.html', 'live.html'].every(f =>
     !/const\s+PS_UI\s*=/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
