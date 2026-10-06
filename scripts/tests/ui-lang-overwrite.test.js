#!/usr/bin/env node
/* The presenter's translator must not overwrite what the page wrote (2026-10-06).
 * applyUiLang() re-runs whenever buttons are added. It used to put each tagged element's
 * ORIGINAL words back every time, so for anyone not in English: the top bar lost the open
 * deck's name ("Select a presentation"), the sign-in box flipped back to "Welcome back" in
 * sign-up mode, and the save status froze. This runs the real function on stand-in elements.
 * Run: node scripts/tests/ui-lang-overwrite.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const P = fs.readFileSync(path.join(path.resolve(__dirname, '..', '..'), 'presenter.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const i = P.indexOf('function applyUiLang() {'); let d = 0, j = P.indexOf('{', i);
for (; j < P.length; j++) { if (P[j] === '{') d++; else if (P[j] === '}' && !--d) break; }
const src = P.slice(i, j + 1);
const el = (text, kids) => ({ textContent: text, children: kids ? [1] : [] });
function run(lang, els) {
  const ctx = { UI_LANG: lang, applyUiLangControls() {}, document: { documentElement: {}, querySelectorAll: s => (s === '[data-i18n]' ? els : []) },
    tr: s => ({ 'Select a presentation': 'Selecciona una presentación', 'Welcome back': 'Bienvenido de nuevo', 'Create your account': 'Crea tu cuenta', 'Saved': 'Guardado', 'Saving…': 'Guardando…' })[s] || s };
  vm.createContext(ctx); vm.runInContext(src + ';applyUiLang();', ctx);
}
console.log('\nPresenter translator: never overwrites what the page wrote');
const top = el('Select a presentation'), title = el('Welcome back'), save = el('Saved');
run('es', [top, title, save]);
ok('first pass translates as before', top.textContent === 'Selecciona una presentación' && title.textContent === 'Bienvenido de nuevo');
top.textContent = 'Unit 3 · MOVE01'; top.children = [1];          // deck opened: <strong>name</strong> · code
title.textContent = 'Create your account';                         // toggleAuthMode → sign-up
save.textContent = 'Saving…';
run('es', [top, title, save]);
ok('the open deck\'s name stays in the top bar', top.textContent === 'Unit 3 · MOVE01', top.textContent);
ok('sign-up mode keeps its title, translated', title.textContent === 'Crea tu cuenta', title.textContent);
ok('the save status follows the page, translated', save.textContent === 'Guardando…', save.textContent);
top.textContent = 'Select a presentation'; top.children = [];      // deck closed again
run('es', [top, title, save]);
ok('closing the deck shows the translated prompt again', top.textContent === 'Selecciona una presentación', top.textContent);
const e1 = el('Welcome back'), e2 = el('Unit 9', true);
run('en', [e1]); e1.textContent = 'Create your account'; run('en', [e1, e2]);
ok('English: unchanged — the page\'s words stay as written', e1.textContent === 'Create your account' && e2.textContent === 'Unit 9');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
