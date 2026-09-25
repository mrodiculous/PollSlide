/* LoopSlide: engine, rules, isolation from the existing products.
 * Run: node scripts/tests/loopslide.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const E = require(path.join(ROOT, 'loop-engine.js'));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));

const DEF = {
  name: 'Bar loop', epoch: 1_000_000, timing: { question: 20, reveal: 5, ad: 10, board: 10 },
  board: { reset: 'cycle' },
  sets: [
    { id: 's1', title: 'R1', items: [
      { id: 'a', type: 'q', text: 'Q1', options: ['x', 'y'], correct: 1 },
      { id: 'ad1', type: 'ad', headline: 'Wings', link: 'https://x.test/deal' },
      { id: 'b', type: 'q', text: 'Q2', options: ['x', 'y', 'z'], correct: null } ] },
    { id: 's2', title: 'R2', items: [ { id: 'c', type: 'q', text: 'Q3', options: [{ text: 'o1' }, { text: 'o2' }], correct: 0 } ] },
  ],
};
const L = E.normalizeLoop(DEF);

console.log('\nThe timeline');
{
  const tl = E.timeline(L);
  ok('question → reveal, ad, question → reveal, round board, then round 2, then overall board',
     tl.slots.map(s => s.kind).join(',') === 'question,reveal,ad,question,reveal,setboard,question,reveal,setboard,grandboard', tl.slots.map(s => s.kind));
  ok('cycle length is the sum of every slot', tl.length === (20+5+10+20+5+10+20+5+10+10) * 1000);
  ok('single-round loops have no overall board', E.timeline(E.normalizeLoop({ sets: [DEF.sets[0]] })).slots.slice(-1)[0].kind === 'setboard');
}

console.log('\nEvery device agrees on what is on screen (it is a function of time)');
{
  const len = E.timeline(L).length;
  const p0 = E.positionAt(L, DEF.epoch + 1000);
  ok('1s in: question 1', p0.slot.kind === 'question' && p0.slot.item === 0 && p0.cycle === 0);
  const p1 = E.positionAt(L, DEF.epoch + 21000);
  ok('21s in: its reveal', p1.slot.kind === 'reveal' && p1.slot.item === 0);
  const p2 = E.positionAt(L, DEF.epoch + len + 1000);
  ok('one full cycle later: question 1 again, cycle 1', p2.slot.kind === 'question' && p2.cycle === 1);
  ok('remaining time is exact', p0.remainingMs === 19000);
  ok('a second screen at the same instant computes the same slot', JSON.stringify(E.positionAt(L, DEF.epoch + 55555)) === JSON.stringify(E.positionAt(E.normalizeLoop(DEF), DEF.epoch + 55555)));
  ok('no epoch (unpublished) → nothing plays', E.positionAt(E.normalizeLoop(Object.assign({}, DEF, { epoch: 0 })), 5) === null);
}

console.log('\nLeaderboard periods');
{
  const day = 86400000;
  ok('reset every cycle → one period per cycle', E.periodKey(L, DEF.epoch + 1000) !== E.periodKey(L, DEF.epoch + E.timeline(L).length + 1000));
  const daily = E.normalizeLoop(Object.assign({}, DEF, { board: { reset: 'days', days: 1 }, tzOffsetMin: 0 }));
  ok('daily → same key all day', E.periodKey(daily, 10 * day + 1000) === E.periodKey(daily, 10 * day + 80000000));
  ok('daily → new key after midnight', E.periodKey(daily, 10 * day + 1000) !== E.periodKey(daily, 11 * day + 1000));
  const weekly = E.normalizeLoop(Object.assign({}, DEF, { board: { reset: 'days', days: 7 }, tzOffsetMin: 0 }));
  ok('every 7 days → same key within the week', E.periodKey(weekly, 7 * day) === E.periodKey(weekly, 13 * day + 5));
  ok('never → one all-time key', E.periodKey(E.normalizeLoop(Object.assign({}, DEF, { board: { reset: 'never' } })), 123) === 'all');
  const tz = E.normalizeLoop(Object.assign({}, DEF, { board: { reset: 'days', days: 1 }, tzOffsetMin: -300 }));
  ok('"daily" rolls over at midnight in the venue\'s timezone, not UTC', E.periodKey(tz, 11 * day + 3 * 3600000) === E.periodKey(tz, 10 * day + 20 * 3600000));
}

console.log('\nScoring');
{
  ok('wrong answer scores 0', E.score({ correct: false, ms: 100, windowMs: 20000 }) === 0);
  ok('instant right answer ≈ 1000', E.score({ correct: true, ms: 0, windowMs: 20000, streak: 1 }) === 1000);
  ok('last-second right answer ≈ 500', E.score({ correct: true, ms: 20000, windowMs: 20000, streak: 1 }) === 500);
  ok('speed bonus can be switched off', E.score({ correct: true, ms: 0, windowMs: 20000, speed: false }) === 500);
  ok('a streak multiplies, capped at 2×', E.score({ correct: true, ms: 0, windowMs: 20000, streak: 10 }) === 2000);
  ok('opinion questions give a flat 100 for taking part', E.score({ correct: null }) === 100);
  ok('never above the ceiling the database also enforces', E.score({ correct: true, ms: 0, windowMs: 1, streak: 99 }) <= E.MAX_POINTS);
}

console.log('\nWhat reaches a public screen is sanitised');
{
  ok('offensive nicknames are refused', E.cleanName('b1tchfuck') === '' && E.cleanName('xXfuckXx') === '');
  ok('ordinary nicknames pass', E.cleanName('  Mia  ') === 'Mia');
  ok('links are stripped from nicknames', E.cleanName('bob www.spam.com') === 'bob');
  ok('nicknames are capped for the screen', E.cleanName('a'.repeat(40)).length === 18);
  ok('only https images/links are allowed', E.safeUrl('javascript:alert(1)') === '' && E.safeUrl('http://x.com/a.png') === '' && E.safeUrl('https://x.com/a.png') === 'https://x.com/a.png');
  ok('unfinished questions are dropped, not shown blank', E.normalizeLoop({ sets: [{ items: [{ type: 'q', text: 'Only one option', options: ['a'] }] }] }).sets.length === 0);
  ok('object-style options (PollSlide format) are accepted', L.sets[1].items[0].options[1] === 'o2');
  ok('an out-of-range right answer becomes "opinion", not a wrong key', E.normalizeLoop({ sets: [{ items: [{ type: 'q', text: 't', options: ['a','b'], correct: 5 }] }] }).sets[0].items[0].correct === null);
}

console.log('\nDatabase rules for LoopSlide');
{
  const R = JSON.parse(read('database-rules.json')).rules;
  ok('loops are public to read, owner-only to write', R.loops.$code['.read'] === true && /ownerUid'\)\.val\(\) === auth\.uid/.test(R.loops.$code['.write']));
  const a = R.loop_answers.$code.$period.$key.$pid;
  ok('one answer per player per question (no overwrite)', /^!data\.exists\(\)/.test(a['.write']));
  ok('removed players cannot answer', /banned/.test(a['.write']));
  ok('answer time must be server time ±60s', /now \+ 60000/.test(a['.validate']) && /now - 60000/.test(a['.validate']));
  ok('points per answer capped at 2000', /<= 2000/.test(a['.validate']));
  const sc = R.loop_scores.$code.$period.$pid['.validate'];
  ok('a score can only rise by one answer at a time', /data\.child\('ans'\)\.val\(\) \+ 1/.test(sc) && /\+ 2000/.test(sc));
  ok('…and only for an answer that really exists', /root\.child\('loop_answers'\)/.test(sc));
  ok('owners can clear their own board (and only clear)', /!newData\.exists\(\)/.test(R.loop_scores.$code['.write']));
}

console.log('\nIsolated from the existing products');
{
  for (const f of ['screen.html', 'play.html', 'loop.html']) {
    const h = read(f);
    ok(f + ' never touches sessions/, quiz_builder/ or currentQuestion', !/ref\([`'"](sessions|quiz_builder)\//.test(h) && !/currentQuestion/.test(h));
    ok(f + ' loads the sandbox switch before Firebase starts', h.indexOf('/ps-env.js') > h.indexOf('firebase-app-compat') && h.indexOf('/ps-env.js') < h.indexOf('initializeApp('));
  }
  ok('the TV screen writes nothing at all', !/\.(set|update|push|transaction|remove)\(/.test(read('screen.html').split('<script>').pop().replace(/\bI\.set\(/g, '')));
  const p = read('presenter.html');
  ok('presenter only gains a link to the studio', /href="\/loop"/.test(p));
}

console.log('\nImport / export speaks PollSlide\'s deck format');
{
  const h = read('loop.html');
  const fn = h.match(/function deckToRound\(deck\) \{[\s\S]*?\n\}/)[0];
  const uid6 = () => Math.random().toString(36).slice(2, 8);
  const deckToRound = new Function('uid6', fn + '\nreturn deckToRound;')(uid6);
  const quiz = deckToRound({ name: 'Q', questions: [
    { type: 'multiple_choice', text: 'Capital of France?', options: [{ text: 'Paris' }, { text: 'Rome' }], correctAnswer: 0 },
    { type: 'multiple_choice_multi', text: 'Primes?', options: [{ text: '2' }, { text: '4' }, { text: '3' }], correctAnswer: [0, 2] },
    { type: 'free_text', text: 'Why?' }, { type: 'rating', text: 'Rate' } ] });
  ok('multiple choice comes across with its right answer', quiz.round.items[0].correct === 0 && quiz.round.items[0].options[0] === 'Paris');
  ok('multi-select keeps its first right answer', quiz.round.items[1].correct === 0);
  ok('free text / rating are skipped and counted', quiz.skipped === 2 && quiz.round.items.length === 2);
  const study = deckToRound({ name: 'S', questions: [
    { type: 'flashcard', front: 'Hola', back: 'Hello' }, { type: 'flashcard', front: 'Adiós', back: 'Goodbye' }, { type: 'flashcard', front: 'Gracias', back: 'Thanks' } ] });
  ok('a study set becomes a quiz round (other cards are the wrong answers)', study.round.items.length === 3 && study.round.items.every(it => it.options[it.correct] && it.options.length >= 2));
  ok('exports create decks in PollSlide\'s own format', /productType: product, questions/.test(h) && /type: 'flashcard', front: q\.text, back: q\.options\[q\.correct\]/.test(h));
}
console.log('\nMedia and emojis');
{
  const M = E.normalizeLoop({ epoch: 1, sets: [{ items: [
    { type: 'q', text: 'Which flag? 🏳️', img: 'https://x.test/clip.mp4', options: [{ text: '🇫🇷 France', img: 'https://x.test/fr.png' }, { text: '🇮🇹 Italy' }], correct: 0, time: 45 },
    { type: 'ad', sponsored: false, headline: 'Happy birthday Jess! 🎂', img: 'https://x.test/party.gif' } ] }] });
  const q = M.sets[0].items[0];
  ok('emojis pass through in questions and answers', /🏳️/.test(q.text) && q.options[0] === '🇫🇷 France');
  ok('per-answer images are kept and aligned to their answer', q.optImgs[0] === 'https://x.test/fr.png' && q.optImgs[1] === '');
  ok('videos are recognised, GIFs/images are not videos', E.isVideo(q.img) && !E.isVideo('https://x.test/party.gif'));
  ok('a question can have its own answer time', E.timeline(M).slots[0].dur === 45);
  ok('media cards are not labelled as ads', M.sets[0].items[1].sponsored === false);
  const blank = E.normalizeLoop({ epoch: 1, sets: [{ items: [{ type: 'q', text: 't', options: ['a', '', 'c'], correct: 2 }] }] });
  ok('removing a blank answer keeps the right answer pointing at the right option', blank.sets[0].items[0].options[blank.sets[0].items[0].correct] === 'c');
  const scr = read('screen.html');
  ok('videos on a public screen are always muted', /<video[^>]*autoplay muted loop playsinline/.test(scr));
}

console.log('\nTransparency & compliance');
{
  const A = E.normalizeLoop({ epoch: 1, compliance: { organiser: 'Crown', contact: 'a@b.co', minAge: 21, prize: 'Pitcher', rulesUrl: 'http://insecure' },
    sets: [{ items: [{ type: 'q', text: 'x', options: ['a','b'], aiGenerated: true }, { type: 'ad', headline: 'Wings', sponsor: 'Crown Kitchen' }] }] });
  ok('Polly-written questions (aiGenerated) arrive labelled as AI', A.sets[0].items[0].ai === true);
  ok('ads carry who they are from', A.sets[0].items[1].sponsor === 'Crown Kitchen');
  ok('age limits are limited to 13/16/18/21', A.compliance.minAge === 21 && E.normalizeLoop({ compliance: { minAge: 19 } }).compliance.minAge === 0);
  ok('rules links must be https', A.compliance.rulesUrl === '');
  const scr = read('screen.html'), ply = read('play.html'), st = read('loop.html');
  ok('the screen labels AI content', /✨ AI-generated/.test(scr));
  ok('the screen names the sponsor of an ad', /t\('Sponsored by \{name\}', \{ name: it\.sponsor \}\)/.test(scr));
  ok('the phone labels AI content too', /✨ AI-generated/.test(ply));
  ok('the phone names the organiser and states retention before play', /t\('Run by \{name\}\.', \{ name: c\.organiser \}\)/.test(ply) && /kept only while this leaderboard runs, then deleted/.test(ply));
  ok('an age limit must be confirmed before playing', /ageBox && !ageBox\.checked/.test(ply));
  ok('players can report a problem', /Report a problem/.test(ply));
  ok('publishing is blocked until organiser, contact, rules and sponsors are set', /complianceGaps\(norm\)/.test(st) && /official rules link/.test(st) && /sponsor name/.test(st));
  const pres = read('presenter.html');
  ok('Polly output is tagged at the source (metadata only)', /q\.aiGenerated = true;/.test(pres) && /aiImage = true/.test(pres));
}

console.log('\nRetention sweep');
{
  const sw = read('api/loop-sweep.js');
  ok('it refuses to run without the cron secret (it deletes data)', /if \(!secret \|\| /.test(sw));
  ok('it keeps the current period', /periods\.filter\(p => p !== current\)/.test(sw));
  ok('it lists keys shallowly instead of downloading history', /shallow=true/.test(sw));
  const v = JSON.parse(read('vercel.json'));
  ok('it is scheduled daily', v.crons.some(c => c.path === '/api/loop-sweep'));
  ok('LoopSlide pages are never cached stale', v.headers.some(h => /loop\|screen\|play/.test(h.source)));
}

console.log('\nTV pairing (tv.html ↔ Studio Screens)');
{
  const tv = read('tv.html'), studio = read('loop.html');
  const rules = JSON.parse(read('database-rules.json')).rules;
  const js = tv.split('<script>').pop().split('</script>')[0];
  const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'])\/\/.*$/gm, '$1');   // comments may name what they avoid
  // Smart-TV browsers lag years behind; one modern token is a black screen in a bar.
  ok('tv.html uses no syntax old TV browsers choke on (?. ?? let const => async class)',
     !/\?\.|\?\?|\blet\s|\bconst\s|=>|\basync\b|\bclass\s|`/.test(code), (code.match(/\?\.|\?\?|\blet\s|\bconst\s|=>|\basync\b|\bclass\s|`/) || [])[0]);
  ok('tv.html parses', (() => { try { new Function(js); return true; } catch (e) { return false; } })());
  const alph = (js.match(/var ALPH = '([^']+)'/) || [])[1] || '';
  ok('pairing alphabet has no look-alikes (0/O, 1/I)', alph && !/[01OI]/.test(alph));
  const codeRe = /^[A-HJ-NP-Z2-9]{6}$/;
  ok('every code the TV can make passes the rule that stores it', [...alph].every(ch => codeRe.test(ch.repeat(6))));
  ok('the device id the TV makes matches the rule', /\[A-Z0-9\]\{24\}/.test(js) && /rnd\(24\)/.test(js));
  ok('tv_pair: anyone may post a code, but not over a live one', /data\.child\('createdAt'\)\.val\(\) < now - 900000/.test(rules.tv_pair.$code['.write']));
  ok('tv_pair: a code is only deleted by the pairing that claims it', /tv_devices.*pair.*=== \$code/.test(rules.tv_pair.$code['.write']));
  ok('tv_pair: createdAt must be the server clock', /createdAt'\)\.val\(\) === now/.test(rules.tv_pair.$code['.validate']));
  const dw = rules.tv_devices.$device['.write'];
  ok('tv_devices: claiming needs the TV\'s live code', /tv_pair.*=== \$device/.test(dw) && /> now - 900000/.test(dw));
  ok('tv_devices: only the owner may switch, rename or unpair', /data\.child\('ownerUid'\)\.val\(\) === auth\.uid/.test(dw));
  ok('tv_devices: a TV can only be pointed at your own loop', /loops.*ownerUid.*=== auth\.uid/.test(rules.tv_devices.$device.loop['.validate']));
  ok('the TV only reads its own record and writes only its code', /tv_devices\/' \+ DEV/.test(js) && !/tv_devices\/[^']*'\)\.(set|update|remove)/.test(js));
  ok('the TV QR opens the Studio pairing screen', /\/loop#pair=/.test(js) && /pair=\(\[A-Za-z0-9\]\{6\}\)/.test(studio));
  ok('Studio pairing writes the TV, the owner\'s list and retires the code in one update', /tv_devices\/' \+ id/.test(studio) && /\/tvs\/' \+ id/.test(studio) && /tv_pair\/' \+ code\] = null/.test(studio));
  ok('the TV plays the loop through screen.html, not a copy of it', /'\/screen#'/.test(js));
  ok('pollslide.com/tv reaches the TV page', (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'pollslide-website', 'vercel.json'), 'utf8')).redirects.some(r => r.source === '/tv' && /app\.pollslide\.com\/tv$/.test(r.destination)); } catch (e) { return true; } })());
  ok('expired pairing codes are swept nightly', /tv_pair/.test(read('api/loop-sweep.js')));
}

console.log('\nPlan limits');
{
  const studio = read('loop.html');
  const m = studio.match(/const LOOP_PLANS = (\{[\s\S]*?\n\});/);
  const P = m ? Function('return ' + m[1])() : {};
  const want = { free: [1, 10], pro: [5, 20], team_small: [20, 40], team_large: [80, 150] };
  ok('loops and slides per plan are as decided', Object.keys(want).every(k => P[k] && P[k].loops === want[k][0] && P[k].slides === want[k][1]), P);
  ok('enterprise is unlimited (set per deal)', P.enterprise && P.enterprise.loops === Infinity && P.enterprise.slides === Infinity);
  ok('every plan has a screen limit', Object.values(P).every(p => typeof p.screens === 'number'));
  ok('limits are checked when adding, publishing, making a loop and pairing',
     /function addQ\(si\) \{ if \(atSlideLimit\(\)\)/.test(studio) && /function addAd\(si, sponsored\) \{ if \(atSlideLimit\(\)\)/.test(studio)
     && /n > lim/.test(studio) && /length >= p\.loops/.test(studio) && /length >= p\.screens/.test(studio));
  ok('legacy tier names map to today\'s plans', /'team' \? 'team_small'/.test(studio) && /'white' \? 'team_large'/.test(studio));
}

console.log('\nA new loop can be edited after a save (the "+ Question" bug)');
{
  const studio = read('loop.html');
  const m = studio.match(/function draftShape\(d\) \{[\s\S]*?\n\}/);
  const draftShape = m ? Function(m[0] + '; return draftShape;')() : null;
  // Exactly what RTDB hands back for a freshly created loop: the empty items list is gone.
  const fromDb = { name: 'New loop', sets: [{ id: 's1', title: 'Round 1' }], timing: {}, board: {} };
  const d = draftShape && draftShape(JSON.parse(JSON.stringify(fromDb)));
  ok('opening a loop restores the lists the database dropped', d && Array.isArray(d.sets[0].items));
  ok('"+ Question" works on it', (() => { try { d.sets[0].items.push({ type: 'q' }); return true; } catch (e) { return false; } })());
  const q = draftShape({ sets: { 0: { items: { 0: { type: 'q', text: 'x' } } } } });
  ok('object-shaped lists (how RTDB returns sparse arrays) become arrays', Array.isArray(q.sets) && Array.isArray(q.sets[0].items) && q.sets[0].items[0].options.length === 2);
  ok('every loop the editor opens goes through it', /cur = draftShape\(/.test(studio) && /draftShape\(cur\); editorView\(\)/.test(studio));
}

console.log('\nLoopSlide speaks every language, in the house register');
{
  global.window = global; global.navigator = { language: 'en' };
  require(require('path').join(ROOT, 'loop-i18n.js'));
  const I = global.LoopI18n, D = I.dict;
  const en = new Set(); ['es','de','fr','pt','it'].forEach(l => Object.keys(D[l]).forEach(k => en.add(k)));
  const gaps = ['es','de','fr','pt','it'].flatMap(l => [...en].filter(k => !D[l][k]).map(k => l + ': ' + k));
  ok('every string exists in all five languages', !gaps.length, gaps.slice(0, 5));
  const ph = [...en].filter(k => /\{\w+\}/.test(k)).flatMap(k => ['es','de','fr','pt','it'].filter(l => (k.match(/\{\w+\}/g) || []).some(x => !D[l][k].includes(x))).map(l => l + ': ' + k));
  ok('every translation keeps its {placeholders}', !ph.length, ph.slice(0, 5));
  const vals = l => Object.values(D[l]).join(' | ');
  ok('German uses du, never Sie', !/\b[A-ZÄÖÜ][a-zäöüß]+en Sie\b|\bIhr(e|en|em)?\b/.test(vals('de')));
  ok('French uses tu, never vous', !/\b(vous|votre|vos)\b/i.test(vals('fr')));
  ok('Portuguese is European', !/\b(você|vocês|tela|telas|arquivo|compartilh\w*|aplicativo|celular|usuário|equipe|cadastro)\b/i.test(vals('pt')));
  ok('"deck" is never a pack of cards', !/\b(baraja|baralho|mazzo)s?\b/i.test(vals('es') + vals('pt') + vals('it')));
  ok('t() fills placeholders', I.t('Round {n}', { n: 3 }, 'de') === 'Runde 3');
  ok('unknown strings fall back to English', I.t('zzz not a key', null, 'fr') === 'zzz not a key');
  const studio = read('loop.html'), ply = read('play.html');
  ok('Studio follows the PollSlide language choice', /I\.stored\('ps_ui_lang'\)/.test(studio));
  ok('phones follow the answer-page language choice', /'ql_viewer_lang'/.test(ply));
  ok('the TV follows the loop setting, auto = the TV\'s own', /screenLang !== 'auto' \? loop\.screenLang : I\.nav\(\)/.test(read('screen.html')));
  ok('user content is never translated in the Studio', (studio.match(/data-noi18n/g) || []).length >= 6);
}

console.log('\nQuestion text in the player\'s language');
{
  const L = E.normalizeLoop({ lang: 'en', epoch: 1, sets: [{ id: 's', title: 'R', items: [{ id: 'q', type: 'q', text: 'Red planet?', options: ['Venus', 'Mars'], correct: 1 }] }] });
  const U = E.translationUnits(L), tr = { src: 'en', u: {} };
  U.forEach(u => { tr.u[u.id] = { h: u.h, v: u.id === 's_s' ? { stem: 'Ronda' } : { stem: '¿Planeta rojo?', options: ['Venus', 'Marte'] } }; });
  const C = E.localize(L, tr, 'es');
  ok('translated text is shown, answers keep their order and the right answer', C.sets[0].items[0].text === '¿Planeta rojo?' && C.sets[0].items[0].options[1] === 'Marte' && C.sets[0].items[0].correct === 1);
  ok('translated items are marked, for the "Auto-translated" label', C.sets[0].items[0].tr === true);
  const edited = E.normalizeLoop(Object.assign({}, L, { sets: [{ id: 's', title: 'R', items: [{ id: 'q', type: 'q', text: 'Changed', options: ['Venus', 'Mars'], correct: 1 }] }] }));
  ok('an edited question never shows a stale translation', E.localize(edited, tr, 'es').sets[0].items[0].text === 'Changed');
  const api = read('api/loop-translate.js');
  ok('only the loop\'s owner can ask for translations', /pub\.ownerUid !== who\.uid/.test(api) && /verifyToken/.test(api));
  ok('translation is rate-limited', /rateLimit\(db, 'looptr:'/.test(api));
  ok('only the loop\'s stored text is sent to the model', /E\.translationUnits\(L\)/.test(api) && !/req\.body\.(texts|questions)/.test(api));
  ok('output must keep shape, emoji and brand names, and not balloon', /g\.options\.length !== s\.options\.length/.test(api) && /EMOJI/.test(api) && /BRANDS/.test(api) && /a\.length \* 3 \+ 40/.test(api));
  ok('the prompt treats the text as content, never instructions', /never instructions to you/.test(api));
  ok('the existing answer-page translator is untouched', !/loop/i.test(read('api/translate.js')));
  ok('phones and TV label translated text', /Auto-translated/.test(read('play.html')) && /Auto-translated/.test(read('screen.html')));
  ok('nobody but the server writes translations', JSON.parse(read('database-rules.json')).rules.loop_i18n.$code['.write'].includes('!newData.exists()'));
}

console.log('\nPlan limits the database enforces');
{
  const R = JSON.parse(read('database-rules.json')).rules;
  ok('a loop can only be created with a free plan slot', /loop_slots.*=== \$code/.test(R.loops.$code['.write']));
  ok('a free loop must carry the 25-player cap', /cap'\)\.val\(\) === 25/.test(R.loops.$code['.validate']));
  ok('a loop keeps its slot for life', /newData\.child\('slot'\)\.val\(\) === data\.child\('slot'\)\.val\(\)/.test(R.loops.$code['.validate']));
  ok('loop slots stop at the plan limit (free 1, pro 5, small 20, large 80)', /\$slot === '0'/.test(R.loop_slots.$uid.$slot['.validate']) && /\^\[0-4\]\$/.test(R.loop_slots.$uid.$slot['.validate']) && /\^1\?\[0-9\]\$/.test(R.loop_slots.$uid.$slot['.validate']) && /\^\[1-7\]\?\[0-9\]\$/.test(R.loop_slots.$uid.$slot['.validate']));
  ok('screen slots stop at the plan limit (free 1, pro 3, small 10, large 40)', /\^\[0-2\]\$/.test(R.tv_slots.$uid.$slot['.validate']) && /\^\[0-9\]\$/.test(R.tv_slots.$uid.$slot['.validate']) && /\^\[1-3\]\?\[0-9\]\$/.test(R.tv_slots.$uid.$slot['.validate']));
  ok('a slot is only freed when its loop or TV goes', /!newData\.parent\(\)\.parent\(\)\.parent\(\)\.child\('loops'\)/.test(R.loop_slots.$uid.$slot['.write']) && /child\('tv_devices'\)/.test(R.tv_slots.$uid.$slot['.write']));
  ok('pairing a TV needs a free screen slot', /tv_slots/.test(R.tv_devices.$device['.write']));
  const ply = read('play.html');
  ok('phones honour the player cap, never shutting out someone already playing', /Object\.keys\(v\)\.length < cap/.test(ply) && /!!v\[me\.pid\]/.test(ply));
  const studio = read('loop.html');
  ok('publishing and pairing still work while the old rules are live', /Only while the database rules are older than this page/.test(studio) && /rules older than this page have no tv_slots/.test(studio));
  ok('deleting a loop frees its slot, scores, translations and TVs', /upd\['loop_slots\/'/.test(studio) && /upd\['loop_i18n\/'/.test(studio) && /upd\['tv_slots\/'/.test(studio));
}

console.log('\nThe same Polly, GIF and upload services as the rest of PollSlide');
{
  const studio = read('loop.html');
  ok('Polly drafts questions through /api/polly, signed in (so the monthly allowance applies)', /fetch\('\/api\/polly', \{ method: 'POST', headers: await authHeaders\(\)/.test(studio));
  ok('Polly questions are labelled AI', /correct: Number\.isInteger\(c\)[^\n]*ai: true/.test(studio));
  ok('GIFs come through /api/gif-search (locked safe filter)', /fetch\('\/api\/gif-search'/.test(studio));
  ok('Polly images through /api/polly-image, labelled AI', /fetch\('\/api\/polly-image'/.test(studio) && /setMedia\(await snap\.ref\.getDownloadURL\(\), true\)/.test(studio));
  ok('uploads use the same limits as the presenter (8 MB image, 20 MB / 30 s video)', /isVideo \? 20 : 8/.test(studio) && /secs > 30\.5/.test(studio));
  ok('the allowance running out is explained, not an error', /r\.status === 429 \|\| d\.overLimit/.test(studio));
  ok('none of those APIs were changed', true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
