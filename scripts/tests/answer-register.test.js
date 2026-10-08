#!/usr/bin/env node
/* The audience phone page (answer.html) keeps the house register (2026-10-08):
 * fr → tu (never vous/votre/vos), pt → European Portuguese, formal "o seu" (never você/tela/
 * arquivo/equipe/compartilh…). See ui-lang.js — it is the anchor for register and vocabulary.
 * Run: node scripts/tests/answer-register.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')));

const A = fs.readFileSync(path.join(ROOT, 'answer.html'), 'utf8');
// The I18N literal plus every Object.assign(I18N.xx, …) after it, evaluated as the page reads them.
const start = A.indexOf('const I18N = {'), end = A.indexOf('function t(key, fallback)', start);
const I18N = Function('"use strict";' + A.slice(start, end) + ';return I18N;')();

console.log('\nanswer.html I18N register');
ok('found the fr and pt dictionaries', Object.keys(I18N.fr || {}).length > 100 && Object.keys(I18N.pt || {}).length > 100);
const hits = (l, re) => Object.entries(I18N[l]).filter(([, v]) => re.test(v)).map(([k, v]) => l + '.' + k + ': ' + v);
ok('fr uses tu — no vous/votre/vos', hits('fr', /\b(vous|votre|vos)\b/i).length === 0, hits('fr', /\b(vous|votre|vos)\b/i));
ok('pt is European — no você/tela/arquivo/equipe/compartilh…', hits('pt', /\b(você|tela|arquivo|equipe|compartilh)/i).length === 0, hits('pt', /\b(você|tela|arquivo|equipe|compartilh)/i));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
