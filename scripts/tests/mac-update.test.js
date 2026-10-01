#!/usr/bin/env node
/* Mac companion update notice (2026-10-01). The app has no updater, so the page it shows
 * (companion.html) tells old copies a new version exists — on the waiting screen only, never
 * over live results (which may be on a projector). Run: node scripts/tests/mac-update.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const C = fs.readFileSync(path.join(ROOT, 'companion.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const grab = name => { const i = C.indexOf('function ' + name + '('); let d = 0, j = C.indexOf('{', i); for (; j < C.length; j++) { if (C[j] === '{') d++; else if (C[j] === '}' && !--d) break; } return C.slice(i, j + 1); };
const ctx = {}; vm.createContext(ctx); vm.runInContext(grab('verLess'), ctx);
console.log('\nMac companion: who is told to update');
ok('1.3.4 < 1.3.5', ctx.verLess('1.3.4', '1.3.5'));
ok('1.3.5 is not older than 1.3.5', !ctx.verLess('1.3.5', '1.3.5'));
ok('1.4 > 1.3.9 (numeric, not alphabetical)', !ctx.verLess('1.4', '1.3.9') && ctx.verLess('1.3.9', '1.4'));
ok('1.3.10 > 1.3.9', ctx.verLess('1.3.9', '1.3.10'));
ok('the Mac app is recognised by ?cb= (every version adds it); no v = 1.3.4', /const MAC_APP = _qs\.has\('cb'\);/.test(C) && /_qs\.get\('v'\) \|\| \(MAC_APP \? '1\.3\.4' : null\)/.test(C));
// definition + the waiting screen + "already on the waiting screen" — and nowhere else
ok('only on the waiting screen — never over live results', (C.match(/macUpdateNote\(\)/g) || []).length === 3 && /<\/div><\/div>` \+ macUpdateNote\(\);/.test(grab('showWaiting')) && /querySelector\('#body \.waiting'\)/.test(C));
ok('"Later" snoozes it for 3 days', /ps_mac_update_snooze',Date\.now\(\)\+3\*864e5/.test(C));
// The Mac app's source lives outside this repo (Rod's Mac); checked when it is there.
const SW = path.resolve(require('os').homedir(), 'Downloads', 'PollSlide', 'xCode App Companion Pollslide', 'PollSlideCompanion', 'PollSlideCompanion', 'PairingView.swift');
if (fs.existsSync(SW)) ok('the app (1.3.5+) sends its version to the page', /companion\?cb=\\\(cb\)&v=\\\(AppInfo\.version\)&lang=\\\(L10n\.current\)#/.test(fs.readFileSync(SW, 'utf8')));
else console.log('  (Mac app source not on this machine — skipped)');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
