/* "Put your questions in order" — drag to reorder, ↑/↓, what stays the same, and "My order"
 * for decks (question reordering D, 2026-10-06). On pollslide.com/reorder-questions, linked
 * from help#move-questions and the presenter's first-move tip.
 *
 *   node scripts/video/record.js move-questions [--lang es|de|fr|pt|it]
 *
 * Filmed on the REAL presenter page with demo data. The drags fire the page's own HTML5 drag
 * events (stage D.drag), so this is the shipped feature, not a mock-up.
 */
module.exports = {
  id: 'move-questions',
  title: 'Put your questions in order',
  previewLabel: 'Watch: put your questions in order in 1 minute',
  preview: [['drag', 1.2, 3.0, 1.4, [0, 60, 1260, 769]], ['links', 1.0, 2.6, 1.2, [330, 60, 1590, 769]], ['decks', 1.5, 3.0, 1.4, [0, 60, 1260, 769]]],
  t: {
    es: { h1: 'Tus preguntas,<br><em>en tu orden</em>', sub: 'Arrastra · ↑ ↓ · los códigos siguen funcionando', steps: ['✋ Arrastrar', '↕ Subir / Bajar', '🔗 Mismo código QR', '🗂 Mi orden'],
          c1: 'Abre el editor de la pregunta', c2: 'Arrástrala a su nuevo sitio', c3: 'O usa Subir y Bajar', c4: 'Su código QR sigue funcionando', c5: 'Las respuestas siguen con su pregunta', c6: 'Tus presentaciones, en tu orden',
          oh1: 'Muévela — <em>los códigos siguen funcionando</em>', osub: 'pollslide.com/reorder-questions', help: '¿Necesitas ayuda?' },
    de: { h1: 'Deine Fragen,<br><em>in deiner Reihenfolge</em>', sub: 'Ziehen · ↑ ↓ · Codes funktionieren weiter', steps: ['✋ Ziehen', '↕ Nach oben / unten', '🔗 Gleicher QR-Code', '🗂 Meine Reihenfolge'],
          c1: 'Frage-Editor öffnen', c2: 'An ihren neuen Platz ziehen', c3: 'Oder Nach oben / Nach unten', c4: 'Ihr QR-Code funktioniert weiter', c5: 'Antworten bleiben bei ihrer Frage', c6: 'Deine Decks, in deiner Reihenfolge',
          oh1: 'Verschieben — <em>Codes funktionieren weiter</em>', osub: 'pollslide.com/reorder-questions', help: 'Brauchst du Hilfe?' },
    fr: { h1: 'Tes questions,<br><em>dans ton ordre</em>', sub: 'Glisser · ↑ ↓ · les codes marchent toujours', steps: ['✋ Glisser', '↕ Monter / Descendre', '🔗 Même QR code', '🗂 Mon ordre'],
          c1: 'Ouvre l’éditeur de la question', c2: 'Fais-la glisser à sa nouvelle place', c3: 'Ou Monter et Descendre', c4: 'Son QR code marche toujours', c5: 'Les réponses restent avec leur question', c6: 'Tes présentations, dans ton ordre',
          oh1: 'Déplace-la — <em>les codes marchent toujours</em>', osub: 'pollslide.com/reorder-questions', help: 'Besoin d’aide ?' },
    pt: { h1: 'As suas perguntas,<br><em>pela sua ordem</em>', sub: 'Arrastar · ↑ ↓ · os códigos continuam a funcionar', steps: ['✋ Arrastar', '↕ Subir / Descer', '🔗 O mesmo código QR', '🗂 A minha ordem'],
          c1: 'Abra o editor da pergunta', c2: 'Arraste-a para o novo lugar', c3: 'Ou use Subir e Descer', c4: 'O código QR continua a funcionar', c5: 'As respostas ficam com a pergunta', c6: 'As suas apresentações, pela sua ordem',
          oh1: 'Mova-a — <em>os códigos continuam a funcionar</em>', osub: 'pollslide.com/reorder-questions', help: 'Precisa de ajuda?' },
    it: { h1: 'Le tue domande,<br><em>nel tuo ordine</em>', sub: 'Trascina · ↑ ↓ · i codici funzionano ancora', steps: ['✋ Trascina', '↕ Su / Giù', '🔗 Stesso codice QR', '🗂 Il mio ordine'],
          c1: 'Apri l’editor della domanda', c2: 'Trascinala al nuovo posto', c3: 'Oppure Su e Giù', c4: 'Il suo codice QR funziona ancora', c5: 'Le risposte restano con la loro domanda', c6: 'Le tue presentazioni, nel tuo ordine',
          oh1: 'Spostala — <em>i codici funzionano ancora</em>', osub: 'pollslide.com/reorder-questions', help: 'Ti serve una mano?' },
  },
  scenes: [
    {
      id: 'intro',
      say: "Here's how to put the questions in a PollSlide deck in the order you want to ask them, and keep every QR code working.",
      pre: async (D) => {
        D.hideCursor();
        const T = window.VT || {};
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>${T.h1 || 'Your questions,<br><em>in your order</em>'}</h1>
          <p>${T.sub || 'Drag · ↑ ↓ · codes keep working'}</p>
          <div class="steps">${(T.steps || ['✋ Drag', '↕ Up / Down', '🔗 Same QR code', '🗂 My order']).map(x => '<span>' + x + '</span>').join('')}</div>`, true);
      },
      run: async (D) => {
        // Demo data (scenes run inside the stage page, so everything they use is defined here).
        const U = 'users/demoTeacher01/presentations/', now = Date.now();
        const q = (id, home, text, type, opts) => Object.assign({ id, home, text, type: type || 'multiple_choice', revealDelay: 30, displayMode: 'bars' },
          type === 'free_text' ? {} : { options: (opts || ['Yes', 'No']).map(t => ({ text: t, img: '' })), correctAnswer: null });
        const DECK = { name: 'Unit 3 check-in', sessionCode: 'MOVE01', productType: 'poll', createdAt: now - 3 * 86400e3, lastOpenedAt: now - 3600e3,
          questions: [
            q('qzmvA', 0, 'How confident do you feel about Unit 3? 🤔', 'multiple_choice', ['Very', 'A bit', 'Not yet']),
            q('qzmvB', 1, 'Which topic should we review first?', 'multiple_choice', ['Fractions', 'Decimals', 'Percentages']),
            q('qzmvC', 2, 'One word to describe this unit?', 'free_text'),
            q('qzmvD', 3, 'Ready for the quiz on Friday?', 'multiple_choice', ['Yes!', 'Almost', 'Help!']),
          ] };
        const other = (name, code, days) => ({ name, sessionCode: code, productType: 'poll', createdAt: now - days * 86400e3,
          questions: [q('qzmv' + code, 0, 'Warm-up?', 'multiple_choice')] });
        await D.db([[U + 'pMove1', DECK], [U + 'pMove2', other('Friday quiz', 'MOVE02', 6)], [U + 'pMove3', other('Staff pulse', 'MOVE03', 9)],
                    ['users/demoTeacher01/deckOrder', null]]);
        await D.load('app', '/presenter');
        await D.waitFor('#presList .pres-item');
      },
    },
    {
      id: 'open',
      say: "Open your deck, click a question, then click Edit this question.",
      run: async (D) => {
        D.card('');
        D.chip(1, (window.VT || {}).c1 || 'Open the question editor');
        await D.sleep(500);
        await D.click(['#presList .pres-item', /Unit 3 check-in/], 'app', { after: 1200 });
        // Give the question list room (as if the divider between decks and questions was dragged up).
        D.js((w, d) => { const p = d.querySelector('.pres-panel'); if (p) p.style.height = '250px'; });
        await D.sleep(300);
        await D.waitFor('#qList .q-item[data-qi="0"]');
        await D.click('#qList .q-item[data-qi="0"]', 'app', { after: 1000 });
        await D.click('button[onclick^="editQuestion("]', 'app', { after: 1000 });
        // The editor's marker is hidden on purpose, so look for it directly (waitFor wants visible).
        await D.waitFor((d) => d.querySelector('#centerPanel > [data-editor-mark]'), 'app', 5000);
      },
    },
    {
      id: 'drag',
      say: "While you're editing, drag a question in the list to its new place. The list updates straight away.",
      run: async (D) => {
        D.chip(2, (window.VT || {}).c2 || 'Drag it to its new place');
        await D.drag('#qList .q-item[data-qi="0"]', '#qList .q-item[data-qi="2"]', 'app', { below: true, hold: 700, after: 1400 });
        await D.sleep(900);
      },
    },
    {
      id: 'arrows',
      say: "Or use the Up and Down buttons at the bottom of the editor. Each click moves it one place.",
      run: async (D) => {
        D.chip(3, (window.VT || {}).c3 || 'Or use Up and Down');
        await D.click('#centerPanel button[onclick$=",-1)"]', 'app', { after: 1400 });
        await D.sleep(600);
      },
    },
    {
      id: 'links',
      say: "Each question keeps its QR code and link when you move it, so codes already on your slides and handouts still open the same question. Its number changes to show its new place.",
      run: async (D) => {
        D.chip(4, (window.VT || {}).c4 || 'Its QR code still works');
        await D.click('.cm-switch[onclick^="doneEditing("]', 'app', { scroll: false, after: 900 });
        D.hideCursor();
        await D.waitFor('[id^="qrInline_"] canvas, [id^="qrInline_"] img', 'app', 6000);
        await D.sleep(500);
        await D.focus('.qr-url', 1.5);
        await D.sleep(2600);
        await D.unfocus();
      },
    },
    {
      id: 'answers',
      say: "Answers stay with their question. And if you move the question that's showing during a live session, your audience stays right on it.",
      run: async (D) => {
        D.chip(5, (window.VT || {}).c5 || 'Answers stay with their question');
        await D.point('#qList .q-item.sel');
        await D.sleep(3200);
        D.hideCursor();
        await D.snap('move-questions');
      },
    },
    {
      id: 'decks',
      say: "Your decks can have your order too. Choose My order in the sort menu, then drag them where you want them.",
      run: async (D) => {
        D.chip(6, (window.VT || {}).c6 || 'Your decks, in your order');
        D.js((w, d) => { const p = d.querySelector('.pres-panel'); if (p) p.style.height = '560px'; });
        await D.sleep(400);
        await D.point('#deckSort');
        D.js((w, d) => { const s = d.getElementById('deckSort'); s.value = 'manual'; s.onchange(); });
        await D.sleep(1200);
        await D.drag(['#presList .pres-item[data-deck]', /Staff pulse/], ['#presList .pres-item[data-deck]', /Unit 3 check-in/], 'app', { below: false, hold: 700, after: 1600 });
        await D.sleep(800);
      },
    },
    {
      id: 'outro',
      say: "That's it. Move questions whenever you like, and your codes keep working. The full guide is at pollslide dot com, slash reorder questions.",
      run: async (D) => {
        D.chip(0, '');
        D.hideCursor();
        await D.sleep(400);
        const T = window.VT || {};
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>${T.oh1 || 'Move it — <em>the codes keep working</em>'}</h1>
          <div class="url">${T.osub || 'pollslide.com/reorder-questions'}</div>
          <p style="margin-top:34px;font-size:28px;">${T.help || 'Need a hand?'} help@pollslide.com</p>`);
      },
    },
  ],
};
