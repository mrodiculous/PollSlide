/* "Weekly meetings online" — for pollslide.com/teams#meetings and the Team plan emails.
 *
 *   node scripts/video/record.js online-meetings            (on the Mac: narration + MP4)
 *   node scripts/video/record.js online-meetings --dry      (anywhere: drives every scene, frames only)
 *
 * A ready-made "Monday team meeting" deck — what a team keeps and reuses every week — run the
 * way it is in a video call: the shared screen in present mode, people answering on their phones.
 * Every screen is the real app on the stage server; AI Insights and the co-pilot answer from the
 * stage's canned replies, which are computed from the answers actually on screen.
 */
const CODE = 'MTG4K7';
const PRES = 'pres_meeting_demo';
const DECK = {
  id: PRES, name: 'Monday team meeting', sessionCode: CODE, createdAt: Date.now(), productType: 'poll', language: 'en',
  questions: [
    { id: 'q_mtg_week', text: 'In one word, how was your week?', type: 'free_text', options: [], image: '', timer: 0, displayMode: 'bars', revealDelay: 30,
      postReveal: { enabled: false, type: 'leaderboard', explainerText: '', advanceDelay: 'manual' } },
    { id: 'q_mtg_next', text: 'Which should we tackle first next sprint?', type: 'multiple_choice', correctAnswer: null,
      options: [{ text: 'Mobile app release', img: '' }, { text: 'Customer dashboard', img: '' }], image: '', timer: 0, displayMode: 'bars', revealDelay: 30,
      postReveal: { enabled: false, type: 'leaderboard', explainerText: '', advanceDelay: 'manual' } },
  ],
};

/* record.js sends each scene to the browser as source text (fn.toString()), so a scene cannot
   see constants from this file. S() inlines CODE / PRES / DECK into the source it hands over. */
const S = (fn) => { const src = fn.toString().replace(/\bCODE\b/g, JSON.stringify(CODE)).replace(/\bPRES\b/g, JSON.stringify(PRES)).replace(/\bDECK\b/g, JSON.stringify(DECK));
  const f = fn; f.toString = () => src; return f; };

module.exports = {
  t: {"es": {"c1": "Tu presentación de la reunión semanal", "c2": "Comparte pantalla y presenta", "c3": "Una ronda de una palabra", "c4": "AI Insights lee la sala", "c5": "Vota y luego profundiza", "c6": "Preguntas del público", "h1": "Reuniones semanales,<br><em>en línea</em>", "s1": "💬 Ronda", "s2": "✨ Insights", "s3": "🗳️ Votar", "s4": "🙋 Preguntas", "h2": "Pruébalo en tu<br><em>próxima reunión</em>", "p2": "Gratis para empezar · nada que instalar"}, "de": {"c1": "Deine Präsentation fürs Wochenmeeting", "c2": "Bildschirm teilen und präsentieren", "c3": "Ein Ein-Wort-Check-in", "c4": "AI Insights liest den Raum", "c5": "Abstimmen, dann nachhaken", "c6": "Publikumsfragen", "h1": "Wöchentliche Meetings,<br><em>online</em>", "s1": "💬 Check-in", "s2": "✨ Insights", "s3": "🗳️ Abstimmen", "s4": "🙋 Fragen", "h2": "Probier es im<br><em>nächsten Meeting</em>", "p2": "Kostenlos starten · nichts zu installieren"}, "fr": {"c1": "Ta présentation de réunion hebdo", "c2": "Partage ton écran et présente", "c3": "Un tour de table en un mot", "c4": "AI Insights prend le pouls", "c5": "Vote, puis approfondis", "c6": "Questions du public", "h1": "Réunions hebdo,<br><em>en ligne</em>", "s1": "💬 Tour de table", "s2": "✨ Insights", "s3": "🗳️ Voter", "s4": "🙋 Questions", "h2": "Essaie-le à ta<br><em>prochaine réunion</em>", "p2": "Gratuit pour commencer · rien à installer"}, "pt": {"c1": "A apresentação da reunião semanal", "c2": "Partilhe o ecrã e apresente", "c3": "Uma ronda de uma palavra", "c4": "O AI Insights lê a sala", "c5": "Vote e aprofunde", "c6": "Perguntas do público", "h1": "Reuniões semanais,<br><em>online</em>", "s1": "💬 Ronda", "s2": "✨ Insights", "s3": "🗳️ Votar", "s4": "🙋 Perguntas", "h2": "Experimente na<br><em>próxima reunião</em>", "p2": "Grátis para começar · nada para instalar"}, "it": {"c1": "La presentazione della riunione settimanale", "c2": "Condividi lo schermo e presenta", "c3": "Un giro di una parola", "c4": "AI Insights legge la sala", "c5": "Vota, poi approfondisci", "c6": "Domande del pubblico", "h1": "Riunioni settimanali,<br><em>online</em>", "s1": "💬 Giro", "s2": "✨ Insights", "s3": "🗳️ Votare", "s4": "🙋 Domande", "h2": "Provalo alla tua<br><em>prossima riunione</em>", "p2": "Gratis per iniziare · niente da installare"}},
  id: 'online-meetings',
  title: 'Weekly meetings online with PollSlide',
  previewLabel: 'Watch: better online meetings in 2 minutes',
  preview: [['join', 2.0, 3.0, 1.3, [0, 0, 1920, 1080]], ['insights', 1.5, 3.0, 1.2, [330, 120, 1590, 960]], ['qa', 2.0, 3.0, 1.2, [0, 0, 1920, 1080]]],
  scenes: [
    {
      id: 'intro',
      say: "Online meetings lose people fast. Here's how to keep your weekly meeting on Zoom, Teams or Meet lively, in about two minutes.",
      pre: async (D) => {
        D.hideCursor();
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>${(window.VT || {}).h1 || "Weekly meetings,<br><em>online</em>"}</h1>
          <p>Zoom · Microsoft Teams · Google Meet</p>
          <div class="steps"><span>${(window.VT || {}).s1 || "💬 Check in"}</span><span>✨ Insights</span><span>${(window.VT || {}).s3 || "🗳️ Vote"}</span><span>${(window.VT || {}).s4 || "🙋 Q&amp;A"}</span></div>`, true);
      },
      run: S(async (D) => {
        await D.db([['users/demoTeacher01/presentations/' + PRES, DECK]]);
        await D.load('app', '/presenter');
        await D.waitFor('[onclick="switchProduct(\'poll\')"]');
      }),
    },
    {
      id: 'deck',
      say: "This is our Monday meeting deck. We reuse it every week: a one-word check-in, then a quick vote on what to do next.",
      run: S(async (D) => {
        D.card('');
        await D.sleep(700);
        D.chip(1, (window.VT || {}).c1 || 'Your weekly meeting deck');
        await D.click('[onclick="switchProduct(\'poll\')"]', 'app', { scroll: false, after: 700 });
        await D.click(['.pres-item', /Monday team meeting/], 'app', { after: 1200 });
        await D.point((d) => d.querySelectorAll('.q-item')[0], 'app', { scroll: false });
        await D.sleep(900);
        await D.point((d) => d.querySelectorAll('.q-item')[1], 'app', { scroll: false });
      }),
    },
    {
      id: 'join',
      say: "Share your screen in the call and press Present. People scan the code with their phone, or type it at pollslide dot com slash join. Nothing to install.",
      run: S(async (D) => {
        D.chip(2, (window.VT || {}).c2 || 'Share your screen and present');
        await D.click((d) => d.querySelectorAll('.q-item')[0], 'app', { scroll: false, after: 500 });
        await D.click((d) => d.querySelector('button[onclick="openPresentPicker()"]'), 'app', { scroll: false, after: 900 });
        await D.click('[onclick="closePresentPicker();openPresentMode()"]', 'app', { scroll: false, after: 900 });
        await D.click((d) => d.querySelector('[onclick="pickDisplay(\'window\')"]'), 'app', { after: 400 });
        await D.click('[onclick="startPresentWithMode()"]', 'app', { after: 1400 });
        D.hideCursor();
        D.layout('split');
        await D.load('phone', '/answer?signedout#' + CODE + '/0');
        await D.sleep(900);
        await D.type('input', 'Maya', 'phone', { cps: 8 });
        await D.click('[onclick="joinSession()"]', 'phone', { after: 1200 });
      }),
    },
    {
      id: 'checkin',
      say: "Start with a one-word check-in. Everyone answers on their phone, and the words appear on the shared screen as they arrive.",
      run: S(async (D) => {
        D.chip(3, (window.VT || {}).c3 || 'A one-word check-in');
        const words = [['Leo', 'Busy'], ['Sam', 'Productive'], ['Priya', 'Hectic'], ['Ben', 'Great'], ['Ava', 'Stretched'], ['Noah', 'Productive'], ['Zoe', 'Focused'], ['Omar', 'Tired']];
        const qid = D.js((w) => w.__videoDB.get('sessions/' + CODE + '/currentQuestion/id'));
        const push = (n, a) => D.js((w) => w.__videoDB.set(`sessions/${CODE}/responses/${qid}/p_bot_${n}`,
          { participantId: 'p_bot_' + n, name: n, answer: a, elapsed: 3000 + Math.random() * 5000, submittedAt: Date.now(), attempt: 1 }));
        push(...words[0]); await D.sleep(400); push(...words[1]);
        await D.type('#txtAns', 'Productive', 'phone', { cps: 9 });
        await D.click('[onclick="submitAnswer()"]', 'phone', { after: 600 });
        for (const w of words.slice(2)) { push(...w); await D.sleep(450); }
        await D.sleep(1200);
      }),
    },
    {
      id: 'insights',
      say: "On your own screen, AI Insights reads every answer and gives you the mood and the themes in seconds. Here, most of the team had a good week, and a few are stretched.",
      run: S(async (D) => {
        D.chip(4, (window.VT || {}).c4 || 'AI Insights reads the room');
        D.layout('');
        await D.js((w) => w.closePresentMode && w.closePresentMode());
        await D.sleep(900);
        await D.click('[onclick="showResponseInsights()"]', 'app', { after: 300 });
        await D.waitFor('#insightsModal span[style*="border-radius:50%"]', 'app', 8000);
        await D.sleep(1200);
        await D.point((d) => (d.querySelector('#insightsModal span[style*="border-radius:50%"]') || {}).parentElement, 'app', { scroll: false });
        await D.sleep(1500);
      }),
    },
    {
      id: 'vote',
      say: "Next, a quick vote. The room splits almost evenly, so ask the co-pilot. It suggests a follow-up question that gets to what is really holding people back.",
      run: S(async (D) => {
        D.chip(5, (window.VT || {}).c5 || 'Vote, then follow up');
        await D.js((w, d) => { const m = d.getElementById('insightsModal'); if (m) m.remove(); });
        await D.click((d) => d.querySelectorAll('.q-item')[1], 'app', { scroll: false, after: 600 });
        await D.js((w) => w.launchQuestion(1));
        await D.sleep(700);
        const qid = D.js((w) => w.__videoDB.get('sessions/' + CODE + '/currentQuestion/id'));
        const votes = [['Leo', 0], ['Sam', 1], ['Priya', 0], ['Ben', 1], ['Ava', 0], ['Noah', 1], ['Zoe', 1], ['Omar', 0], ['Maya', 0]];
        for (const [n, a] of votes) { D.js((w) => w.__videoDB.set(`sessions/${CODE}/responses/${qid}/p_bot_${n}`,
          { participantId: 'p_bot_' + n, name: n, answer: `[${a}]`, elapsed: 4000, submittedAt: Date.now(), attempt: 1 })); await D.sleep(260); }
        await D.sleep(900);
        await D.click('[onclick="runCopilot()"]', 'app', { after: 300 });
        await D.waitFor('[onclick="acceptCopilot(0, false)"]', 'app', 8000);
        await D.sleep(1600);
        await D.click('[onclick="acceptCopilot(0, false)"]', 'app', { scroll: false, after: 1200 });
      }),
    },
    {
      id: 'qa',
      say: "Keep audience Q and A open. Questions arrive during the meeting, people upvote the ones they care about, and the most wanted rise to the top.",
      run: S(async (D) => {
        D.chip(6, (window.VT || {}).c6 || 'Audience Q&A');
        await D.click((d) => d.querySelectorAll('.q-item')[0], 'app', { scroll: false, after: 400 });
        await D.click((d) => d.querySelector('button[onclick="openPresentPicker()"]'), 'app', { scroll: false, after: 900 });
        await D.click('[onclick="closePresentPicker();openPresentMode()"]', 'app', { scroll: false, after: 900 });
        await D.click((d) => d.querySelector('[onclick="pickDisplay(\'window\')"]'), 'app', { after: 400 });
        await D.click('[onclick="startPresentWithMode()"]', 'app', { after: 1200 });
        await D.click('#presentQaBtn', 'app', { scroll: false, after: 800 });
        D.hideCursor();
        D.layout('split');
        await D.load('phone', '/answer?signedout#' + CODE + '/qa');
        await D.sleep(900);
        const ask = (id, n, text, votes) => D.js((w) => w.__videoDB.set(`sessions/${CODE}/qa/${id}`,
          { text, name: n, votes, voters: {}, createdAt: Date.now() }));
        ask('qa_bot_1', 'Leo', 'Can we move the release review to Thursday?', 2); await D.sleep(700);
        await D.type('textarea, input[type=text]', 'Who owns the customer dashboard now?', 'phone', { cps: 16 });
        await D.click('[onclick="submitQuestion()"]', 'phone', { after: 900 });
        ask('qa_bot_2', 'Ava', 'Is the offsite still on for next month?', 1); await D.sleep(600);
        // The room upvotes the dashboard question to the top.
        const mine = D.js((w) => Object.entries(w.__videoDB.get('sessions/' + CODE + '/qa') || {}).find(([k, q]) => /dashboard/.test(q.text)));
        if (mine) for (const v of [3, 4, 5]) { D.js((w) => w.__videoDB.set(`sessions/${CODE}/qa/${mine[0]}/votes`, v)); await D.sleep(500); }
        await D.sleep(1400);
      }),
    },
    {
      id: 'outro',
      say: "Afterwards, send everyone the recap link, and keep the deck in your team library for next week. Try it at your next meeting: app dot pollslide dot com.",
      run: S(async (D) => {
        D.chip(0, '');
        D.layout('');
        await D.sleep(600);
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>${(window.VT || {}).h2 || "Try it at your<br><em>next meeting</em>"}</h1>
          <p>${(window.VT || {}).p2 || "Free to start · nothing to install"}</p>
          <div class="url">app.pollslide.com</div>
          <p style="margin-top:34px;font-size:28px;">pollslide.com/teams</p>`);
      }),
    },
  ],
};
