/* The demo video GIPHY asks for when upgrading an API key to Production:
 * "navigate through all screens that leverage GIPHY, show a GIF being sent, and show the
 * 'Powered by GIPHY' attribution." Every screen in PollSlide that searches GIPHY is here:
 *   1. the GIF picker on a question        (presenter.html — search, attribution, insert)
 *   2. the GIF picker on an answer          (same picker, per answer)
 *   3. "GIFs for every question and answer" (presenter.html deck GIF modal + review)
 *   4. the GIF reaching the audience        (present mode on the big screen + a phone)
 *   5. LoopSlide's "Add media" GIF search   (loop.html)
 *
 *   node scripts/video/record.js giphy-review
 * Stills for the form are saved as out/giphy-review-<name>.png.
 */
module.exports = {
  id: 'giphy-review',
  title: 'PollSlide × GIPHY',
  scenes: [
    {
      id: 'intro',
      say: "This is how PollSlide uses GIPHY. Presenters add GIFs to their quiz and poll questions, and their audience sees them on the big screen and on their phones.",
      pre: async (D) => {
        D.hideCursor();
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>PollSlide <em>×</em> GIPHY</h1>
          <p>Every screen where PollSlide searches and shows GIFs</p>
          <div class="steps"><span>🔍 Question GIFs</span><span>🅰️ Answer GIFs</span><span>🎞 Whole deck</span><span>📱 Audience</span><span>📺 LoopSlide</span></div>`, true);
      },
      run: async (D) => {
        await D.load('app', '/presenter');
        await D.waitFor(['.product-tab', /Quizzes/]);
        await D.click(['.product-tab', /Quizzes/], 'app', { scroll: false, after: 500 });
        await D.click(['button', /Blank Quiz/], 'app', { after: 700 });
        await D.type('#renameInput', 'GIPHY demo', 'app', { clear: true, cps: 30, scroll: false });
        await D.click(['#renamePresModal button', /^Save$/], 'app', { scroll: false, after: 600 });
        await D.click(['button', /Add manually/], 'app', { after: 700 });
        await D.type('textarea[oninput*="\'text\'"]', 'Which animal sleeps the most?', 'app', { cps: 40 });
      },
    },
    {
      id: 'question',
      say: "One. On any question, tap GIF and search. Results come from GIPHY, credited Powered by GIPHY. Pick one, and it is inserted into the question.",
      run: async (D) => {
        D.card('');
        D.chip(1, 'Search GIPHY for a question');
        await D.click((d) => d.querySelector('button[onclick^="openGifPicker(function(url){updateQ(0,"]'), 'app', { after: 600 });
        await D.type('#gifPickerInput', 'alarm clock', 'app', { clear: true, cps: 12, scroll: false });
        await D.click(['button', /^Search$/], 'app', { scroll: false, after: 1500 });
        await D.focus('#gifPickerCredit', 2.6);
        await D.snap('attribution');
        await D.sleep(1200);
        await D.unfocus();
        await D.click((d) => [...d.querySelectorAll('.gif-thumb')].find(g => /Digital alarm/i.test(g.title)) || d.querySelector('.gif-thumb'), 'app', { scroll: false, after: 1400 });
      },
    },
    {
      id: 'answer',
      say: "Two. Every answer can have its own GIF, from the same GIPHY search.",
      run: async (D) => {
        D.chip(2, 'A GIF for an answer');
        const opt = (i) => (d) => d.querySelector(`input.opt-input[oninput^="updateOpt(0,${i},"]`);
        const names = ['Sloth', 'Lion', 'Koala', 'Panda'];
        for (let i = 0; i < 4; i++) await D.type(opt(i), names[i], 'app', { cps: 30 });
        await D.click((d) => d.querySelector('[onclick="toggleCorrect(0,2)"]'), 'app', { after: 400 });
        await D.click((d) => d.querySelector('button[onclick^="openGifPicker(function(url){updateOptImg(0,2,"]'), 'app', { after: 600 });
        await D.type('#gifPickerInput', 'koala', 'app', { clear: true, cps: 12, scroll: false });
        await D.click(['button', /^Search$/], 'app', { scroll: false, after: 1500 });
        await D.click('.gif-thumb', 'app', { scroll: false, after: 1000 });
        await D.scroll((d) => d.querySelector('input.opt-input[oninput^="updateOpt(0,2,"]'));
        await D.sleep(800);
      },
    },
    {
      id: 'deck',
      say: "Three. A presenter can fill every question and every answer at once. PollSlide searches GIPHY with safe search locked to G, and the presenter reviews each GIF before anyone sees it.",
      run: async (D) => {
        D.chip(3, 'GIFs for a whole deck');
        await D.click(['button', /Done & Go Live/], 'app', { after: 600 });
        await D.click((d) => d.querySelector('[onclick^="openDeckMenu("]'), 'app', { scroll: false, after: 700 });
        await D.click((d) => [...d.querySelectorAll('button, div')].find(e => /openGifModal/.test(e.getAttribute('onclick') || '')), 'app', { scroll: false, after: 900 });
        const boxOn = (i) => D.js((w, d) => d.querySelectorAll('#gifModal .gif-opt input')[i].checked);
        const box = (i) => (d) => d.querySelectorAll('#gifModal .gif-opt input')[i];
        if (!boxOn(0)) await D.click(box(0), 'app', { scroll: false, after: 500 });
        if (!boxOn(1)) await D.click(box(1), 'app', { scroll: false, after: 500 });
        await D.click(['#gifModal button', /Find GIFs|Fetch again/], 'app', { scroll: false, after: 300 });
        await D.waitFor(['#gifModal p', /questions have a GIF/], 'app', 20000);
        await D.sleep(700);
        const credit = (d) => [...d.querySelectorAll('#gifModal p')].find(p => /Powered by GIPHY/.test(p.textContent));
        await D.scroll(credit);
        await D.focus(credit, 2.0);
        await D.sleep(1600);
        await D.unfocus();
        await D.click(['#gifModal button', /^Done$/], 'app', { after: 600 });
      },
    },
    {
      id: 'audience',
      say: "Four. The GIF is sent to the audience. It appears on the big screen, credited GIFs via GIPHY, and on every phone that joins with the QR code.",
      run: async (D) => {
        D.chip(4, 'Sent to the audience');
        await D.click((d) => d.querySelector('button[onclick="openPresentPicker()"]'), 'app', { scroll: false, after: 800 });
        await D.click(['#presentPickerModal button', /Present here/], 'app', { scroll: false, after: 800 });
        await D.click((d) => d.querySelector('[onclick="pickDisplay(\'window\')"]'), 'app', { after: 300 });
        await D.click(['button', /Start presenting/], 'app', { after: 1200 });
        D.hideCursor();
        const code = D.js((w) => w.eval('presentations[activePresId].sessionCode'));
        D.layout('split');
        await D.load('phone', '/answer?signedout#' + code + '/0');
        await D.sleep(700);
        await D.type('input', 'Maya', 'phone', { cps: 10 });
        await D.click(['button', /Continue/], 'phone', { after: 1800 });
        D.hideCursor(); await D.sleep(400);
        await D.snap('in-action');
        await D.click((d) => [...d.querySelectorAll('button.option')].find(b => /Koala/.test(b.textContent)), 'phone', { after: 900 });
        D.hideCursor();
        D.layout('full');
        await D.sleep(1200);
        await D.focus((d) => [...d.querySelectorAll('div')].find(e => !e.children.length && /^GIFs via GIPHY$/.test(e.textContent.trim())), 2.6);
        await D.sleep(1400);
        await D.unfocus();
      },
    },
    {
      id: 'loopslide',
      say: "Five. In LoopSlide, our quiz for screens in cafés and waiting rooms, Add media searches GIPHY the same way, with the same attribution.",
      run: async (D) => {
        D.chip(5, 'LoopSlide: Add media');
        await D.load('app', '/loop');
        await D.click(['button', /New loop/], 'app', { after: 1200 });
        await D.click((d) => d.querySelector('button[onclick="addQ(0)"]'), 'app', { after: 700 });
        await D.type((d) => d.querySelector('input[oninput$="].text=this.value"]'), 'Which animal sleeps the most?', 'app', { cps: 40 });
        await D.click((d) => d.querySelector('button[onclick="mediaFor(0,0,\'img\')"]'), 'app', { after: 1800 });
        await D.focus('#gattr', 2.4);
        await D.sleep(1400);
        await D.unfocus();
        await D.click('#gres img', 'app', { scroll: false, after: 1500 });
      },
    },
    {
      id: 'outro',
      say: "Every search runs through our server, with GIPHY's G rating locked on, and Powered by GIPHY is shown wherever people search. Thank you.",
      run: async (D) => {
        D.chip(0, '');
        D.hideCursor();
        await D.sleep(500);
        D.card(`<div class="logo"><i></i>PollSlide</div>
          <h1>Safe, credited, <em>reviewed</em></h1>
          <div class="steps" style="flex-direction:column;align-items:center;">
            <span>🔒 Server-side search · rating locked to G</span>
            <span>👀 Presenters review every GIF before it is shown</span>
            <span>🏷 “Powered by GIPHY” wherever people search</span></div>
          <p style="margin-top:34px;font-size:28px;">pollslide.com · help@pollslide.com</p>`);
      },
    },
  ],
};
