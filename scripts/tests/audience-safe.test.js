/* Tests for audience-safe.js — audience text can never become markup.
 *
 * Two halves:
 *   1. scoped() neutralises every audience-writable path, at every depth a page might read
 *      it from, and leaves presenter-authored data (questions, decks, settings) alone.
 *   2. Every page that loads the Firebase database script also loads audience-safe.js
 *      straight after it — a page that forgets is a page the fix does not cover.
 *
 * Verified separately against the real Firebase 10.7.1 compat SDK in Chromium on
 * 2026-10-10: val(), exportVal(), child().val() and forEach() children all come back clean.
 *
 * Run: node scripts/tests/audience-safe.test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const S = require(path.join(ROOT, 'audience-safe.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const EVIL = '<img src=x onerror=alert(1)>hi';
const SAFE = '‹img src=x onerror=alert(1)›hi';
const noTag = v => !/[<>]/.test(JSON.stringify(v));

console.log('\nAudience-writable session data is neutralised at every depth');
for (const sub of ['responses', 'qa', 'teams', 'attempts', 'study']) {
  ok(`sessions/C/${sub} (leaf)`, S.scoped(`sessions/C/${sub}/q/u/answer`, EVIL) === SAFE);
  ok(`sessions/C/${sub} (subtree)`, noTag(S.scoped(`sessions/C/${sub}`, { q: { u: { answer: EVIL, name: EVIL } } })));
}
const session = { responses: { q: { u: { answer: EVIL } } }, qa: { x: { text: EVIL } }, meta: { title: '<b>deck</b>' } };
const whole = S.scoped('sessions/C', session);
ok('whole session: audience parts clean', noTag(whole.responses) && noTag(whole.qa));
ok('whole session: presenter meta untouched', whole.meta.title === '<b>deck</b>');
const all = S.scoped('sessions', { C: session });
ok('all sessions: audience parts clean', noTag(all.C.responses) && all.C.meta.title === '<b>deck</b>');
ok('full URL form (what ref.toString() returns)',
  S.scoped('https://x-default-rtdb.firebaseio.com/sessions/C/responses/q/u/name', EVIL) === SAFE);
ok('percent-encoded path segment', S.scoped('sessions/C/%72esponses/q', EVIL) === SAFE);

console.log('\nLoopSlide — every byte under these trees is a player\'s');
for (const t of ['loop_answers', 'loop_scores', 'loop_react']) {
  ok(`${t} leaf`, S.scoped(`${t}/CODE/p/k/pid/n`, EVIL) === SAFE);
  ok(`${t} whole tree`, noTag(S.scoped(t, { CODE: { p: { pid: { n: EVIL } } } })));
}

console.log('\nUser archives are cleaned; the rest of a user\'s data is not');
const user = S.scoped('users/U', { archives: { a: { n: EVIL } }, presentations: { p: { t: '<i>mine</i>' } } });
ok('archives cleaned', noTag(user.archives));
ok('presentations untouched', user.presentations.p.t === '<i>mine</i>');
ok('users/U/archives direct', S.scoped('users/U/archives/a/n', EVIL) === SAFE);

console.log('\nPresenter-authored data is never changed');
ok('quiz_builder questions', S.scoped('quiz_builder/C/questions/0/text', '<b>x</b>') === '<b>x</b>');
ok('session meta', S.scoped('sessions/C/meta/title', '<b>x</b>') === '<b>x</b>');
ok('loops (deck definition) untouched', S.scoped('loops/CODE/title', '<b>x</b>') === '<b>x</b>');

console.log('\nValues that must survive exactly');
ok('choice answer JSON still parses', JSON.parse(S.scoped('sessions/C/responses/q/u/answer', '[0,2]')).length === 2);
ok('quotes are kept (JSON answers)', S.scoped('sessions/C/responses/q/u/answer', '"a"') === '"a"');
ok('numbers untouched', S.scoped('sessions/C/responses/q/u/elapsed', 900) === 900);
ok('null untouched', S.scoped('sessions/C/responses', null) === null);
ok('booleans untouched', S.scoped('loop_answers/C/p/k/pid/x', true) === true);
ok('arrays keep being arrays', Array.isArray(S.scoped('sessions/C/responses/q', [EVIL])));

console.log('\nEvery page that reads the database loads the guard right after it');
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
let covered = 0;
for (const f of pages) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const db = html.search(/<script[^>]+firebase-database-compat\.js/);
  if (db < 0) continue;
  const guard = html.search(/<script[^>]+\/audience-safe\.js/);
  const between = guard > db ? html.slice(db, guard) : '';
  // Nothing but the database tag itself (and whitespace / an app-check style tag) may sit between them.
  const scriptsBetween = (between.match(/<script/g) || []).length;
  ok(`${f}: guard loads straight after the database script`, guard > db && scriptsBetween <= 2, { db, guard, scriptsBetween });
  covered++;
}
ok('found the app pages (sanity)', covered >= 16, covered);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
