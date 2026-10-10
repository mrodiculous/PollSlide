#!/usr/bin/env node
/* Every message the app pages build in code — toasts, dialogs, pop-ups, the join image — has
 * all ten translations (2026-10-11). These never sit on the page, so the browser sweep
 * (scripts/browser-i18n/sweep.js) cannot read them; scripts/browser-i18n/literals.js reads
 * every tr()/trf() literal instead. Also pins the fixes from the same day.
 * Run: node scripts/tests/messages-i18n.test.js */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'browser-i18n', 'literals.js')], { encoding: 'utf8' });
ok('every tr()/trf() message in the presenter, editor and audience screens has all ten translations', r.status === 0, (r.stdout || '').split('\n').slice(0, 5));

const P = read('presenter.html');
ok('the QR join image speaks the presenter\'s language', /tr\('Scan to answer'\)/.test(P) && /tr\('No phone\? Go to pollslide\.com\/join'\)/.test(P) && /trf\('code \{x\}'/.test(P));
ok('…and never draws its instructions in hard-coded English', !/fillText\('Scan to answer'/.test(P) && !/fillText\('No phone\?/.test(P));
ok('the copied join text is translated', /trf\('Scan the QR — or go to pollslide\.com\/join and enter code \{x\}'/.test(P));
ok('question-slide images wrap Japanese and Chinese, which have no spaces', /function canvasWrap\(/.test(P) && /canvasWrap\(ctx, q\.text/.test(P));
ok('…and set Arabic right to left', /function canvasRTL\(/.test(P) && /ctx\.direction = rtlQ \? 'rtl' : 'ltr'/.test(P));

const L = read('live.html');
ok('the big screen tags "Join at" for translation', /<span data-i18n>Join at<\/span>/.test(L));
ok('…and its full-screen tooltip is a real attribute, not text inside the title', !/title="[^"]*data-i18n-title"/.test(L));

ok('the LoopSlide rules page chooses the player\'s language', /I\.set\(I\.stored\('ql_viewer_lang'\) \|\| I\.nav\(\)\)/.test(read('rules.html')));
ok('the TV page translates its "browser too old" message up front', /I\.walk\(document\.getElementById\('old'\)\)/.test(read('tv.html')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
