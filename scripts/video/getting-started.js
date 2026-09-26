/* "Your first quiz in 2 minutes" — the welcome video new accounts are sent.
 *
 * Each scene is what the narrator says (`say`) and what happens on screen (`run`, executed
 * inside stage.html with the director D). The narration doubles as the captions, so the
 * words and the pictures can never drift apart. Re-record after UI changes with:
 *
 *   node scripts/video/record.js getting-started
 *
 * Keep `say` in plain spoken English (it is read by a speech engine and becomes the
 * subtitle file that is translated for the website).
 */
module.exports = {
  id: 'getting-started',
  title: 'Your first PollSlide quiz in 2 minutes',
  scenes: [
    {
      id: 'intro',
      say: "Welcome to PollSlide! In the next two minutes, you'll make your first quiz, let Polly write questions for you, add GIFs, and run it live with your audience.",
      pre: async (D) => {
        D.hideCursor();
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>Your first quiz<br>in <em>2 minutes</em></h1>
          <p>Build it · let Polly help · add GIFs · go live</p>
          <div class="steps"><span>✏️ Create</span><span>✨ Polly</span><span>🎞 GIFs</span><span>📱 Live</span></div>`, true);
      },
      run: async (D) => {
        await D.load('app', '/presenter');
        await D.waitFor(['.product-tab', /Quizzes/]);
      },
    },
    {
      id: 'pick',
      say: "Start by choosing what to make. Polls ask the room what it thinks. Quizzes have right answers and a leaderboard. Let's make a quiz.",
      run: async (D) => {
        D.card('');
        await D.sleep(900);
        D.chip(1, 'Pick a poll or a quiz');
        await D.point(['.product-tab', /Polls/], 'app', { scroll: false });
        await D.sleep(1600);
        await D.click(['.product-tab', /Quizzes/], 'app', { scroll: false, after: 900 });
      },
    },
    {
      id: 'name',
      say: "Click Blank Quiz, and give it a name. Everything you do saves automatically.",
      run: async (D) => {
        await D.click(['button', /Blank Quiz/], 'app', { after: 800 });
        await D.type('#renameInput', 'Amazing animals', 'app', { clear: true, cps: 14, scroll: false });
        await D.click(['#renamePresModal button', /^Save$/], 'app', { scroll: false, after: 900 });
      },
    },
    {
      id: 'question',
      say: "Now add your first question. Type it in, fill in the answers, then tick the right one. Polls work exactly the same way, just without a right answer.",
      run: async (D) => {
        D.chip(2, 'Write your first question');
        await D.click(['button', /Add manually/], 'app', { after: 900 });
        await D.type('textarea[oninput*="\'text\'"]', 'Which animal sleeps the most?', 'app', { cps: 26 });
        const opt = (i) => (d) => d.querySelector(`input.opt-input[oninput^="updateOpt(0,${i},"]`);
        const names = ['Sloth', 'Lion', 'Koala', 'Panda'];
        for (let i = 0; i < 4; i++) await D.type(opt(i), names[i], 'app', { cps: 16 });
        await D.click((d) => d.querySelector('[onclick="toggleCorrect(0,2)"]'), 'app', { after: 900 });
      },
    },
    {
      id: 'gifs',
      say: "Now make it fun. Tap GIF, search for anything you like, and pick one for your question. Each answer can have its own GIF too. They look great on the big screen, and on everyone's phone.",
      run: async (D) => {
        D.chip(3, 'Add GIFs');
        await D.click((d) => d.querySelector('button[onclick^="openGifPicker(function(url){updateQ(0,"]'), 'app', { after: 700 });
        await D.type('#gifPickerInput', 'alarm clock', 'app', { clear: true, cps: 12, scroll: false });
        await D.click(['button', /^Search$/], 'app', { scroll: false, after: 1400 });
        await D.click((d) => [...d.querySelectorAll('.gif-thumb')].find(g => /Digital alarm/i.test(g.title)) || d.querySelector('.gif-thumb'), 'app', { scroll: false, after: 1200 });
        // …and one for the right answer
        await D.click((d) => d.querySelector('button[onclick^="openGifPicker(function(url){updateOptImg(0,2,"]'), 'app', { after: 700 });
        await D.type('#gifPickerInput', 'koala', 'app', { clear: true, cps: 12, scroll: false });
        await D.click(['button', /^Search$/], 'app', { scroll: false, after: 1400 });
        await D.click('.gif-thumb', 'app', { scroll: false, after: 900 });
        await D.scroll((d) => d.querySelector('input.opt-input[oninput^="updateOpt(0,2,"]'));
        await D.sleep(700);
      },
    },
    {
      id: 'polly',
      say: "Short on time? Ask Polly. Describe your topic, choose how many questions, and Polly writes them for you, with the right answers already marked. Free accounts get five Polly drafts a month.",
      run: async (D) => {
        D.chip(4, 'Let Polly write the rest');
        await D.click(['button', /Done & Go Live/], 'app', { after: 700 });
        await D.click(['button', /Ask Polly/], 'app', { scroll: false, after: 1100 });
        await D.type('#pollyTopic', 'Surprising animal facts for a fun class quiz', 'app', { cps: 20, scroll: false });
        await D.type('#pollyCount', '4', 'app', { clear: true, cps: 6, scroll: false });
        await D.click('#pollyGoBtn', 'app', { after: 300 });
        await D.waitFor((d) => d.querySelectorAll('.q-item').length >= 5 ? d.querySelector('.q-item') : null, 'app', 12000);
        await D.sleep(1200);
        await D.point((d) => d.querySelectorAll('.q-item')[3], 'app', { scroll: false });
      },
    },
    {
      id: 'gifs-all',
      say: "Want pictures everywhere? Open the deck menu, choose GIFs, and PollSlide finds one for every question and answer. Safe search is always on, and you review them before anyone sees them.",
      run: async (D) => {
        D.chip(5, 'GIFs for everything');
        await D.click((d) => d.querySelector('[onclick^="openDeckMenu("]'), 'app', { scroll: false, after: 700 });
        await D.click((d) => [...d.querySelectorAll('[onclick^="openGifModal("], button, div')].find(e => /GIF/i.test(e.textContent) && /openGifModal/.test(e.getAttribute('onclick') || '')), 'app', { scroll: false, after: 900 });
        const box = (i) => (d) => d.querySelectorAll('#gifModal .gif-opt input')[i];
        const boxOn = (i) => D.js((w, d) => d.querySelectorAll('#gifModal .gif-opt input')[i].checked);
        if (!boxOn(0)) await D.click(box(0), 'app', { scroll: false, after: 600 });
        if (!boxOn(1)) await D.click(box(1), 'app', { scroll: false, after: 600 });
        await D.click(['#gifModal button', /Find GIFs|Fetch again/], 'app', { scroll: false, after: 300 });
        await D.waitFor(['#gifModal p', /questions have a GIF/], 'app', 20000);
        await D.sleep(900);
        await D.scroll('#gifReview');
        await D.sleep(1500);
        await D.click(['#gifModal button', /^Done$/], 'app', { after: 700 });
        await D.click((d) => d.querySelectorAll('.q-item')[1], 'app', { scroll: false, after: 1500 });
      },
    },
    {
      id: 'present',
      say: "When you're ready, press Present. Your audience scans the QR code with their phones. No app, no sign up. Answers appear live as they come in. Then reveal the answer, and see who got it right!",
      run: async (D) => {
        D.chip(6, 'Present it live');
        await D.click((d) => d.querySelectorAll('.q-item')[0], 'app', { scroll: false, after: 600 });
        await D.click((d) => d.querySelector('button[onclick="openPresentPicker()"]'), 'app', { scroll: false, after: 900 });
        await D.click(['#presentPickerModal button', /Present here/], 'app', { scroll: false, after: 900 });
        await D.click((d) => d.querySelector('[onclick="pickDisplay(\'window\')"]'), 'app', { after: 400 });
        await D.click(['button', /Start presenting/], 'app', { after: 1400 });
        D.hideCursor();
        const code = D.js((w) => w.eval('presentations[activePresId].sessionCode'));
        D.layout('split');
        await D.load('phone', '/answer?signedout#' + code + '/0');   // what the QR on screen encodes
        await D.sleep(900);
        await D.type('input', 'Maya', 'phone', { cps: 8 });
        await D.click(['button', /Continue/], 'phone', { after: 1500 });
        // A few classmates answer too, a moment apart, the way a room does.
        const qid = D.js((w) => w.__videoDB.get('sessions/' + code + '/currentQuestion/id'));
        const bots = [['Leo', 2], ['Sam', 0], ['Priya', 2], ['Ben', 3], ['Ava', 2], ['Noah', 2]];
        const push = (n, a) => D.js((w) => w.__videoDB.set(`sessions/${code}/responses/${qid}/p_bot_${n}`,
          { participantId: 'p_bot_' + n, name: n, answer: `[${a}]`, elapsed: 4000 + Math.random() * 6000, isCorrect: a === 2, submittedAt: Date.now(), attempt: 1 }));
        push(...bots[0]); await D.sleep(500); push(...bots[1]);
        await D.click((d) => [...d.querySelectorAll('button.option')].find(b => /Koala/.test(b.textContent)), 'phone', { after: 700 });
        for (const b of bots.slice(2)) { push(...b); await D.sleep(550); }
        await D.sleep(1200);
        await D.click((d) => d.querySelector('button[onclick^="doReveal();renderPresentSlide"]'), 'app', { scroll: false, after: 2600 });
        D.hideCursor();
      },
    },
    {
      id: 'outro',
      say: "That's it! Open PollSlide and make your first quiz today. And if you ever need a hand, just email help at pollslide dot com.",
      run: async (D) => {
        D.chip(0, '');
        await D.sleep(600);
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>Now it's <em>your</em> turn</h1>
          <p>Make your first quiz or poll in minutes.</p>
          <div class="url">app.pollslide.com</div>
          <p style="margin-top:34px;font-size:28px;">Questions? help@pollslide.com</p>`);
      },
    },
  ],
};
