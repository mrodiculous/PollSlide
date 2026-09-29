#!/usr/bin/env node
/* Microsoft store screenshots for PollSlide LIVE, in every listing language (2026-09-29).
 *
 *   node scripts/appsource/screenshots.js            → all languages
 *   node scripts/appsource/screenshots.js de fr      → just those
 *
 * Each picture is the REAL add-in page (powerpoint-content/index.html) running in
 * headless Chrome with Office and Firebase stubbed, told PowerPoint's language through
 * Office.context.displayLanguage exactly as PowerPoint does — so the words on the add-in
 * are the add-in's own translations, not retyped. Around it: a caption and a mock slide.
 * The demo deck (question, answers, word-cloud words) is translated too, so a German
 * shopper sees a German slide.
 *
 * Out: SUBMIT-TO-MICROSOFT/screenshots/<lang>/0N-*.png — 1366×768 PNG under 1 MB, as
 * Partner Center requires (checked by scripts/tests/appsource-package.test.js). English
 * lives in screenshots/ itself. */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'SUBMIT-TO-MICROSOFT', 'screenshots');
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found'); process.exit(1); }

const page = fs.readFileSync(path.join(ROOT, 'powerpoint-content', 'index.html'), 'utf8');
const qidJs = fs.readFileSync(path.join(ROOT, 'qid.js'), 'utf8');
const QR = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'qr.png')).toString('base64');

/* Everything that is NOT the add-in's own words. The add-in's words come from its L10N. */
const C = {
  en: { office: 'en-US', scan: 'Scan to answer',
    live: ['Live results right on your slide', 'Bars update as your audience answers from their phones', 'Team check-in',
      'Which feature should we build next? 🚀', ['Offline mode', 'Team dashboards', 'Calendar sync', 'Dark mode']],
    show: ['Keeps running while you present', 'Reveal the answer on a countdown or with one click', 'Quick quiz',
      'Which planet is closest to the Sun? ☀️', ['Venus', 'Mercury', 'Earth', 'Mars']],
    cloud: ['Polls, quizzes, word clouds and ratings', 'A different question on every slide', 'Your turn',
      'One word to describe this quarter?', ['busy', 'exciting', 'productive', 'growth', 'teamwork', 'rewarding', 'intense', 'fast', 'learning', 'momentum', 'fun', 'focused']],
    first: ['Start free in a minute', 'Individual accounts — no enterprise purchase or admin setup', 'Team check-in'] },
  es: { office: 'es-ES', scan: 'Escanea para responder',
    live: ['Resultados en directo en tu diapositiva', 'Las barras se actualizan mientras tu público responde desde el móvil', 'Reunión de equipo',
      '¿Qué función creamos ahora? 🚀', ['Modo sin conexión', 'Paneles de equipo', 'Sincronizar calendario', 'Modo oscuro']],
    show: ['Sigue funcionando mientras presentas', 'Revela la respuesta con una cuenta atrás o con un clic', 'Quiz rápido',
      '¿Qué planeta está más cerca del Sol? ☀️', ['Venus', 'Mercurio', 'Tierra', 'Marte']],
    cloud: ['Encuestas, quizzes, nubes de palabras y valoraciones', 'Una pregunta distinta en cada diapositiva', 'Tu turno',
      '¿Una palabra para describir este trimestre?', ['intenso', 'emocionante', 'productivo', 'crecimiento', 'equipo', 'gratificante', 'rápido', 'aprendizaje', 'ilusión', 'divertido', 'enfocado', 'éxito']],
    first: ['Empieza gratis en un minuto', 'Cuentas individuales, sin compra empresarial ni configuración de un administrador', 'Reunión de equipo'] },
  de: { office: 'de-DE', scan: 'Scannen und antworten',
    live: ['Live-Ergebnisse direkt auf deiner Folie', 'Die Balken wachsen, während dein Publikum per Handy antwortet', 'Team-Check-in',
      'Welche Funktion bauen wir als Nächstes? 🚀', ['Offline-Modus', 'Team-Dashboards', 'Kalender-Sync', 'Dunkelmodus']],
    show: ['Läuft weiter, während du präsentierst', 'Löse per Countdown oder mit einem Klick auf', 'Schnelles Quiz',
      'Welcher Planet ist der Sonne am nächsten? ☀️', ['Venus', 'Merkur', 'Erde', 'Mars']],
    cloud: ['Umfragen, Quizze, Wortwolken und Bewertungen', 'Auf jeder Folie eine andere Frage', 'Du bist dran',
      'Ein Wort für dieses Quartal?', ['intensiv', 'spannend', 'produktiv', 'wachstum', 'teamarbeit', 'lohnend', 'schnell', 'lernen', 'schwung', 'freude', 'fokussiert', 'stark']],
    first: ['In einer Minute kostenlos starten', 'Einzelkonten – ohne Unternehmenskauf oder Einrichtung durch einen Admin', 'Team-Check-in'] },
  fr: { office: 'fr-FR', scan: 'Scanne pour répondre',
    live: ['Des résultats en direct sur ta diapositive', 'Les barres bougent pendant que ton public répond depuis son téléphone', 'Point d’équipe',
      'Quelle fonction créer ensuite ? 🚀', ['Mode hors ligne', 'Tableaux de bord', 'Synchro agenda', 'Mode sombre']],
    show: ['Ça continue pendant ta présentation', 'Révèle la réponse avec un compte à rebours ou en un clic', 'Quiz express',
      'Quelle planète est la plus proche du Soleil ? ☀️', ['Vénus', 'Mercure', 'Terre', 'Mars']],
    cloud: ['Sondages, quiz, nuages de mots et notations', 'Une question différente sur chaque diapositive', 'À toi',
      'Un mot pour décrire ce trimestre ?', ['intense', 'passionnant', 'productif', 'croissance', 'équipe', 'gratifiant', 'rapide', 'apprentissage', 'élan', 'fun', 'concentré', 'réussite']],
    first: ['Commence gratuitement en une minute', 'Comptes individuels, sans achat entreprise ni configuration par un administrateur', 'Point d’équipe'] },
  pt: { office: 'pt-PT', scan: 'Leia para responder',
    live: ['Resultados em direto no seu diapositivo', 'As barras atualizam-se enquanto o público responde no telemóvel', 'Ponto de equipa',
      'Que funcionalidade criamos a seguir? 🚀', ['Modo offline', 'Painéis de equipa', 'Sincronizar agenda', 'Modo escuro']],
    show: ['Continua a funcionar enquanto apresenta', 'Revele a resposta com contagem decrescente ou com um clique', 'Quiz rápido',
      'Que planeta está mais perto do Sol? ☀️', ['Vénus', 'Mercúrio', 'Terra', 'Marte']],
    cloud: ['Sondagens, quizzes, nuvens de palavras e classificações', 'Uma pergunta diferente em cada diapositivo', 'A sua vez',
      'Uma palavra para descrever este trimestre?', ['intenso', 'entusiasmante', 'produtivo', 'crescimento', 'equipa', 'gratificante', 'rápido', 'aprendizagem', 'energia', 'divertido', 'focado', 'ação']],
    first: ['Comece gratuitamente num minuto', 'Contas individuais, sem compra empresarial nem configuração por um administrador', 'Ponto de equipa'] },
  it: { office: 'it-IT', scan: 'Scansiona per rispondere',
    live: ['Risultati in tempo reale sulla tua slide', 'Le barre si aggiornano mentre il pubblico risponde dal telefono', 'Riunione di team',
      'Quale funzione sviluppiamo ora? 🚀', ['Modalità offline', 'Dashboard del team', 'Sincronizza calendario', 'Modalità scura']],
    show: ['Continua mentre presenti', 'Rivela la risposta con un conto alla rovescia o con un clic', 'Quiz veloce',
      'Qual è il pianeta più vicino al Sole? ☀️', ['Venere', 'Mercurio', 'Terra', 'Marte']],
    cloud: ['Sondaggi, quiz, nuvole di parole e valutazioni', 'Una domanda diversa su ogni slide', 'Tocca a te',
      'Una parola per descrivere questo trimestre?', ['intenso', 'entusiasmante', 'produttivo', 'crescita', 'squadra', 'gratificante', 'veloce', 'imparare', 'slancio', 'divertente', 'concentrato', 'qualità']],
    first: ['Inizia gratis in un minuto', 'Account individuali, senza acquisti aziendali né configurazione da parte di un amministratore', 'Riunione di team'] },
};
const WEIGHTS = [9, 8, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1];   // word-cloud sizes, biggest first

/* The add-in, stubbed. s = { lang, view, bind, responses, reveal } */
function addinHtml(s) {
  const stub = `<script>
  const S = ${JSON.stringify(s)};
  window.Office = { AsyncResultStatus:{ Succeeded:'succeeded' }, EventType:{ ActiveViewChanged:'avc' },
    onReady(fn){ setTimeout(fn, 0); },
    context:{ displayLanguage: S.lang, partitionKey:'shot', document:{
      getActiveViewAsync(cb){ cb({ status:'succeeded', value: S.view }); }, addHandlerAsync(){},
      settings:{ get(){ return S.bind; }, set(){}, saveAsync(){} } } } };
  window.PowerPoint = { run(){ return Promise.reject(new Error('no')); } };
  const DATA = S.bind ? { ['quiz_builder/'+S.bind.code+'/questions/'+S.bind.qIdx]: S.bind.q,
                          ['sessions/'+S.bind.code+'/responses/'+S.bind.qid]: S.responses } : {};
  function ref(p){ return { get: async () => ({ exists:()=>p in DATA, val:()=>DATA[p] }),
    on(ev, fn){ const v = DATA[p];
      setTimeout(() => fn({ exists:()=>v != null, val:()=>v }), 0);
      if (S.reveal && /\\/phase$/.test(p)) setTimeout(() => fn({ exists:()=>true, val:()=>'revealed' }), 250);
      return fn; }, off(){},
    set: async () => {}, update: async () => {}, transaction: async f => { f(null); return { committed:true }; } }; }
  window.firebase = { initializeApp(){}, database: () => ({ ref }),
    auth: () => ({ currentUser:null, onAuthStateChanged(fn){ setTimeout(() => fn(null), 0); }, signInWithEmailAndPassword: async () => ({}) }) };
  ${s.noButton ? "setInterval(() => { const b = document.getElementById('psReveal'); if (b) { b.remove(); document.body.classList.remove('revealing'); } }, 20);" : ''}
  </script>`;
  return page.replace(/<script src="\/errors\.js"><\/script>/, '')
    .replace(/<script src="\/qid\.js"><\/script>/, '<script>' + qidJs + '</script>')
    .replace(/<script src="https:\/\/appsforoffice[^"]*"[^>]*><\/script>/, stub)
    .replace(/<script src="https:\/\/www\.gstatic\.com[^"]*"><\/script>/g, '');
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function frameHtml({ title, sub, slide, dark, frame, qr, scan, handles }) {
  const h = handles ? [[0, 0], [50, 0], [100, 0], [0, 50], [100, 50], [0, 100], [50, 100], [100, 100]]
    .map(([x, y]) => `<i style="left:${x}%;top:${y}%"></i>`).join('') : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0}
  html,body{width:1366px;height:768px;overflow:hidden}
  body{background:radial-gradient(900px 500px at 15% -10%,#2a2766 0%,transparent 60%),radial-gradient(700px 420px at 105% 110%,#4a2233 0%,transparent 60%),#0b0b14;
       font-family:'DM Sans',sans-serif;color:#fff}
  .cap{position:absolute;top:30px;left:0;right:0;text-align:center;padding:0 40px}
  .cap h1{font-family:'Syne',sans-serif;font-weight:800;font-size:38px;letter-spacing:-.2px;line-height:1.15;white-space:nowrap}
  .cap p{margin-top:8px;font-size:16.5px;color:#c9c5ff;font-weight:500}
  .card{position:absolute;left:183px;top:150px;width:1000px;height:562px;border-radius:10px;
        background:${dark ? 'linear-gradient(160deg,#1c1b3a,#121225)' : '#fff'};box-shadow:0 20px 60px rgba(0,0,0,.45)}
  .card h2{position:absolute;left:50px;top:34px;font-family:'Syne',sans-serif;font-weight:700;font-size:37px;color:${dark ? '#fff' : '#1b1a3a'}}
  .obj{position:absolute;border:0}
  .sel{position:absolute;border:1.2px solid #c8553d;pointer-events:none}
  .sel i{position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border:1.2px solid #c8553d;border-radius:50%;background:#fff}
  .qr{position:absolute;left:771px;top:198px;width:150px;min-height:173px;padding-bottom:9px;background:#fff;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.12);
      text-align:center;padding-top:8px}
  .qr img{width:134px;height:134px;display:block;margin:0 auto}
  .qr b{display:block;font-size:12px;color:#111;font-weight:600;margin-top:4px;padding:0 6px;line-height:1.15}
</style></head><body>
  <div class="cap"><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
  <div class="card"><h2>${esc(slide)}</h2>
    <iframe class="obj" src="${frame.src}" style="left:${frame.x}px;top:${frame.y}px;width:${frame.w}px;height:${frame.h}px"></iframe>
    ${handles ? `<div class="sel" style="left:${frame.x}px;top:${frame.y}px;width:${frame.w}px;height:${frame.h}px">${h}</div>` : ''}
    ${qr ? `<div class="qr"><img src="${QR}"><b>${esc(scan)}</b></div>` : ''}
  </div>
  <script>/* A long headline shrinks to fit rather than running off the picture. */
  document.fonts.ready.then(() => { const h = document.querySelector('.cap h1'); let f = 38;
    while (h.scrollWidth > 1290 && f > 24) h.style.fontSize = (--f) + 'px'; });</script>
  </body></html>`;
}

function votes(counts) {
  const r = {}; let n = 0;
  counts.forEach((c, i) => { for (let k = 0; k < c; k++) r['r' + (n++)] = { answer: JSON.stringify(i), ts: 1 }; });
  return r;
}
function words(list) {
  const r = {}; let n = 0;
  list.forEach((w, i) => { for (let k = 0; k < WEIGHTS[i]; k++) r['r' + (n++)] = { answer: JSON.stringify(w), ts: 1 }; });
  return r;
}
const bind = (code, q, extra) => Object.assign({ code, qIdx: 0, qid: 'q_' + code.toLowerCase(), text: q.text, q }, extra || {});

function shoot(lang) {
  const c = C[lang], dir = lang === 'en' ? OUT : path.join(OUT, lang);
  fs.mkdirSync(dir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-appsource-'));
  const FRAME = { x: 50, y: 115, w: 687, h: 405 };
  const shots = [
    ['01-live', c.live, { view: 'read', noButton: true, responses: votes([14, 22, 9, 6]),
      bind: bind('SHOTA', { text: c.live[3], type: 'multiple_choice', options: c.live[4], revealDelay: -1 }) }, { qr: true }],
    ['02-show', c.show, { view: 'read', reveal: true, responses: votes([6, 31, 4, 3]),
      bind: bind('SHOTB', { text: c.show[3], type: 'multiple_choice', options: c.show[4], correctAnswer: 1, revealDelay: -1 }, { dark: true }) }, { qr: true, dark: true }],
    ['03-cloud', c.cloud, { view: 'read', noButton: true, responses: words(c.cloud[4]),
      bind: bind('SHOTC', { text: c.cloud[3], type: 'free_text', displayMode: 'word_cloud', revealDelay: -1 }) }, { qr: true }],
    ['04-first', c.first, { view: 'edit', bind: null, responses: {} }, { handles: true, frame: { x: 155, y: 114, w: 689, h: 407 } }],
  ];
  for (const [name, cap, s, opt] of shots) {
    const addin = path.join(work, name + '-addin.html');
    fs.writeFileSync(addin, addinHtml({ ...s, lang: c.office }));
    const fr = { ...(opt.frame || FRAME), src: 'file://' + addin };
    const outer = path.join(work, name + '.html');
    fs.writeFileSync(outer, frameHtml({ title: cap[0], sub: cap[1], slide: cap[2], dark: !!opt.dark, frame: fr, qr: !!opt.qr, scan: c.scan, handles: !!opt.handles }));
    const png = path.join(dir, name + '.png');
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--allow-file-access-from-files', '--window-size=1366,768', '--virtual-time-budget=' + (opt.dark ? 2600 : 4000),
      '--screenshot=' + png, 'file://' + outer], { stdio: 'ignore', timeout: 90000 });
    const kb = Math.round(fs.statSync(png).size / 1024);
    console.log(`  ${lang}/${name}.png  ${kb} KB`);
  }
  fs.rmSync(work, { recursive: true, force: true });
}

const want = process.argv.slice(2).filter(a => C[a]);
for (const l of (want.length ? want : Object.keys(C).filter(l => l !== 'en'))) shoot(l);
