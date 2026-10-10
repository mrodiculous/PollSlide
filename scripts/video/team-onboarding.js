/* "Onboard new people faster" — for pollslide.com/teams#onboarding and the Team plan emails.
 *
 *   node scripts/video/record.js team-onboarding            (on the Mac: narration + MP4)
 *   node scripts/video/record.js team-onboarding --dry      (anywhere: drives every scene, frames only)
 *
 * Polly turns a (made-up) employee handbook into a quiz, the new starters go in as a named list,
 * answers come in by person, and the same deck becomes flashcards. Stage Polly returns the
 * fictional onboarding questions in server.js (ONBOARD) when the topic mentions a handbook.
 */
const NAMES = ['Ana Ruiz', 'Ben Cole', 'Cara Diaz', 'Dev Patel', 'Ella Novak', 'Finn Walsh'];
const S = (fn) => { const src = fn.toString().replace(/\bNAMES\b/g, JSON.stringify(NAMES)); const f = fn; f.toString = () => src; return f; };

module.exports = {
  t: {"es": {"c1": "Tu manual, como quiz", "c2": "Añade a los nuevos, una vez", "c3": "En vivo o a su ritmo", "c4": "Mira quién lo tiene claro", "c5": "Y que no se olvide", "h1": "Incorpora a gente nueva<br><em>más rápido</em>", "p1": "Del manual al quiz y a las tarjetas", "s2": "👥 Nombres", "s3": "📊 Resultados", "s4": "📚 Estudiar", "h2": "Que cada nueva persona<br>tenga el <em>mismo comienzo</em>", "p2": "Gratis para empezar · nada que instalar"}, "de": {"c1": "Dein Handbuch als Quiz", "c2": "Die Neuen einmal anlegen", "c3": "Live oder im eigenen Tempo", "c4": "Sieh, wer es verstanden hat", "c5": "Dann bleibt es hängen", "h1": "Neue Leute<br><em>schneller</em> einarbeiten", "p1": "Vom Handbuch zum Quiz zu Karteikarten", "s2": "👥 Namen", "s3": "📊 Ergebnisse", "s4": "📚 Lernen", "h2": "Jeder neue Mensch<br>bekommt den <em>gleichen Start</em>", "p2": "Kostenlos starten · nichts zu installieren"}, "fr": {"c1": "Ton guide d’accueil en quiz", "c2": "Ajoute les nouveaux, une fois", "c3": "En direct ou à leur rythme", "c4": "Vois qui a compris", "c5": "Puis ancre-le", "h1": "Intègre les nouveaux<br><em>plus vite</em>", "p1": "Du guide au quiz puis aux cartes", "s2": "👥 Noms", "s3": "📊 Résultats", "s4": "📚 Réviser", "h2": "Le <em>même départ</em><br>pour chaque arrivant", "p2": "Gratuit pour commencer · rien à installer"}, "pt": {"c1": "O seu manual, em quiz", "c2": "Adicione os novos, uma vez", "c3": "Em direto ou ao seu ritmo", "c4": "Veja quem percebeu", "c5": "Depois, que fique", "h1": "Integre pessoas novas<br><em>mais depressa</em>", "p1": "Do manual ao quiz e aos cartões", "s2": "👥 Nomes", "s3": "📊 Resultados", "s4": "📚 Estudar", "h2": "O <em>mesmo início</em><br>para cada pessoa nova", "p2": "Grátis para começar · nada para instalar"}, "it": {"c1": "Il tuo manuale, come quiz", "c2": "Aggiungi i nuovi, una volta", "c3": "Dal vivo o con calma", "c4": "Vedi chi ha capito", "c5": "Poi fallo restare", "h1": "Inserisci i nuovi<br><em>più in fretta</em>", "p1": "Dal manuale al quiz alle flashcard", "s2": "👥 Nomi", "s3": "📊 Risultati", "s4": "📚 Studio", "h2": "Lo <em>stesso inizio</em><br>per ogni nuovo arrivato", "p2": "Gratis per iniziare · niente da installare"}},
  id: 'team-onboarding',
  title: 'Onboard new people faster with PollSlide',
  previewLabel: 'Watch: faster onboarding in 2 minutes',
  preview: [['polly', 3.0, 3.0, 1.3, [330, 90, 1590, 799]], ['results', 1.5, 3.0, 1.2, [330, 120, 1590, 960]]],
  scenes: [
    {
      id: 'intro',
      say: "Onboarding is a lot of talking, and a hope that it stuck. Here's how to turn it into something you can measure, in about two minutes.",
      pre: async (D) => {
        D.hideCursor();
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>${(window.VT || {}).h1 || "Onboard new people<br><em>faster</em>"}</h1>
          <p>${(window.VT || {}).p1 || "From handbook to quiz to flashcards"}</p>
          <div class="steps"><span>✨ Polly</span><span>${(window.VT || {}).s2 || "👥 Names"}</span><span>${(window.VT || {}).s3 || "📊 Results"}</span><span>${(window.VT || {}).s4 || "📚 Study"}</span></div>`, true);
      },
      run: S(async (D) => {
        await D.load('app', '/presenter');
        await D.waitFor('[onclick="switchProduct(\'quiz\')"]');
      }),
    },
    {
      id: 'polly',
      say: "Make a quiz and ask Polly. Describe your handbook, or paste it in, and Polly writes the questions in seconds. Read them, and fix anything before anyone sees them.",
      run: S(async (D) => {
        D.card('');
        await D.sleep(700);
        D.chip(1, (window.VT || {}).c1 || 'Your handbook, as a quiz');
        await D.click('[onclick="switchProduct(\'quiz\')"]', 'app', { scroll: false, after: 700 });
        await D.click('[onclick="createPresentation()"]', 'app', { after: 800 });
        await D.type('#renameInput', 'New starter quiz', 'app', { clear: true, cps: 16, scroll: false });
        await D.click('[onclick="doRenamePres()"]', 'app', { scroll: false, after: 800 });
        await D.click('[onclick="openPolly()"]', 'app', { scroll: false, after: 1000 });
        await D.type('#pollyTopic', 'Our employee handbook: expenses, IT security, paid leave and the weekly planning meeting', 'app', { cps: 28, scroll: false });
        await D.type('#pollyCount', '5', 'app', { clear: true, cps: 6, scroll: false });
        await D.click('#pollyGoBtn', 'app', { after: 300 });
        await D.waitFor((d) => d.querySelectorAll('.q-item').length >= 5 ? d.querySelector('.q-item') : null, 'app', 12000);
        await D.sleep(900);
        await D.point((d) => d.querySelectorAll('.q-item')[1], 'app', { scroll: false });
      }),
    },
    {
      id: 'names',
      say: "Add your new starters as a list, once. In PollSlide this is called a class. From then on, every answer is recorded by person.",
      run: S(async (D) => {
        D.chip(2, (window.VT || {}).c2 || 'Add the new starters, once');
        D.js((w) => { w.prompt = () => 'New starters, October'; });
        await D.click((d) => d.querySelector('[onclick^="openDeckMenu("]'), 'app', { scroll: false, after: 700 });
        await D.click('.rm-item[onclick*="openClassManager("]', 'app', { scroll: false, after: 900 });
        await D.click('[onclick="createClass()"]', 'app', { scroll: false, after: 900 });
        await D.type('#rosterPaste', NAMES.join('\n'), 'app', { cps: 30, scroll: false });
        await D.click('#rosterModal [onclick^="saveRoster("]', 'app', { scroll: false, after: 900 });
        await D.click((d) => d.querySelector('[onclick^="openDeckMenu("]'), 'app', { scroll: false, after: 700 });
        await D.click('.rm-item[onclick*="openClassManager("]', 'app', { scroll: false, after: 900 });
        await D.click('#classModal [onclick^="assignDeckToClass("]', 'app', { scroll: false, after: 1200 });
        D.js((w, d) => { const m = d.getElementById('classModal'); if (m) m.remove(); });
      }),
    },
    {
      id: 'live',
      say: "Run it live in their first-week session, or send the link so they answer in their own time. Either way, you see who has answered, by name.",
      run: S(async (D) => {
        D.chip(3, (window.VT || {}).c3 || 'Live, or in their own time');
        await D.click((d) => d.querySelectorAll('.q-item')[0], 'app', { scroll: false, after: 500 });
        const code = D.js((w) => w.eval('presentations[activePresId].sessionCode'));
        const qs = D.js((w) => w.eval('presentations[activePresId].questions'));
        // Each person's answers, mostly right — Finn and Dev miss a few.
        const picks = { 'Ana Ruiz': [2, 1, 0, 2, 1], 'Ben Cole': [2, 1, 0, 2, 1], 'Cara Diaz': [2, 1, 0, 1, 1], 'Dev Patel': [1, 1, 0, 2, 3],
                        'Ella Novak': [2, 1, 0, 2, 1], 'Finn Walsh': [0, 3, 1, 2, 1] };
        for (let i = 0; i < qs.length; i++) {
          await D.js((w) => w.launchQuestion(i));
          await D.sleep(i === 0 ? 900 : 350);
          const qid = D.js((w) => w.__videoDB.get('sessions/' + code + '/currentQuestion/id'));
          const right = qs[i].correctAnswer;
          for (const n of NAMES) {
            const a = picks[n][i], id = 'p_' + n.split(' ')[0].toLowerCase();
            D.js((w) => w.__videoDB.set(`sessions/${code}/responses/${qid}/${id}`,
              { participantId: id, name: n, answer: `[${a}]`, elapsed: 5000 + Math.random() * 6000, isCorrect: a === right, submittedAt: Date.now(), attempt: 1 }));
            if (i === 0) await D.sleep(450);
          }
        }
        await D.click((d) => d.querySelectorAll('.q-item')[0], 'app', { scroll: false, after: 1200 });
        await D.js((w) => w.launchQuestion(0));
        await D.sleep(1500);
      }),
    },
    {
      id: 'results',
      say: "The report lists every person and their score, so you can see who has it, and who needs a quick conversation. You can also allow a second attempt.",
      run: S(async (D) => {
        D.chip(4, (window.VT || {}).c4 || 'See who has it');
        await D.js((w) => w.openReport());
        await D.sleep(2200);
        await D.scroll('#reportParticipants');
        await D.sleep(900);
        await D.point(['#reportParticipants td', /Finn Walsh/], 'app', { scroll: false });
        await D.sleep(1400);
      }),
    },
    {
      id: 'study',
      say: "Then turn the same deck into a study set. Spaced repetition brings back the cards each person keeps missing.",
      run: S(async (D) => {
        D.chip(5, (window.VT || {}).c5 || 'Then make it stick');
        D.js((w, d) => { d.querySelectorAll('.overlay').forEach(o => { if (o.style.display !== 'none') o.remove(); }); try { w.closeReport && w.closeReport(); } catch (e) {} });
        await D.sleep(500);
        await D.js((w) => w.studyThisDeck());
        await D.sleep(1800);
        await D.point((d) => d.querySelectorAll('.q-item')[0], 'app', { scroll: false });
        await D.sleep(1200);
      }),
    },
    {
      id: 'outro',
      say: "Keep the deck in your team library, so every manager gives every new group the same start. Try it free at app dot pollslide dot com.",
      run: S(async (D) => {
        D.chip(0, '');
        await D.sleep(600);
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>${(window.VT || {}).h2 || "Give every new starter<br>the <em>same start</em>"}</h1>
          <p>${(window.VT || {}).p2 || "Free to start · nothing to install"}</p>
          <div class="url">app.pollslide.com</div>
          <p style="margin-top:34px;font-size:28px;">pollslide.com/teams</p>`);
      }),
    },
  ],
};
