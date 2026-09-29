#!/usr/bin/env node
/* Presenter: the correct answer is shown in the centre bar without opening the editor
 * (2026-09-29). Display only — blurred until hovered/clicked, since the presenter's screen
 * is often mirrored. This checks the answer text for every shape of question and that the
 * chip reads the question without changing it. Run: node scripts/tests/presenter-answer-chip.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'presenter.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const grab = name => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && !--d) break; } return src.slice(i, j + 1); };
const ctx = { escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  localStorage: { v: {}, getItem(k) { return this.v[k] || null; }, setItem(k, v) { this.v[k] = v; } } };
vm.createContext(ctx); vm.runInContext(grab('answerSummary') + grab('answerChip') + grab('toggleAnswerChip'), ctx);
const A = q => ctx.answerSummary(q);
console.log('\nPresenter: correct answer in the centre bar');
const mc = { type: 'multiple_choice', options: [{ text: 'Venus' }, { text: 'Mercury' }, { text: 'Earth' }], correctAnswer: 1 };
const before = JSON.stringify(mc);
ok('multiple choice → "B. Mercury"', A(mc) === 'B. Mercury', A(mc));
ok('the question is not changed by reading it', JSON.stringify(mc) === before);
ok('stored as a string index ("0") → "A. Venus"', A({ ...mc, correctAnswer: '0' }) === 'A. Venus');
ok('several correct → "A. Venus · C. Earth"', A({ ...mc, type: 'multiple_choice_multi', correctAnswer: [0, 2] }) === 'A. Venus · C. Earth');
ok('plain-string options work', A({ type: 'multiple_choice', options: ['Yes', 'No'], correctAnswer: 0 }) === 'A. Yes');
ok('a poll with no answer shows nothing', A({ type: 'multiple_choice', options: ['a', 'b'] }) === '' && A({ ...mc, correctAnswer: null }) === '' && A({ ...mc, correctAnswer: [] }) === '' && A({ ...mc, correctAnswer: '' }) === '');
ok('word cloud / rating / free text without an answer show nothing', ['free_text', 'rating', 'word_cloud'].every(t => A({ type: t }) === ''));
ok('an answer index past the options still shows something sensible, never crashes', A({ ...mc, correctAnswer: 9 }) === '9');
ok('flashcard shows its back', A({ type: 'flashcard', back: 'Paris' }) === 'Paris');
ok('no question → nothing', A(null) === '');
const chip = ctx.answerChip({ ...mc, options: [{ text: '<img src=x onerror=alert(1)>' }], correctAnswer: 0 });
ok('answer text is escaped', !/<img/.test(chip) && /&lt;img/.test(chip), chip);
ok('hidden (blurred) by default', !/cm-answer shown/.test(ctx.answerChip(mc)));
const el = { c: new Set(['cm-answer']), classList: { contains: x => el.c.has(x), toggle: (x, on) => on ? el.c.add(x) : el.c.delete(x) } };
ctx.toggleAnswerChip(el);
ok('clicking keeps it showing, and remembers that', el.c.has('shown') && ctx.localStorage.v.psShowAnswer === '1' && /cm-answer shown/.test(ctx.answerChip(mc)));
ctx.toggleAnswerChip(el);
ok('clicking again hides it again', !el.c.has('shown') && ctx.localStorage.v.psShowAnswer === '0');
ok('only in the preview/live bar, next to Edit — the editing view is unchanged',
  /answerChip\(q\) \+\s*'<button class="cm-switch" onclick="editQuestion\(/.test(src) && (src.match(/[^n] answerChip\(q\)|\n\s*answerChip\(q\)/g) || []).length === 1);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
