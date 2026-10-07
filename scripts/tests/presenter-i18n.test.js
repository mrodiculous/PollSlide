#!/usr/bin/env node
/* The presenter's editor, live view, results panel and status strip follow the UI language
 * (2026-10-07). English output was checked byte-identical on 49 screens before/after.
 * Run: node scripts/tests/presenter-i18n.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')));

global.window = { PS_UI: {} };
require(path.join(ROOT, 'ui-lang.js'));
const UI = window.PS_UI, LANGS = ['es', 'de', 'fr', 'pt', 'it'];
const P = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');

console.log('\nEvery tr()/trf() string in the presenter has all five translations');
const keys = new Set();
for (const m of P.matchAll(/\btrf?\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'").trim());
for (const m of P.matchAll(/\btr\([a-zA-Z.!=<>\d ]+\?\s*'([^']+)'\s*:\s*'([^']+)'\)/g)) { keys.add(m[1]); keys.add(m[2]); }
for (const m of P.matchAll(/\btrk\('([^']+)'/g)) keys.add(m[1]);
ok('found the presenter strings (' + keys.size + ')', keys.size > 100, keys.size);
for (const l of LANGS) {
  const miss = [...keys].filter(k => UI[l][k] == null);
  ok(l + ': none missing', miss.length === 0, miss);
}

console.log('\nThe lookup rules that bit us');
const lead = LANGS.flatMap(l => Object.keys(UI[l]).filter(k => keys.has(k.trim()) && k !== k.trim()).map(k => l + ':' + JSON.stringify(k)));
ok('no presenter key relies on a leading/trailing space (tr() trims the key, so it is never found)', !lead.some(k => !/Could not send: "/.test(k)), lead);
ok('the strip suffix keeps its leading space in the value', LANGS.every(l => /^ · /.test(UI[l]['· nothing is live yet'] || '')));
ok('{n} placeholders survive in every language', LANGS.every(l => ['Question {n} of {m}', 'Card {n}', 'QR for Q{n}', '· your audience is on question {n}'].every(k => (UI[l][k] || '').includes('{n}'))));
ok('the flashcard "Back" has its own key — the navigation "Back" is untouched', /trk\('Back \(card side\)', 'Back'\)/.test(P) && LANGS.every(l => UI[l]['Back (card side)'] && UI[l].Back));
ok('AI image styles: only the label is translated, the prompt sent to the AI stays English', /realistic:\s*\{ label:'📷 Realistic photo', mod:'photorealistic/.test(P) && LANGS.every(l => UI[l]['📷 Realistic photo']));

console.log('\nEnglish is unchanged');
const trSrc = P.slice(P.indexOf('function trk('), P.indexOf('\n}\n', P.indexOf('function trf(')) + 3);
ok('trk/trf return the English text when the language is English', (() => {
  const f = new Function('window', 'UI_LANG', 'tr', trSrc + '; return [trk("Back (card side)","Back"), trf("Question {n} of {m}",{n:2,m:5})];');
  const r = f(window, 'en', s => s);
  return r[0] === 'Back' && r[1] === 'Question 2 of 5';
})());
ok('…and fill placeholders in a translated string', (() => {
  const f = new Function('window', 'UI_LANG', 'tr', trSrc + '; return trf("Question {n} of {m}",{n:2,m:5});');
  return f(window, 'es', s => UI.es[s] || s) === UI.es['Question {n} of {m}'].replace('{n}', 2).replace('{m}', 5);
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
