#!/usr/bin/env node
/* Puts PollSlide LIVE (the PowerPoint add-in) into 11 languages — run ONLY after Microsoft
 * approves the add-in. While SUBMIT-TO-MICROSOFT/REVIEW-FREEZE.json exists this refuses,
 * because the reviewer tests the live page and changing it during review restarts the review.
 *
 *   node scripts/appsource/apply-addin-languages.js           (dry run: checks, changes nothing)
 *   node scripts/appsource/apply-addin-languages.js --write   (after approval)
 *
 * Merges SUBMIT-TO-MICROSOFT/after-approval/addin-languages-nl-ja-zh-ar-hi.json into the
 * add-in's L10N table, and makes Arabic lay out right to left. Every key must already exist
 * in the add-in, and every {placeholder} must survive — otherwise nothing is written. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'powerpoint-content', 'index.html');
const ADD = path.join(ROOT, 'SUBMIT-TO-MICROSOFT', 'after-approval', 'addin-languages-nl-ja-zh-ar-hi.json');
const FREEZE = path.join(ROOT, 'SUBMIT-TO-MICROSOFT', 'REVIEW-FREEZE.json');
const WRITE = process.argv.includes('--write');

let html = fs.readFileSync(PAGE, 'utf8');
const start = html.indexOf('const L10N = ') + 'const L10N = '.length, end = html.indexOf('\n', start);
const L10N = JSON.parse(html.slice(start, end).replace(/;\s*$/, ''));
const add = JSON.parse(fs.readFileSync(ADD, 'utf8')); delete add._note;
const keys = Object.keys(L10N.es), problems = [];
for (const [lang, d] of Object.entries(add)) {
  for (const k of keys) if (!d[k]) problems.push(`${lang}: missing "${k}"`);
  for (const k of Object.keys(d)) {
    if (!keys.includes(k)) problems.push(`${lang}: "${k}" is not a string the add-in uses`);
    const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join();
    if (ph(k) !== ph(d[k])) problems.push(`${lang}: placeholders differ in "${k}"`);
  }
}
if (problems.length) { console.log('✗ Not applied:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log(`✓ ${Object.keys(add).join('/')} — ${keys.length} strings each, placeholders intact`);
if (!WRITE) { console.log('Dry run. Re-run with --write after Microsoft approves.'); process.exit(0); }
if (fs.existsSync(FREEZE)) { console.log('✗ REVIEW-FREEZE.json exists — Microsoft has not approved yet. Nothing written.'); process.exit(1); }

Object.assign(L10N, add);
html = html.slice(0, start) + JSON.stringify(L10N) + ';' + html.slice(end);
const dirFrom = "  try { document.documentElement.lang = LANG; } catch(e){}";
if (html.includes(dirFrom) && !html.includes("documentElement.dir")) {
  html = html.replace(dirFrom, dirFrom + "\n  try { document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr'; } catch(e){}");
}
html = html.replace('es/de/fr/pt/it are translated', 'es/de/fr/pt/it/nl/ja/zh/ar/hi are translated');
fs.writeFileSync(PAGE, html);
console.log('✓ Written. Run node scripts/qa.js, then deploy — the manifest does not change, so no resubmission.');
