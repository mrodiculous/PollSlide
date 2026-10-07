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
// Every quoted string handed to tr/trf/trp/trk (both arms of a ?: too), evaluated as JS reads it.
const lit = q => Function('"use strict";return ' + q)();
const STR = `'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"`;
for (const m of P.matchAll(new RegExp(`\\btr[fpk]?\\(([^()]*?)(?:\\)|,)`, 'g'))) {
  for (const q of (m[1].match(new RegExp(STR, 'g')) || [])) keys.add(lit(q).trim());
}
for (const m of P.matchAll(new RegExp(`\\btrp\\([^,]+,\\s*(${STR})\\s*,\\s*(${STR})`, 'g'))) { keys.add(lit(m[1]).trim()); keys.add(lit(m[2]).trim()); }
keys.delete('');
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

console.log('\nThe other app pages translate too (Present studio, reports, results, recap, overlay)');
for (const page of ['present.html', 'report.html', 'results.html', 'recap.html', 'overlay.html']) {
  const S = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const iLang = S.indexOf('/ui-lang.js'), iTr = S.indexOf('/ui-tr.js'), iInline = S.search(/<script>(?!\s*<\/script>)/);
  ok(page + ': loads the dictionary, then the translator, before its own code', iLang > 0 && iTr > iLang && iTr < iInline);
  const ks = new Set();
  for (const m of S.matchAll(new RegExp(`\\btr[fpk]?\\(([^()]*?)(?:\\)|,)`, 'g'))) for (const q of (m[1].match(new RegExp(STR, 'g')) || [])) ks.add(lit(q).trim());
  for (const m of S.matchAll(new RegExp(`\\btrp\\([^,]+,\\s*(${STR})\\s*,\\s*(${STR})`, 'g'))) { ks.add(lit(m[1]).trim()); ks.add(lit(m[2]).trim()); }
  ks.delete('');
  const miss = [...ks].filter(k => LANGS.some(l => UI[l][k] == null) && !['⤢ Zoom'].includes(k));
  ok(page + ': every tr() string has all five translations (' + ks.size + ')', miss.length === 0, miss);
}
const UT = fs.readFileSync(path.join(ROOT, 'ui-tr.js'), 'utf8');
ok('ui-tr.js follows the presenter\'s language choice, then the browser', /ps_ui_lang/.test(UT) && /navigator\.language/.test(UT));
ok('ui-tr.js returns the English untouched in English, and never overwrites a page\'s own tr()', /if \(lang === 'en'\) return en;/.test(UT) && /typeof window\.tr !== 'function'/.test(UT));
ok('ui-tr.js leaves [data-noi18n] (names, deck titles) alone', /NO_TR = '\[data-noi18n\]'/.test(UT));
const PR = fs.readFileSync(path.join(ROOT, 'present.html'), 'utf8');
ok('Present studio: "deck" is a presentation, never a pack of cards', !/'more\.deck':'(Baraja|Jeu|Baralho|Mazzo)'/.test(PR));
ok('the present-screen button bar never covers a button with the logo', /function fitPresentBar\(/.test(P) && /setTimeout\(fitPresentBar, 60\)/.test(P));
ok('the post-reveal countdown writes only the number (it used to say "Post-reveal in" twice)', !/textContent = `Post-reveal in \$\{postRevealCountdown\}s`/.test(P));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
