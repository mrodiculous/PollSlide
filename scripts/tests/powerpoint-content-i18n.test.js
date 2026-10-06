#!/usr/bin/env node
/* PollSlide LIVE speaks PowerPoint's language (2026-09-29).
 *
 * The add-in reads Office.context.displayLanguage and shows its own words in es/de/fr/pt/it;
 * anything else is English. This proves, against the real page in headless Chrome:
 *   1. every tr('…') phrase in the page has a translation in every language, with the same
 *      {placeholders} — so no screen can fall back to half-English;
 *   2. English (and any unsupported language) renders word for word as before;
 *   3. each language renders the sign-in, "not linked" and live screens translated, with no
 *      leftover English phrase from the add-in's own vocabulary.
 * Skips the browser part (passes) if Chrome is absent.
 *
 * Run: node scripts/tests/powerpoint-content-i18n.test.js */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')));
const page = fs.readFileSync(path.join(ROOT, 'powerpoint-content', 'index.html'), 'utf8');
const LANGS = ['es', 'de', 'fr', 'pt', 'it'];

console.log('\nPollSlide LIVE: languages — the phrase book');
const m = page.match(/const L10N = (\{.*?\});\n/);
ok('the phrase book is in the page', !!m);
const L10N = m ? JSON.parse(m[1]) : {};
const used = new Set([...page.matchAll(/tr\('((?:[^'\\]|\\.)+)'/g)].map(x => x[1]));
// plural pairs passed as tr(cond ? 'a' : 'b')
for (const x of page.matchAll(/tr\(one\([\w.]+\)\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) { used.add(x[1]); used.add(x[2]); }
ok('the page uses the phrase book (40+ phrases)', used.size >= 40, used.size);
const ph = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
for (const l of LANGS) {
  const t = L10N[l] || {};
  const missing = [...used].filter(k => !(k in t));
  ok(`${l}: every phrase the page shows is translated`, missing.length === 0, missing);
  const badPh = Object.keys(t).filter(k => ph(k) !== ph(t[k]));
  ok(`${l}: every {placeholder} kept`, badPh.length === 0, badPh);
  const empty = Object.keys(t).filter(k => !String(t[k]).trim());
  ok(`${l}: no empty translations`, empty.length === 0, empty);
  ok(`${l}: same phrases as Spanish`, Object.keys(t).sort().join('|') === Object.keys(L10N.es).sort().join('|'));
}
ok('language comes from PowerPoint (Office.context.displayLanguage)', /Office\.context\.displayLanguage/.test(page));
ok('language is set before anything is drawn', /Office\.onReady\(async \(\) => \{\n  detectLang\(\);/.test(page));

console.log('\n Word clouds keep accented words (fantástico, Größe, réussite) — every renderer');
for (const f of ['presenter.html', 'live.html', 'companion.html', 'powerpoint-content/index.html']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  ok(`${f}: no ASCII-only word cleaning`, !/toLowerCase\(\)\.replace\(\/\[\^a-z0-9/.test(src));
}
const clean = s => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
ok('fantástico / Größe / réussite / ação survive; English unchanged',
  ['fantástico', 'größe', 'réussite', 'ação', 'exciting', "don't", 'q4'].join() === ['Fantástico!', 'Größe', 'réussite,', 'ação.', 'Exciting!', "don't", 'Q4,'].map(clean).join());

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!CHROME) { console.log('  (Chrome not found — browser checks skipped)'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
const qidJs = fs.readFileSync(path.join(ROOT, 'qid.js'), 'utf8');

const STUB = `<script>
window.__view = __S__.view;
const BIND = { code:'TEST1', qIdx:0, qid:'q_test', text:'Favourite colour?',
  q:{ text:'Favourite colour?', type:'multiple_choice', options:['Red','Blue'], revealDelay:-1 } };
window.Office = { AsyncResultStatus:{ Succeeded:'succeeded' }, EventType:{ ActiveViewChanged:'avc' },
  onReady(fn){ setTimeout(fn, 0); },
  context:{ displayLanguage: __S__.lang, partitionKey:'t', document:{
    getActiveViewAsync(cb){ cb({ status:'succeeded', value: window.__view }); },
    addHandlerAsync(){}, settings:{ get(){ return __S__.bound ? BIND : null; }, set(){}, saveAsync(){} } } } };
window.PowerPoint = { run(){ return Promise.reject(new Error('no')); } };
const DATA = { 'quiz_builder/TEST1/questions/0': BIND.q };
function ref(p){ return { get: async () => ({ exists:()=>p in DATA, val:()=>DATA[p] }),
  on(ev, fn){ setTimeout(() => fn({ exists:()=>false, val:()=>null }), 0); return fn; }, off(){},
  set: async () => {}, update: async () => {}, transaction: async f => { f(null); return { committed:true }; } }; }
window.firebase = { initializeApp(){}, database: () => ({ ref }),
  auth: () => ({ currentUser:null, onAuthStateChanged(fn){ setTimeout(() => fn(null), 0); }, signInWithEmailAndPassword: async () => ({}) }) };
</script>`;
const DRIVER = `<script>setTimeout(() => { const r = document.getElementById('root');
  const titles = [...document.querySelectorAll('[title]')].map(e => e.title).join(' | ');
  const pre = document.createElement('pre'); pre.id = '__out';
  const btns = [...document.querySelectorAll('button')].map(b => b.textContent).join(' | ');
  pre.textContent = JSON.stringify({ text: ((r ? r.textContent : '') + ' ' + titles + ' ' + btns).replace(/\u00a0/g, ' '), lang: document.documentElement.lang });
  document.body.appendChild(pre); }, 900);</script>`;
function run(s) {
  const html = page.replace(/<script src="\/errors\.js"><\/script>/, '')
    .replace(/<script src="\/qid\.js"><\/script>/, '<script>' + qidJs + '</script>')
    .replace(/<script src="https:\/\/appsforoffice[^"]*"[^>]*><\/script>/, STUB.replace(/__S__/g, JSON.stringify(s)))
    .replace(/<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>/g, '')
    .replace(/<\/body>/, DRIVER + '</body>');
  const f = path.join(os.tmpdir(), 'pslive-i18n-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.html');
  fs.writeFileSync(f, html);
  try {
    const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=6000', '--dump-dom', 'file://' + f],
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
    const x = dom.match(/<pre id="__out">([\s\S]*?)<\/pre>/);
    return x ? JSON.parse(x[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) : null;
  } finally { fs.unlinkSync(f); }
}
const SCREENS = { signin: { view: 'edit', bound: false }, unlinked: { view: 'read', bound: false }, live: { view: 'read', bound: true } };
// English phrases that must never survive in a translated screen (the add-in's own words only).
const ENGLISH = ['Put live results', 'Sign in', 'No account?', 'Not linked', 'Leave the slide show', 'Scan the QR', 'Waiting for answers',
  ' response', 'waiting for the first answer', 'Reveal now', 'Smaller text', 'Bigger text', 'Light or dark', 'Show or hide'];

console.log('\n English stays word for word');
for (const lang of ['en-US', 'en-GB', 'ja-JP', '']) {
  const a = run({ ...SCREENS.signin, lang }), b = run({ ...SCREENS.unlinked, lang });
  ok(`${lang || '(none)'}: sign-in screen in English`, a && /Put live results on this slide/.test(a.text) && /Sign in/.test(a.text) && /No account\? Create a free account — no enterprise purchase or admin setup needed\./.test(a.text), a);
  ok(`${lang || '(none)'}: slide show says "Not linked to a question"`, b && /Not linked to a question/.test(b.text), b);
}
const le = run({ ...SCREENS.live, lang: 'en-US' });
ok('en-US: live screen word for word ("0 responses", "Scan the QR to answer", "Reveal now")', le && /0 responses/.test(le.text) && /Scan the QR to answer/.test(le.text) && /Reveal now/.test(le.text) && /Favourite colour\?/.test(le.text), le);

const EXPECT = {
  es: ['Pon resultados en directo en esta diapositiva', 'No está vinculado a ninguna pregunta', 'Escanea el QR para responder', '0 respuestas', 'Revelar ahora'],
  de: ['Live-Ergebnisse auf diese Folie bringen', 'Mit keiner Frage verknüpft', 'QR-Code scannen und antworten', '0 Antworten', 'Jetzt auflösen'],
  fr: ['Affiche des résultats en direct sur cette diapositive', 'Aucune question associée', 'Scanne le QR pour répondre', '0 réponse', 'Révéler maintenant'],
  pt: ['Coloque resultados em direto neste diapositivo', 'Não está ligado a nenhuma pergunta', 'Leia o QR para responder', '0 respostas', 'Revelar agora'],
  it: ['Metti i risultati in tempo reale su questa slide', 'Non collegato a una domanda', 'Scansiona il QR per rispondere', '0 risposte', 'Rivela ora'],
};
const REGION = { es: 'es-MX', de: 'de-AT', fr: 'fr-CA', pt: 'pt-BR', it: 'it-CH' };
for (const l of LANGS) {
  console.log(`\n ${l}`);
  const s = run({ ...SCREENS.signin, lang: l.toUpperCase() === 'PT' ? 'pt-PT' : l + '-' + l.toUpperCase() });
  const u = run({ ...SCREENS.unlinked, lang: REGION[l] });   // regional variants follow too
  const v = run({ ...SCREENS.live, lang: l });
  ok(`sign-in screen translated`, s && s.text.includes(EXPECT[l][0]) && s.lang === l, s);
  ok(`slide show "not linked" translated (${REGION[l]})`, u && u.text.includes(EXPECT[l][1]), u);
  ok(`live screen translated, the presenter's question untouched`, v && EXPECT[l].slice(2).every(e => v.text.includes(e)) && /Favourite colour\?/.test(v.text) && /Red/.test(v.text), v);
  const left = [s, u, v].filter(Boolean).flatMap(x => ENGLISH.filter(e => x.text.includes(e)));
  ok('no English left from the add-in\'s own words', left.length === 0, left);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
