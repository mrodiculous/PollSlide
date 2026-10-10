#!/usr/bin/env node
/* Pop-ups, toasts and dialogs are built by code, so they are not on the page for the browser
 * sweep to read. This finds every literal the app pages pass to their translator —
 * tr('…'), trf('…'), toast(tr('…')), confirm(tr('…')) — and reports any that a language lacks. */
const fs = require('fs'), path = require('path'), ROOT = path.resolve(__dirname, '..', '..');
global.window = global; global.document = { documentElement: { classList: { toggle() {} } }, getElementById() { return 1; } };
require(path.join(ROOT, 'ui-lang.js'));
const P = global.PS_UI, LANGS = ['es','de','fr','pt','it','nl','ja','zh','ar','hi'];
const FILES = process.argv.slice(2).length ? process.argv.slice(2) : ['presenter.html','present.html','live.html','results.html','report.html','recap.html','overlay.html'];
const miss = new Map();
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /\b(?:tr|trf|trp|bigTr|uiTr)\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g; let m;
  while ((m = re.exec(src))) {
    if (src.slice(re.lastIndex).trimStart()[0] === '+') continue;   // tr('Retakes: {n} tries, ' + kind + …) — the full keys are checked by their own tests
    let k; try { k = Function('return ' + m[1] + m[2] + m[1])(); } catch (e) { continue; }   // decode \u2713, \n, \' exactly as JS does
    k = k.trim();                      // every translator here looks keys up trimmed
    if (!/[A-Za-z]{2}/.test(k)) continue;
    const gaps = LANGS.filter(l => !P[l] || P[l][k] == null);
    if (gaps.length) miss.set(f + ' | ' + k, gaps);
  }
  // Both arms of tr(cond ? '…' : '…') — one state of a toggle was missing for every language.
  const tern = /\b(?:tr|trf)\(\s*[\w.!()]+\s*\?\s*(['"])((?:\\.|(?!\1).)*?)\1\s*:\s*(['"])((?:\\.|(?!\3).)*?)\3\s*\)/g;
  while ((m = tern.exec(src))) for (const [q, raw] of [[m[1], m[2]], [m[3], m[4]]]) {
    let k; try { k = Function('return ' + q + raw + q)().trim(); } catch (e) { continue; }
    const gaps = LANGS.filter(l => !P[l] || P[l][k] == null);
    if (gaps.length) miss.set(f + ' | ' + k, gaps);
  }
}
for (const [k, g] of miss) console.log(`  ✗ ${k.slice(0, 150)}  [${g.length === 10 ? 'all' : g.join(',')}]`);
console.log(miss.size ? `${miss.size} message(s) missing a translation` : 'Every message has all ten translations.');
process.exit(miss.size ? 1 : 0);
