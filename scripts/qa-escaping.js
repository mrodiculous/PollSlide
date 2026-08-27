#!/usr/bin/env node
/*
 * PollSlide — output-escaping QA
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * The audience page built its screens with template literals and innerHTML, and
 * injected the presenter's question text — and the TRANSLATION MODEL's output —
 * without escaping. From a seat in the room that looked like corruption: a stray
 * "<" swallowed the rest of a question, and "&amp;" silently decoded. It is also an
 * injection hole, because whatever the model returns would run as HTML on every
 * phone in the room.
 *
 *   CONTENT THAT CAME FROM A PERSON OR A MODEL IS NOT MARKUP.
 *
 * WHAT THIS CHECKS
 * Every `${...}` interpolation of a known CONTENT field inside a template literal
 * must pass through an escaper. Layout, numbers, ids and translated UI labels are
 * ours and are left alone — this is about text we did not write.
 *
 * Static analysis, so it can produce false positives on an unusual expression.
 * Every hit is a prompt to look, not proof of a bug.
 *
 * Usage:  node scripts/qa-escaping.js [files...]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FILES = ['answer.html', 'live.html', 'results.html', 'recap.html', 'report.html', 'present.html'];
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;

// Fields that hold text a presenter typed or a model translated.
const CONTENT = [
  'text', 'front', 'back', 'stem', 'name', 'answer', 'message', 'note',
  'title', 'label', 'low', 'high', 'explainerText', 'question',
];
// Escapers and sanitisers this codebase uses. `rich()` (present.html) is a real
// sanitiser — whitelist of inline tags, every attribute stripped — so content passed
// through it is deliberately allowed to carry formatting.
const ESCAPERS = /\b(esc|escT|escHtml|escapeHtml|escapeQa|escAttr|escapeAttr|rich)\s*\(/;

/* Expressions that read OUR OWN hard-coded constants, not anything a person typed.
 * present.html's THEMES / SLIDE_TYPES / template tables are ours; `d.text` there is
 * a CSS colour, not prose. Escaping them would be churn, and leaving them reported
 * would bury a real finding in noise — so they're named here, once, deliberately. */
const OURS = [
  /^d\.text$/, /^th\.name$/, /^d\.label$/, /^SLIDE_TYPES\[[^\]]+\]\.label$/,
  /^t2\.name\.(split|slice)\(/,
  // live.html: psModeHeadline() returns our own game-mode captions ('FASTEST FINGER').
  // Its `extra` and `name` fields DO carry player names, and those are escaped.
  /^_hl\.label$/,
];

let findings = 0;

for (const f of files) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) { console.log(`\n=== ${f} ===\n  (missing — skipped)`); continue; }
  const html = fs.readFileSync(full, 'utf8');
  // Scan the WHOLE file rather than a concatenation of its script blocks, so the
  // line numbers reported are the ones you'd type into an editor. A checker that
  // points at the wrong line is a checker people stop trusting.
  const js = html;
  const hits = [];

  // `${ expr }` where expr reads a content field off some object.
  const re = new RegExp(String.raw`\$\{([^}]{0,160})\}`, 'g');
  for (const m of js.matchAll(re)) {
    const expr = m[1];
    if (ESCAPERS.test(expr)) continue;                 // already escaped
    if (!new RegExp(String.raw`\.\s*(${CONTENT.join('|')})\b`).test(expr)) continue;
    // Our own translated UI strings come from t('key','fallback') — those are ours.
    if (/^\s*t\s*\(/.test(expr)) continue;
    // A ternary choosing between two literals we wrote is markup, not content
    // (`x === y ? ' selected' : ''`). Only flag it if a content field reaches output.
    if (/\?[^:]*['"`][^'"`]*['"`]\s*:\s*['"`][^'"`]*['"`]\s*$/.test(expr)) continue;
    // Numeric fallbacks like `${q.ratingMax||5}` can't carry markup.
    if (/\|\|\s*\d+\s*$/.test(expr)) continue;
    if (OURS.some(re => re.test(expr.trim()))) continue;   // our own constants
    // A ternary that escapes in both branches is fine.
    const line = js.slice(0, m.index).split('\n').length;
    hits.push(`[E] line ~${line}: \${${expr.trim().slice(0, 90)}} — content field injected without an escaper.`);
  }

  console.log(`\n=== ${f} ===`);
  if (hits.length) { findings += hits.length; hits.slice(0, 20).forEach(h => console.log('  ' + h)); if (hits.length > 20) console.log(`  …and ${hits.length - 20} more`); }
  else console.log('  every content interpolation is escaped');
}

console.log(`\n${findings} unescaped content interpolation(s).`);
console.log('Content typed by a presenter — or returned by a translation model — is not markup.\n');
process.exit(0);   // advisory, like qa-reachability
