#!/usr/bin/env node
/* PollSlide QA — new copy does not silently ship English-only.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * Every language dictionary in this project has been built by someone adding strings
 * and someone else discovering, later, that a page never translated. Three separate
 * instances, all found by hand:
 *
 *   • The presenter's game modes had NEVER been translated — Survival, Wager and every
 *     blurb sat in English while the dialog around them changed language.
 *   • Every control rendered from a JS template literal was untagged, so ▶ Present,
 *     📊 Tally and the whole present-mode toolbar ignored the language picker.
 *   • Three comparison pages — the ones paid search lands on — were 0% translated.
 *
 * None of these were decisions. They were omissions that nothing was watching for, and
 * they are invisible in English, which is the language everyone develops in.
 *
 * WHAT IT ENFORCES
 *   1. PARITY — every language carries every key. A missing key silently falls back to
 *      English, which looks like a translation bug rather than a missing entry.
 *   2. NO REGRESSION — page coverage is recorded in scripts/i18n-baseline.json. Adding
 *      English copy without translating it lowers a page's coverage and fails here.
 *      Improving coverage updates the baseline with --update.
 *
 * WHAT IT DELIBERATELY DOES NOT ENFORCE
 *   100% coverage. Legal pages stay English on purpose — the English version governs,
 *   and a machine-translated indemnity clause creates liability rather than removing it.
 *
 *   node scripts/qa-i18n.js            check
 *   node scripts/qa-i18n.js --update   record current coverage as the new floor
 * --------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.resolve(ROOT, '..', 'pollslide-website');
const BASELINE = path.join(__dirname, 'i18n-baseline.json');
const UPDATE = process.argv.includes('--update');

/* English governs these, by decision. Not a coverage failure. */
const LEGAL = new Set(['terms.html', 'privacy.html', 'dpa.html', 'cookies.html',
                       'subprocessors.html', 'vpat.html']);

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
let fail = 0;
const problems = [];
const bad = (msg, detail) => { fail++; problems.push(detail ? `${msg}\n      ${detail}` : msg); };

console.log('\nNothing ships English-only by accident\n' + '─'.repeat(64));

// ── 1. Parity: every language carries every key ───────────────────────────────
function parity(label, dict) {
  const langs = Object.keys(dict || {});
  if (!langs.length) { console.log(`  – ${label}: not loaded, skipped`); return; }
  const union = new Set();
  langs.forEach(l => Object.keys(dict[l]).forEach(k => union.add(k)));
  let gaps = 0;
  for (const l of langs) {
    const missing = [...union].filter(k => dict[l][k] === undefined);
    if (missing.length) {
      gaps += missing.length;
      bad(`${label}: ${l} is missing ${missing.length} key(s) other languages have`,
          missing.slice(0, 3).map(k => '· ' + k.slice(0, 56)).join('\n      '));
    }
  }
  if (!gaps) console.log(`  ✓ ${label}: ${langs.length} languages, ${union.size} keys, no gaps`);
}

const g = {};
global.window = g;
try { require(path.join(ROOT, 'ui-lang.js')); } catch (e) {}
parity('presenter (ui-lang.js)', g.PS_UI);

/* EVERY dictionary in the site repo, discovered rather than listed. Three were hard-coded
   here; there are eight. Portuguese was converted to European, all three gates went green,
   and the browser still showed Brazilian text on help.html — because that page reads four
   dictionaries and this check knew about three of them. Globbing means a new dictionary
   file is covered the day it lands, instead of the day someone notices. */
const gw = {};
global.window = gw;
/* Discovered by LOADING, not by filename. A name pattern missed
   help-translations-teachers.js (it does not end in "translations.js") and swept in
   legal-i18n.js, which is the applier script rather than a dictionary. What makes a file a
   dictionary is that requiring it produces a language map — so that is the test. */
/* Load order matters and is not alphabetical. translations.js opens with a hard
   `window.PS_I18N = {…}`; every other dictionary opens with `window.PS_I18N =
   window.PS_I18N || {}` and merges. The page loads the base first, so this has to as well —
   loading alphabetically put translations.js last, where its assignment wiped the other
   seven and dropped measured coverage from 100% to 89% with nothing actually broken. */
const isBase = (f) => {
  try { return /window\.PS_\w+\s*=\s*\{/.test(fs.readFileSync(path.join(SITE, f), 'utf8').slice(0, 4000)); }
  catch (e) { return false; }
};
const DICTS = [];
if (fs.existsSync(SITE)) {
  const js = fs.readdirSync(SITE).filter(x => x.endsWith('.js')).sort();
  for (const f of [...js.filter(isBase), ...js.filter(f => !isBase(f))]) {
    const before = ['PS_I18N', 'PS_I18N_KEYS', 'PS_LEGAL'].map(n => Object.keys(gw[n] || {}).length);
    try { require(path.join(SITE, f)); } catch (e) { continue; }
    const after = ['PS_I18N', 'PS_I18N_KEYS', 'PS_LEGAL'].map(n => Object.keys(gw[n] || {}).length);
    if (after.some((n, i) => n > before[i]) ||
        ['PS_I18N', 'PS_I18N_KEYS', 'PS_LEGAL'].some(n => gw[n] && gw[n].es && Object.keys(gw[n].es).length)) {
      if (/translation|i18n|blocks/.test(f) && f !== 'i18n.js') DICTS.push(f);
    }
  }
}
console.log(`  · ${DICTS.length} dictionary files loaded: ${DICTS.join(', ')}`);
parity('site (translations.js)', gw.PS_I18N);
parity('site curated blocks', gw.PS_I18N_KEYS);
parity('site legal bodies', gw.PS_LEGAL);

/* One variant per language. A dictionary that is half Brazilian and half European reads as
   broken to both audiences, and nothing above can see it: every key is present and every
   key is translated. es/de/fr/it have no comparable split; pt does, and it was ~50/50. */
const VARIANT = {
  pt: { name: 'Portuguese', keep: 'European',
        wrong: /(^|[^A-Za-zÀ-ÖØ-öø-ÿ])(você|vocês|telas?|arquivos?|compartilh[a-zç]+|aplicativos?|enquetes?|usuários?|equipes?|gerenci[a-z]+|celulares?|conosco|cadastro)($|[^A-Za-zÀ-ÖØ-öø-ÿ])/i },
  /* Form of address. Both of these were chosen deliberately and both drifted back the first
     time, because the conversion was run against the dictionaries that happened to be loaded
     rather than all of them — so German still said "Präsentieren Sie es auf Ihre Weise" on
     the homepage after the German pass was called finished.
     German has exactly ONE shape that cannot be anything else: verb-first inversion with a
     capitalised Sie — "Präsentieren Sie", "Klicken Sie", "Wählen Sie". Everything else is
     ambiguous, because "Sie können" is equally "you can" (formal) and "they can", and
     "Ihre Version" is equally "your" and "their". Matching those flagged four sentences that
     are correct German about a THIRD PARTY, and a gate that cries wolf gets ignored. */
  de: { name: 'German', keep: 'informal du', skipLegal: true,
        wrong: /\b[A-ZÄÖÜ][a-zäöüß]+en\s+Sie\b/ },
  fr: { name: 'French', keep: 'tu', skipLegal: true,
        wrong: /(^|[^A-Za-zÀ-ÖØ-öø-ÿ])(vous|votre|vos)($|[^A-Za-zÀ-ÖØ-öø-ÿ])/i },
};
for (const [lang, rule] of Object.entries(VARIANT)) {
  const hits = [];
  /* Legal bodies are excluded for German and French on purpose: a contract keeps the formal
     address even in a product that says du and tu everywhere else. Portuguese has no such
     exemption — European vs Brazilian is one variant throughout, contracts included. */
  const dicts = rule.skipLegal ? [gw.PS_I18N, gw.PS_I18N_KEYS, g.PS_UI]
                               : [gw.PS_I18N, gw.PS_I18N_KEYS, gw.PS_LEGAL, g.PS_UI];
  for (const dict of dicts) {
    if (!dict || !dict[lang]) continue;
    for (const v of Object.values(dict[lang])) if (typeof v === 'string' && rule.wrong.test(v)) hits.push(v);
  }
  /* i18n.js carries a TENTH dictionary inline — a `nav.*`/`hero.*`/`price.*` block that is a
     local const, never attached to window, so requiring the file exposes nothing. It is real
     copy on the homepage all the same, and it is where the last Brazilian string was hiding
     after eight dictionaries came back clean. Scanned as source text, since it cannot be
     loaded: read only that language's block, so the other four don't produce false hits. */
  const inline = read(path.join(SITE, 'i18n.js')) || '';
  const a = inline.indexOf(`\n    ${lang}: {`);
  if (a > -1) {
    const block = inline.slice(a, inline.indexOf('\n    },', a));
    for (const m of block.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
      if (/^[a-z]+\.[a-z0-9]+$/i.test(m[1])) continue;          // that one is a key
      if (rule.wrong.test(m[1])) hits.push(m[1]);
    }
  }
  if (hits.length) {
    bad(`${rule.name} mixes variants — ${hits.length} string(s) are not ${rule.keep}`,
        hits.slice(0, 2).map(v => '· ' + v.slice(0, 66)).join('\n      '));
  } else {
    console.log(`  ✓ ${rule.name}: one variant throughout (${rule.keep})`);
  }
}

// ── 1b. Glossary: a product noun keeps its meaning ────────────────────────────
/* Parity and coverage both pass when a word is translated into the WRONG THING, because
 * both only ask whether an entry exists. Four of the five languages rendered "deck" as a
 * pack of playing cards — es baraja, fr jeu, pt baralho, it mazzo — so the app's search
 * box invited a Spanish teacher to "search packs of playing cards and questions". It was
 * in both dictionaries, in the shipped app, and every gate was green.
 *
 * So: for each product noun, the words that would be a different object. Listed per
 * language because a word can be innocent elsewhere — fr "jeu" is correct in "jeu
 * télévisé" (game show) and "jeux de révision" (revision sets), which is why the check
 * looks only at strings whose ENGLISH KEY contains the term, and allows stated exceptions. */
const GLOSSARY = [
  { term: /\bdecks?\b/i, what: 'deck (a slide deck, not a pack of cards)',
    wrong: { es: /\bbarajas?\b/i, fr: /\bjeux?\b/i, pt: /\bbaralhos?\b/i, it: /\bmazz[oi]\b/i },
    allow: /jeux?\s+(télévisés?|de\s+(révision|culture))/i },
];

function glossary(label, dict) {
  if (!dict || !Object.keys(dict).length) return;
  let bad = 0;
  for (const rule of GLOSSARY) {
    for (const lang of Object.keys(rule.wrong)) {
      if (!dict[lang]) continue;
      const hits = Object.entries(dict[lang]).filter(([k, v]) =>
        typeof v === 'string' && rule.term.test(k) &&
        rule.wrong[lang].test(rule.allow ? v.replace(new RegExp(rule.allow.source, 'gi'), '') : v));
      if (hits.length) {
        bad += hits.length;
        bad_glossary(`${label}: ${lang} translates ${rule.what} into a different object`,
          hits.slice(0, 2).map(([k, v]) => `· ${v.slice(0, 70)}`).join('\n      '));
      }
    }
  }
  if (!bad) console.log(`  ✓ ${label}: product nouns still mean what they mean`);
}
const bad_glossary = (m, d) => bad(m, d);
glossary('presenter (ui-lang.js)', g.PS_UI);
glossary('site (translations.js)', gw.PS_I18N);

// ── 2. Coverage per page, against a recorded floor ────────────────────────────
const dict = (gw.PS_I18N && gw.PS_I18N.es) || {};
const dec = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
                    .replace(/&quot;/g, '"').trim();
/* Scripts and styles are code, not copy — translating a JS template literal corrupts
   the page. Curated data-i18n-html blocks carry their own dictionary.
   data-i18n-skip is the third case, added 2026-09-15: the runtime walker
   (isCuratedOrSkipped in i18n.js) treats it as "leave this text exactly as written" — the
   Mac Companion's own on-screen labels ("Connect to PollSlide", "Enter code", the SVG
   mockups of its menu), which are correct to stay English because that is literally what
   is drawn on the user's screen. This regex-based auditor didn't know the attribute
   existed, so 42 deliberately-skipped strings across download/help/integrations/setup.html
   read as a "coverage regression" the moment they were added — the exact failure mode this
   file's own header already lists twice, just for a third element attribute. */
const clean = (h) => h
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<([a-z0-9]+)\b[^>]*data-i18n-html="[^"]*"[^>]*>[\s\S]*?<\/\1>/g, '')
  /* Replaced with an empty comment, not deleted outright: deleting
     "<strong data-i18n-skip>X</strong>" outright joins the plain-text sibling BEFORE it to
     the one AFTER it into one fused run (their only separator was the `>`/`<` this element
     carried), so "…click the ", then "…That opens the " merged into one string that matches
     no dictionary key and read as a giant new gap. The empty comment keeps a `>` on one side
     and a `<` on the other, so each sibling is still cut where i18n.js actually cuts it. */
  .replace(/<([a-z0-9]+)\b[^>]*\bdata-i18n-skip\b[^>]*>[\s\S]*?<\/\1>/gi, '<!---->');

/* EVERY text node, not just the first run after an opening tag.
   The earlier version matched `<p ...>text<` — which sees the text that starts a tag and
   is blind to everything after an inline child. A paragraph like
       <p>Click <b>Present</b> and the room answers.</p>
   reported only "Click", so " and the room answers." was never counted and the page
   scored 100% while 58 English nodes were visibly on screen. i18n.js translates text
   NODES at runtime, so the audit has to look at exactly the same units. */
const textNodes = (html) => [...clean(html).matchAll(/>([^<]+)</g)].map(m => dec(m[1]));

/* Self-check, run every time this file runs: a skip element between two real text siblings
   must not fuse them into one string, and its own (English, deliberately untranslated)
   content must not appear as a fragment. This is exactly the shape that broke on
   2026-09-15 — asserted here so the fix can't quietly regress the next time this function
   is touched, the way the two fixes before it (see the header) were only caught by hand. */
(function selfCheckSkip() {
  const sample = '<p>click the <b>bar-chart icon</b>, then <b data-i18n-skip>"Show / Hide Poll Window"</b>. That opens it.</p>';
  const got = textNodes(sample);
  const bad = [];
  // dec() trims each node, same as the real extraction — expect the trimmed form here too.
  if (!got.includes(', then')) bad.push('sibling BEFORE the skip element was not kept as its own node: ' + JSON.stringify(got));
  if (!got.includes('. That opens it.')) bad.push('sibling AFTER the skip element was fused with what precedes it: ' + JSON.stringify(got));
  if (got.some(x => x.includes('Show / Hide Poll Window'))) bad.push('skipped text leaked into a reported node');
  if (bad.length) {
    console.error('\n  qa-i18n.js internal self-check failed — the extractor itself is broken:');
    bad.forEach(b => console.error('    ✗ ' + b));
    process.exit(2);
  }
})();

/* ── 1c. JS-rendered copy — the hole clean() leaves on purpose ──────────────────
 * clean() throws every <script> block away before textNodes() runs, because scripts
 * are code, not copy — correct for the 99% of a <script> block that IS code. But a
 * handful of pages build a card/FAQ list from a plain data array and interpolate it
 * into innerHTML at runtime (buildPlans()/buildFAQ() in pricing.html; the `faqs`
 * array + .forEach in download.html/setup.html). That English text is real,
 * rendered, user-facing copy — i18n.js's runtime MutationObserver translates it
 * exactly like any other injected DOM — but it lives inside the part of the file
 * this auditor deliberately never looks at, so it can drift to 100% untranslated
 * and nothing here would ever say so. Found 2026-09-15: pricing.html's Enterprise
 * card went in through this exact hole, and turned out not to be the only page
 * behind it — download.html and setup.html's entire FAQ sections (24 strings) had
 * silently shipped English-only, undetected, since before this check existed.
 *
 * Fix: rather than parsing arbitrary JS (out of scope for a regex/text auditor),
 * evaluate the SPECIFIC named arrays known to hold rendered copy — the same
 * brace-counting + vm.runInContext technique scripts/tests/tier-consistency.test.js
 * already uses to pull `const TIERS = {...}` out of presenter.html. A new page with
 * this pattern costs one line below, the same as adding a page to LEGAL above. */
function extractArrayLiteral(html, declaration) {
  const start = html.indexOf(declaration);
  if (start === -1) return null;
  const open = html.indexOf('[', start);
  let depth = 0, i = open;
  for (; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  const literal = html.slice(open, i);
  const ctx = { Infinity: Infinity };
  vm.createContext(ctx);
  try { return vm.runInContext('(' + literal + ')', ctx); } catch (e) { return null; }
}
// Walk the extracted structure and collect string values that read as prose, not
// plumbing. Excludes href/mailto targets (never translated — they're addresses,
// not copy) via the URL check; everything else is left to the SAME length/letter
// filter textNodes() below already applies to real HTML, so a CSS class name like
// 'cta-outline' is excluded the same way a stray short HTML attribute would be.
function collectCopyStrings(node, out) {
  if (typeof node === 'string') {
    if (/^(https?:|mailto:)/i.test(node)) return;
    /* A string with an inline tag (<b>, <a>, ...) is NOT one runtime text node — i18n.js's
       TreeWalker only ever sees the plain-text RUNS between tags, exactly like textNodes()
       above does for real HTML. A whole-string dictionary key silently never matches, because
       nothing ever looks it up: the walker looks up each fragment on its own. Found 2026-09-15:
       setup.html's "Does PowerPoint work too?" answer wraps an <a> around "Integrations"
       mid-sentence — the link text has its own entry and translated fine, which made the page
       LOOK covered, while the sentence around it, keyed as one whole string, could never match
       and stayed English. Split the same way textNodes() reads real HTML, so this checks the
       same units i18n.js actually translates. */
    if (/<[a-z][^>]*>/i.test(node)) {
      // i18n.js's walkAndTranslate() looks up node.nodeValue.trim(), not the raw text —
      // a fragment's leading/trailing whitespace (from sitting next to the tag that was
      // just split off) is never part of the dictionary key. Trim here too, or a correct
      // runtime key reads as "missing" and a key WITH the whitespace reads as "covered"
      // while never actually matching anything at runtime (found the hard way: this exact
      // mismatch shipped once already, in the first pass of this same fix).
      node.split(/<[^>]+>/).forEach(part => { const t = part.trim(); if (t) out.push(t); });
    } else {
      out.push(node);
    }
  } else if (Array.isArray(node)) {
    node.forEach(v => collectCopyStrings(v, out));
  } else if (node && typeof node === 'object') {
    // Plumbing fields, not copy — a JS handler string like 'openEnterpriseContact()'
    // is exactly as English-shaped as a real sentence (letters, no URL scheme), so
    // the length/letter filter alone can't tell them apart. Found 2026-09-15: this key
    // list is the same reason JS_RENDERED_ARRAYS below is a per-file, per-array
    // allowlist rather than "scan every <script>" — an explicit list beats a clever
    // heuristic that will eventually mistake plumbing for prose again.
    const NON_COPY_KEYS = new Set(['url', 'onclick', 'ctaClass', 'class', 'key', 'id']);
    for (const [k, v] of Object.entries(node)) { if (!NON_COPY_KEYS.has(k)) collectCopyStrings(v, out); }
  }
}
// file → every `declaration` whose array holds rendered copy.
const JS_RENDERED_ARRAYS = {
  'pricing.html':  ['var PLANS=[', 'var FAQS=['],
  'download.html': ['const faqs = ['],
  'setup.html':    ['const faqs = ['],
};
function jsRenderedStrings(f, html) {
  const decls = JS_RENDERED_ARRAYS[f];
  if (!decls) return [];
  const out = [];
  for (const decl of decls) collectCopyStrings(extractArrayLiteral(html, decl), out);
  return out;
}

// Self-check: a nested array-of-objects yields its prose strings, a mailto/http
// value is dropped (it's an address, not copy), and the whole thing survives being
// embedded inside a real <script> tag exactly as it appears in a page.
(function selfCheckJsRendered() {
  const sample = '<script>\nconst faqs = [\n  { q: \'Does it work offline?\', a: \'No, an internet connection is required.\', url: \'https://example.com/x\', onclick: \'openThing()\' },\n  { q: \'See also\', a: \'Read the <a href="/help">Help</a> page for more.\' },\n];\n</script>';
  const out = [];
  collectCopyStrings(extractArrayLiteral(sample, 'const faqs = ['), out);
  const bad = [];
  if (!out.includes('Does it work offline?')) bad.push('did not extract the question string');
  if (!out.includes('No, an internet connection is required.')) bad.push('did not extract the answer string');
  if (out.some(x => x.startsWith('http'))) bad.push('a URL value leaked through as if it were copy');
  // A `url`/`onclick` field is plumbing, not prose — it's exactly as English-shaped as a
  // real sentence, so only an explicit key skip (not the length/letter filter) catches it.
  if (out.includes('openThing()')) bad.push('an onclick handler string leaked through as if it were copy');
  // A string with an embedded tag must split into its plain-text fragments — the runtime
  // walker never sees it as one node, so testing it as one node is testing the wrong thing.
  // Each fragment must also come out TRIMMED, matching node.nodeValue.trim() at runtime.
  if (!out.includes('Read the')) bad.push('did not split off the fragment BEFORE the embedded <a>, trimmed');
  if (!out.includes('page for more.')) bad.push('did not split off the fragment AFTER the embedded <a>, trimmed');
  if (out.some(x => x !== x.trim())) bad.push('a fragment kept leading/trailing whitespace instead of being trimmed');
  if (out.some(x => x.includes('<a '))) bad.push('an embedded-HTML string was kept whole instead of split into fragments');
  if (bad.length) {
    console.error('\n  qa-i18n.js internal self-check failed — the JS-array extractor is broken:');
    bad.forEach(b => console.error('    ✗ ' + b));
    process.exit(2);
  }
})();

/* Recurse into subdirectories (e.g. blog/) — a flat readdirSync silently skips any page
 * that isn't directly in SITE. Found 2026-09-16: three files under blog/ (including two
 * genuine blog posts) were invisible to this ENTIRE coverage check — not under-reported,
 * not flagged as low-coverage, just never read at all, so a regression there could never
 * have been caught. Same root cause, same fix, as qa-site-assets.js's identical gap found
 * the same day. */
function walkHtmlFiles(dir, base = '') {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out = out.concat(walkHtmlFiles(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.html')) out.push(rel);
  }
  return out;
}

const coverage = {};
let sitePages = 0;
if (fs.existsSync(SITE)) {
  for (const f of walkHtmlFiles(SITE).sort()) {
    if (LEGAL.has(f)) continue;
    const html = read(path.join(SITE, f));
    if (!html || !/i18n\.js/.test(html)) continue;
    const strings = textNodes(html).concat(jsRenderedStrings(f, html))
      /* No upper length cap that matters: a 180-char ceiling silently excluded every
         long paragraph, which is exactly where the untranslated prose was hiding. */
      .filter(x => x.length >= 12 && x.length <= 600 && /[A-Za-z]{4}/.test(x));
    const uniq = [...new Set(strings)];
    if (!uniq.length) continue;
    sitePages++;
    const hit = uniq.filter(x => dict[x] !== undefined).length;
    coverage[f] = { pct: Math.round(hit / uniq.length * 100), hit, total: uniq.length };
  }
}

const prior = (() => { try { return JSON.parse(read(BASELINE)) || {}; } catch (e) { return {}; } })();

if (UPDATE) {
  fs.writeFileSync(BASELINE, JSON.stringify(coverage, null, 2) + '\n');
  const tot = Object.values(coverage).reduce((a, c) => a + c.total, 0);
  const got = Object.values(coverage).reduce((a, c) => a + c.hit, 0);
  console.log(`\n  Recorded ${sitePages} pages as the new floor — ${got}/${tot} (${Math.round(got / tot * 100)}%).`);
  console.log('  Coverage may now only go up.\n');
  process.exit(0);
}

for (const [f, cur] of Object.entries(coverage)) {
  const was = prior[f];
  if (!was) continue;                       // new page: recorded on the next --update
  if (cur.pct < was.pct) {
    bad(`${f}: translation coverage FELL from ${was.pct}% to ${cur.pct}%`,
        `${cur.total - cur.hit} string(s) now untranslated. English copy was added without ` +
        'translating it — every non-English visitor sees that text in English.');
  }
}

const tot = Object.values(coverage).reduce((a, c) => a + c.total, 0);
const got = Object.values(coverage).reduce((a, c) => a + c.hit, 0);
const worst = Object.entries(coverage).sort((a, b) => a[1].pct - b[1].pct).slice(0, 3);
if (tot) {
  console.log(`  ✓ site copy: ${got}/${tot} strings translated (${Math.round(got / tot * 100)}%), ` +
              `${sitePages} pages, no regressions`);
  console.log(`    still lowest: ${worst.map(([f, c]) => `${f} ${c.pct}%`).join(', ')}`);
  console.log(`    (legal pages excluded on purpose — the English version governs)`);
}

console.log('─'.repeat(64));
if (fail) {
  problems.forEach(p => console.log('  ✗ ' + p));
  console.log(`\n${fail} problem(s). A missing translation is invisible in English —\n` +
              'which is the language it will be reviewed in.\n' +
              'Translate the new copy, or run --update if the drop is intentional.\n');
  process.exit(1);
}
console.log('\nEvery language carries every key, and no page went backwards.\n');
process.exit(0);
