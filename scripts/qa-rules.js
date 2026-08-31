#!/usr/bin/env node
/* PollSlide QA — database-rules.json is something Firebase will actually accept.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * The rules file had a `".comment"` key in it. That is perfectly valid JSON, so every
 * check passed and `JSON.parse` was happy — but Firebase's rules parser accepts only
 * four dot-keys, and rejected the paste with:
 *
 *     Line 29: Expected '{'.
 *
 * which does not obviously mean "you used a key I do not recognise". The file sat
 * broken until someone tried to publish it, and the error told them almost nothing.
 *
 * Rules are also the one artefact where being wrong is silent in the other direction:
 * a missing rule is not an error, it is a feature that quietly never saves anything.
 * So this checks both — that the file will paste, and that it says something about
 * every path the code actually writes to.
 *
 * Run: node scripts/qa-rules.js
 * --------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'database-rules.json');

// The complete set. Firebase rejects anything else beginning with a dot.
const ALLOWED = new Set(['.read', '.write', '.validate', '.indexOn']);

let problems = 0;
const fail = (msg, fix) => { problems++; console.log('  ✗ ' + msg + (fix ? '\n      → ' + fix : '')); };
const okay = (msg) => console.log('  ✓ ' + msg);

console.log('\ndatabase-rules.json\n' + '─'.repeat(60));

let raw, doc;
try { raw = fs.readFileSync(FILE, 'utf8'); }
catch (e) { console.log('  ✗ could not read database-rules.json (' + e.code + ')'); process.exit(1); }

try { doc = JSON.parse(raw); okay('valid JSON'); }
catch (e) { fail('not valid JSON: ' + e.message); process.exit(1); }

if (!doc.rules || typeof doc.rules !== 'object') fail('no top-level "rules" object.');
else okay('has a top-level "rules" object');

/* Every dot-key, with the line it is on — because that is what the Firebase error
 * gives you, and matching it makes the two messages line up. */
const lineOf = (key) => {
  const i = raw.indexOf('"' + key + '"');
  return i === -1 ? null : raw.slice(0, i).split('\n').length;
};

let dotKeys = 0;
(function walk(node, at) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('.')) {
      dotKeys++;
      if (!ALLOWED.has(k)) {
        fail(`${at}/${k} — Firebase rejects this key (line ${lineOf(k) || '?'}).`,
             'Only .read, .write, .validate and .indexOn are allowed. Put explanations in RULES-NOTES.md.');
      }
      if (k === '.indexOn' && !Array.isArray(v) && typeof v !== 'string') {
        fail(`${at}/.indexOn must be a string or an array of strings.`);
      }
      if ((k === '.read' || k === '.write' || k === '.validate') &&
          typeof v !== 'string' && typeof v !== 'boolean') {
        fail(`${at}/${k} must be a rule expression or a boolean, got ${typeof v}.`);
      }
    } else {
      walk(v, at + '/' + k);
    }
  }
})(doc.rules, '');
if (!problems) okay(`${dotKeys} rule keys, all of them ones Firebase accepts`);

/* The other half: a path the code writes to but the rules never mention is
 * default-denied, and the symptom is a feature that silently saves nothing. */
const WRITES = [
  { path: 'sessions/$code/responses', by: 'answer.html — a submitted answer' },
  { path: 'sessions/$code/attempts',  by: 'answer.html — retake history' },
  { path: 'sessions/$code/study',     by: 'answer.html — flashcard progress' },
  { path: 'sessions/$code/qa',        by: 'answer.html — audience questions' },
  { path: 'sessions/$code/teams',     by: 'answer.html — team join' },
  { path: 'users/$uid/classes',       by: 'presenter.html — class rosters' },
  { path: 'quiz_builder/$code',       by: 'presenter.html — published deck + roster' },
  { path: 'app_config',               by: 'admin.html — policy version' },
  { path: 'sharedDecks/$sid',         by: 'present.html — share links' },
  { path: 'deckGrants/$uid',          by: 'presenter.html — collaboration' },
];

// Does any ancestor of this path carry a .write? Rules cascade downward.
function writable(p) {
  const parts = p.split('/').filter(Boolean);
  let node = doc.rules;
  if (node['.write'] !== undefined) return true;
  for (const part of parts) {
    /* A literal segment is governed by the wildcard child when there is no exact
       match: a write to sharedDecks/abc is governed by sharedDecks/$sid. Matching only
       $-to-$ made this report two rules as missing that were plainly there. */
    const key = Object.keys(node).find(k => k === part)
             || Object.keys(node).find(k => k.startsWith('$'));
    if (!key) return false;
    node = node[key];
    if (!node || typeof node !== 'object') return false;
    if (node['.write'] !== undefined) return true;
  }
  return false;
}

console.log('');
let denied = 0;
WRITES.forEach(w => {
  if (!writable(w.path)) { denied++; fail(`${w.path} has no .write rule — ${w.by} will silently save nothing.`,
                                          'Add a rule, or remove this entry if the path is gone.'); }
});
if (!denied) okay(`all ${WRITES.length} paths the code writes to are covered by a rule`);

console.log('─'.repeat(60));
console.log(problems
  ? `\n${problems} problem(s). Firebase will refuse this file, or accept it and deny a write.\n`
  : '\nThe rules file will paste, and covers every path the code writes to.\n');
process.exit(problems ? 1 : 0);
