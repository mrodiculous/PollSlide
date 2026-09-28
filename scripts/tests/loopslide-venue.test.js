/* LoopSlide venue fixes (2026-09-27), from Rod testing on a real TV:
 *   • the pairing code ran under the QR on tv.html          • answers cut off before the reveal
 *   • logo: upload OR link                                  • official rules hosted by PollSlide
 *   • an easy way to stop a loop                            • "keep the answer secret" reveal
 * Run: node scripts/tests/loopslide-venue.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
global.window = global;
require(path.join(ROOT, 'loop-i18n.js')); require(path.join(ROOT, 'loop-engine.js'));
const E = window.LoopEngine;

console.log('\nTV pairing code is never under the QR');
const tv = read('tv.html');
ok('the text column takes the space the QR leaves (no 62vw cap)', /\.left \{[^}]*flex:1 1 auto; min-width:0;/.test(tv) && !/\.left \{ max-width:62vw; \}/.test(tv));
ok('the QR never shrinks', /\.qrbox \{ flex:0 0 auto; \}/.test(tv));
ok('the code is sized to the space beside the QR', /\.code \{ font-size:min\(12vmin, calc\(\(100vw - 12vmin - 7vmin - 38vmin\) \/ 11\)\); \}/.test(tv));
ok('…and fitCode() shrinks it on any TV where it still would not fit', /function fitCode\(\)/.test(tv) && /fitCode\(\);\s*\n\s*var box = \$\('qr'\)/.test(tv));
ok('tv.html stays old-fashioned JS for old TV browsers (no arrow functions in fitCode)', !/function fitCode\(\)[\s\S]{0,600}=>/.test(tv.slice(tv.indexOf('function fitCode'), tv.indexOf('function newCode'))));

console.log('\nEvery answer fits on the TV');
const scr = read('screen.html');
ok('the stage is held to the screen height', /grid-template-rows:minmax\(0,1fr\)/.test(scr));
ok('the question picture is what shrinks', /\.qimg \{[^}]*min-height:0; flex:0 1 auto;/.test(scr) && /#main > \*:not\(\.qimg\)/.test(scr));
ok('fitMain() tightens, then drops the picture, and re-runs when pictures load', /function fitMain\(\)/.test(scr) && /classList\.add\('tight'\)/.test(scr) && /addEventListener\('load', fitMain/.test(scr));
ok('every screen draw is fitted', /function main\(html\) \{[^}]*fitMain\(\);/.test(scr));

console.log('\nLogo: upload or link');
const st = read('loop.html');
ok('the Studio offers Upload beside the link', /onclick="logoUpload\(\)"/.test(st) && /Logo — upload it, or paste a link/.test(st));
ok('uploads are images up to 2 MB, in the user\'s own storage', /function logoUpload\(\)[\s\S]{0,700}2 \* 1024 \* 1024[\s\S]{0,400}users\/\$\{user\.uid\}\/images\/logo_/.test(st));

console.log('\nOfficial rules, hosted');
const L = E.normalizeLoop({ compliance: { rulesMode: 'hosted', rulesTitle: 'T', rulesText: 'x'.repeat(25000) } });
ok('the engine keeps hosted rules, capped at 20,000 characters', L.compliance.rulesMode === 'hosted' && L.compliance.rulesText.length === 20000);
const L2 = E.normalizeLoop({ compliance: { rulesUrl: 'https://x.com/r', rulesText: 'secret' } });
ok('a link-mode loop carries no rules text', L2.compliance.rulesMode === 'link' && L2.compliance.rulesText === '' && L2.compliance.rulesUrl === 'https://x.com/r');
ok('publishing makes the hosted page the rules link', /norm\.compliance\.rulesUrl = norm\.compliance\.rulesText\.trim\(\)\.length >= 40 \? APP \+ '\/rules#' \+ curCode/.test(st));
ok('publishing is refused while the template\'s [brackets] are unfilled', /Fill in the \[brackets\] in your official rules\./.test(st));
ok('rules are saved to the organiser\'s own library and can be picked again', /users\/' \+ user\.uid \+ '\/loop_rules/.test(st) && /function pickRules\(/.test(st));
ok('the template exists in all six languages', ['en', 'es', 'de', 'fr', 'pt', 'it'].every(l => new RegExp('\\n    ' + l + ': \\[`1\\. ').test(st)));
ok('new loops default to hosted rules', /rulesUrl: '', aiNote: false, rulesMode: 'hosted' \}/.test(st));
const rules = read('rules.html');
ok('rules.html shows the text escaped, never as HTML', /esc\(p\.trim\(\)\)/.test(rules) && !/innerHTML = c\.rulesText/.test(rules));
ok('…says whose rules they are and that PollSlide is not the organiser', /it is not the organiser/.test(rules));
ok('…and offers a way to report the page', /Report this page/.test(rules));

console.log('\nStop / start a loop');
ok('Studio has ⏸ Stop showing / ▶ Start showing, on the card and in the editor', (st.match(/setStopped\('/g) || []).length >= 4);
ok('publishing changes never restarts a stopped loop', /stopped: \(prev && prev\.stopped\) \|\| null/.test(st));
ok('the TV shows the venue\'s name and "Back soon!"', /if \(v\.stopped\)/.test(scr) && /Back soon!/.test(scr));
ok('phones say the game is paused', /if \(v\.suspended \|\| v\.stopped\)/.test(read('play.html')));

console.log('\nKeep the answer secret');
ok('the engine accepts reveal: winners (anything else = answer)', E.normalizeLoop({ extras: { reveal: 'winners' } }).extras.reveal === 'winners' && E.normalizeLoop({ extras: { reveal: 'x' } }).extras.reveal === 'answer');
ok('the TV shows who got it right and the fastest, without marking an option', /function drawWinnersOnly\(/.test(scr) && !/class="opt/.test(scr.slice(scr.indexOf('function drawWinnersOnly'), scr.indexOf('function drawAd'))));
const play = read('play.html');
ok('phones never name the answer in secret mode', /secret \? esc\(t\('Try again next time round\.'\)\)/.test(play) && /secret \? esc\(t\('Catch it next time round\.'\)\)/.test(play));

console.log('\nGIFs for everything in LoopSlide');
ok('one click for the whole loop, and one per round', /onclick="gifsView\(null\)"/.test(st) && /onclick="gifsView\(\$\{si\}\)"/.test(st));
ok('only EMPTY boxes are filled — the venue\'s own pictures are never replaced', /if \(sl\.f === 'img'\) \{ if \(it\.img\) continue;/.test(st) && /if \(it\.optImgs\[oi\]\) continue;/.test(st));
ok('every answer gets one (so no picture gives the right one away)', /PSGifs\.answerTerm\(o, \{ seed: it\.id \+ ':o' \+ oi, correct: false \}\)/.test(st));
ok('it stops cleanly at the GIF search\'s hourly limit', /if \(res\.status === 429\) \{ quota = true; break; \}/.test(st));
ok('"Remove" takes away only what it added', /function gifsRemove\(/.test(st) && /it\.img === g\.img/.test(st));
ok('a Polly draft can arrive with GIFs already on it', /id="pyGifs" checked/.test(st) && /if \(_wantGifs\) fillGifs\(/.test(st));
ok('GIPHY is credited', /Powered by GIPHY/.test(st.slice(st.indexOf('function gifsView'))));

console.log('\nPolly: one OpenAI model for knowledge, the Mac for the rest');
const pol = read('api/polly.js'), cop = read('api/copilot.js');
ok('with an OpenAI key, OpenAI writes first; the Mac is the fallback', /const PREFER_CLOUD = !!process\.env\.OPENAI_API_KEY;/.test(pol) && /if \(PREFER_CLOUD\) \{\s*try \{ return await viaCloud\(\); \}/.test(pol));
ok('questions, decks and Co-pilot all use the one model, OPENAI_TEXT_MODEL', /const deckCloud = async[\s\S]{0,200}model: OPENAI_TEXT_MODEL/.test(pol) && /baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL, messages, timeoutMs: budget/.test(pol) && /const preferCloud = !!OPENAI_API_KEY;/.test(cop));
ok('the fact-check uses the same OpenAI model and never the Mac', /flags = await tryOne\(\{ baseURL: OPENAI_BASE, apiKey: OPENAI_API_KEY, model: OPENAI_TEXT_MODEL \}\)/.test(pol) && !/tryOne\(\{ baseURL: LOCAL_LLM_URL/.test(pol));
ok('no extra model settings to track', !/POLLY_MODEL|POLLY_BASE_URL|POLLY_PREFER|GEMINI_API_KEY|POLLY_CHECK_MODEL|POLLY_LOCAL_CHECK_MODEL/.test(pol + cop + read('api/watchdog.js')));
ok('text-only jobs stay Mac-first (translation, themes, summaries/grading)', ['api/translate.js', 'api/loop-translate.js', 'api/insights.js', 'api/ai.js'].every(f => !/PREFER_CLOUD|preferCloud/.test(read(f))));

console.log('\nEvery new phrase is in all six languages');
const I = window.LoopI18n;
const phrases = ['🎞 GIFs for everything', 'Remove the GIFs we added ({n})', 'Finding GIFs… {k} of {n}', '⏸ Stop showing', 'Back soon!', 'Only who got it right and the fastest — keep the answer secret', 'Write them here — PollSlide hosts them',
  'Fill in the [brackets] in your official rules.', 'Report this page', '{n} of {m} got it right'];
const missing = [];
for (const l of ['es', 'de', 'fr', 'pt', 'it']) { I.set(l); for (const p of phrases) if (I.t(p) === p) missing.push(l + ': ' + p); }
ok('translated', !missing.length, missing.slice(0, 4));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
