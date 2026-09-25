/* LoopSlide engine — the shared, pure logic behind screen.html (the TV), play.html (the
 * phones) and loop.html (the studio). No DOM, no Firebase: everything here is a function
 * of the loop definition and the time, which is what makes LoopSlide maintenance-free.
 *
 * THE LOOP IS A FUNCTION OF TIME
 *   A published loop has an `epoch` (ms). Its timeline — questions, reveals, ad cards,
 *   leaderboards — has a fixed total length. What is on screen right now is simply
 *   (now − epoch) mod cycleLength. So:
 *     • there is no server process deciding "next question" — nothing to run or babysit
 *     • a TV that reboots, or a second TV in the same venue, lands on exactly the same slot
 *     • a phone computes the same slot, so it always shows the question that is on screen
 *     • nobody can hijack a screen by writing to the database — screens write nothing
 *   All clients use Firebase's server-time offset, so device clocks do not matter.
 *
 * LEADERBOARD PERIODS  (loop.board.reset)
 *   'cycle'  — resets every time the loop starts over
 *   'days'   — resets every N days (N = loop.board.days; 1 = daily), counted in the
 *              creator's timezone so "daily" means midnight where the venue is
 *   'never'  — cumulative forever
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LoopEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const DEFAULT_TIMING = { question: 20, reveal: 7, ad: 10, board: 12 };   // seconds
  const LIMITS = { sets: 10, itemsPerSet: 40, options: 6, text: 200, option: 80, adText: 240 };
  const MAX_POINTS = 2000;       // per answer, ceiling also enforced in database rules
  /* Languages LoopSlide speaks. `lang` is what the organiser wrote the questions in;
     phones show each player their own language, the TV shows `screenLang` ('auto' = the
     TV browser's own language). Question content in other languages comes from the
     auto-translation stored at loop_i18n/<CODE>/<lang> (api/loop-translate.js). */
  const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'it'];

  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);

  /* Accept only what the product supports, with bounds, so a hand-edited or old loop can
     never produce an empty or infinite timeline. */
  function normalizeLoop(raw) {
    const L = raw && typeof raw === 'object' ? raw : {};
    const t = L.timing || {};
    const timing = {
      question: clampInt(t.question, 5, 120, DEFAULT_TIMING.question),
      reveal:   clampInt(t.reveal,   3, 60,  DEFAULT_TIMING.reveal),
      ad:       clampInt(t.ad,       3, 120, DEFAULT_TIMING.ad),
      board:    clampInt(t.board,    5, 60,  DEFAULT_TIMING.board),
    };
    const b = L.board || {};
    const board = {
      reset: ['cycle', 'days', 'never'].includes(b.reset) ? b.reset : 'cycle',
      days: clampInt(b.days, 1, 365, 1),
      size: clampInt(b.size, 3, 10, 5),
      speed: b.speed !== false,       // faster correct answers earn more
      streak: b.streak !== false,     // consecutive correct answers multiply
      rejoin: b.rejoin === true,      // must re-scan each cycle to keep playing
    };
    const sets = (Array.isArray(L.sets) ? L.sets : []).slice(0, LIMITS.sets).map((s, si) => ({
      id: str(s && s.id, 40) || ('s' + si),
      title: str(s && s.title, 80),
      items: (Array.isArray(s && s.items) ? s.items : []).slice(0, LIMITS.itemsPerSet).map((it, ii) => {
        const id = str(it && it.id, 40) || ('i' + si + '_' + ii);
        if (it && it.type === 'ad') {
          // A card between questions: a sponsor/offer (labelled "Sponsored") or plain media —
          // an announcement, a photo, a GIF, a video. img may be an image, GIF or video URL.
          return { id, type: 'ad', sponsored: it.sponsored !== false, sponsor: str(it.sponsor, 60),
                   headline: str(it.headline, 80), body: str(it.body, LIMITS.adText),
                   img: safeUrl(it.img), link: safeUrl(it.link), ai: it.ai === true };
        }
        /* Options may arrive as strings (LoopSlide) or {text, img} objects (PollSlide decks).
           Text and per-answer images are kept in parallel arrays so a blank option drops both.
           Emojis are ordinary text here and pass straight through. */
        const pairs = (Array.isArray(it && it.options) ? it.options : []).map((o, oi) => {
          const obj = typeof o === 'object' && o ? o : { text: o };
          const img = safeUrl(obj.img) || safeUrl(it && Array.isArray(it.optImgs) ? it.optImgs[oi] : '');
          return { text: str(obj.text, LIMITS.option).trim(), img, keep: oi };
        }).filter(p => p.text || p.img).slice(0, LIMITS.options);
        const options = pairs.map(p => p.text || '🖼️');
        const optImgs = pairs.map(p => p.img);
        const c0 = Number(it && it.correct);
        const cIdx = Number.isInteger(c0) ? pairs.findIndex(p => p.keep === c0) : -1;
        const t = Number(it && it.time);
        return { id, type: 'q', ai: !!(it && (it.ai === true || it.aiGenerated === true || it.aiImage === true)),
                 text: str(it && it.text, LIMITS.text), options, optImgs,
                 correct: cIdx >= 0 ? cIdx : null,
                 img: safeUrl(it && it.img),
                 time: Number.isFinite(t) && t > 0 ? clampInt(t, 5, 120, 0) : 0 };
      }).filter(it => it.type === 'ad' ? (it.headline || it.img) : (it.text && it.options.length >= 2)),
    })).filter(s => s.items.length);
    return {
      name: str(L.name, 80) || 'LoopSlide',
      lang: LANGS.includes(L.lang) ? L.lang : 'en',
      screenLang: LANGS.includes(L.screenLang) ? L.screenLang : 'auto',
      autoTranslate: L.autoTranslate !== false,
      epoch: Number(L.epoch) || 0,
      tzOffsetMin: clampInt(L.tzOffsetMin, -840, 840, 0),
      brand: { accent: /^#[0-9a-f]{6}$/i.test(L.brand && L.brand.accent) ? L.brand.accent : '#6c63ff',
               logo: safeUrl(L.brand && L.brand.logo), title: str(L.brand && L.brand.title, 60) },
      timing, board, sets,
      /* Who runs this, and on what terms. Shown on the phone before anyone plays and on the
         screen where relevant — the organiser is the data controller for what players enter,
         and a prize makes it a promotion with its own rules. */
      compliance: (function (c) {
        c = c || {};
        const age = [0, 13, 16, 18, 21].includes(Number(c.minAge)) ? Number(c.minAge) : 0;
        return { organiser: str(c.organiser, 80), contact: str(c.contact, 120),
                 prize: str(c.prize, 120), rulesUrl: safeUrl(c.rulesUrl), minAge: age,
                 aiNote: c.aiNote === true };
      })(L.compliance),
    };
  }

  // Only https URLs ever reach an <img src> or a QR code on a public screen.
  function safeUrl(u) {
    const s = String(u || '').trim();
    return /^https:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 500 ? s : '';
  }

  /* The ordered list of what a screen shows in one cycle. Each question is followed by its
     reveal; each set ends with that set's leaderboard; a loop with several sets (a bundle)
     ends with the overall leaderboard. */
  function timeline(loop) {
    const L = loop && loop.timing ? loop : normalizeLoop(loop);
    const slots = [];
    L.sets.forEach((set, si) => {
      set.items.forEach((it, ii) => {
        if (it.type === 'ad') slots.push({ kind: 'ad', set: si, item: ii, dur: L.timing.ad });
        else {
          slots.push({ kind: 'question', set: si, item: ii, dur: it.time || L.timing.question });
          slots.push({ kind: 'reveal', set: si, item: ii, dur: L.timing.reveal });
        }
      });
      if (set.items.some(it => it.type === 'q')) slots.push({ kind: 'setboard', set: si, dur: L.timing.board });
    });
    if (L.sets.length > 1) slots.push({ kind: 'grandboard', dur: L.timing.board });
    let at = 0;
    slots.forEach(s => { s.start = at; at += s.dur * 1000; s.end = at; });
    return { slots, length: at };
  }

  /* What is on screen at time t (ms, server time). */
  function positionAt(loop, t) {
    const L = loop && loop.timing ? loop : normalizeLoop(loop);
    const tl = timeline(L);
    if (!tl.length || !L.epoch) return null;
    const elapsed = Math.max(0, t - L.epoch);
    const cycle = Math.floor(elapsed / tl.length);
    const within = elapsed - cycle * tl.length;
    let index = tl.slots.findIndex(s => within >= s.start && within < s.end);
    if (index < 0) index = tl.slots.length - 1;
    const slot = tl.slots[index];
    const cycleStart = L.epoch + cycle * tl.length;
    return { cycle, index, slot, start: cycleStart + slot.start, end: cycleStart + slot.end,
             remainingMs: cycleStart + slot.end - t, cycleLength: tl.length, count: tl.slots.length };
  }

  /* Which leaderboard period time t belongs to. Stored as a database key. */
  function periodKey(loop, t) {
    const L = loop && loop.timing ? loop : normalizeLoop(loop);
    if (L.board.reset === 'never') return 'all';
    if (L.board.reset === 'cycle') {
      const p = positionAt(L, t);
      return 'c' + (p ? p.cycle : 0);
    }
    const day = Math.floor((t + L.tzOffsetMin * 60000) / 86400000);
    return 'd' + Math.floor(day / L.board.days) * L.board.days;
  }

  /* Points for one answer. Wrong or unanswered = 0. Correct = 500 base, + up to 500 for
     speed, then a streak multiplier (x1.2 at 2 in a row, up to x2). Opinion questions (no
     correct answer) give a flat 100 for taking part. Capped at MAX_POINTS. */
  function score(o) {
    if (o.correct === null || o.correct === undefined) return 100;
    if (!o.correct) return 0;
    let pts = 500;
    if (o.speed !== false) {
      const frac = Math.min(1, Math.max(0, (o.ms || 0) / Math.max(1, o.windowMs || 1)));
      pts += Math.round(500 * (1 - frac));
    }
    if (o.streakOn !== false && o.streak > 1) pts = Math.round(pts * Math.min(2, 1 + 0.2 * (o.streak - 1)));
    return Math.min(MAX_POINTS, pts);
  }

  // Public screens show nicknames, so names are filtered before they are ever stored.
  const BAD = ['fuck','shit','bitch','asshole','arsehole','bastard','cunt','slut','whore','dick','piss','cock','pussy','nigger','faggot','retard','wanker','bollocks','prick','douche','motherfucker','jackass','nazi','hitler','rape'];
  const BAD_RE = new RegExp('(' + BAD.join('|') + ')', 'i');   // substring: nicknames have no word boundaries
  function cleanName(s) {
    const n = String(s == null ? '' : s).replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
      .replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
    if (!n || BAD_RE.test(n.replace(/[^a-z]/gi, ''))) return '';
    return n;
  }
  const AVATARS = ['🦊','🐼','🐸','🦁','🐯','🐙','🦄','🐝','🐧','🦉','🐢','🐬','🦖','🐺','🦝','🐨','🐵','🦜','🐞','🍀','🔥','⚡','🎯','🎲','🚀','👾','🍕','🌮','🎸','⭐'];

  function genCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = ''; for (let i = 0; i < 6; i++) out += A[Math.floor(Math.random() * A.length)];
    return out;
  }
  const answerKey = (cycle, itemId) => cycle + '_' + itemId;
  // Media links are images or GIFs unless they point at a video file.
  const isVideo = u => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(u || ''));

  /* ── Translation units ────────────────────────────────────────────────────
     Everything the organiser wrote that a player reads, split into units that are
     translated as a whole (a question WITH its answers, so short answers keep their
     sense). Each unit carries a hash of its source text: a stored translation is only
     used while that hash still matches, so editing a question can never show a stale
     translation — the original shows until the new one arrives. Same code on the
     server (api/loop-translate.js), the TV and the phones, so they always agree. */
  function hashUnit(src) {
    const s = JSON.stringify(src);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  const unitKey = id => String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
  function translationUnits(loop) {
    const L = loop && loop.timing ? loop : normalizeLoop(loop);
    const out = [];
    if (L.brand.title) out.push({ id: 'b', src: { stem: L.brand.title } });
    if (L.compliance.prize) out.push({ id: 'p', src: { stem: L.compliance.prize } });
    L.sets.forEach(set => {
      if (set.title) out.push({ id: 's_' + unitKey(set.id), src: { stem: set.title } });
      set.items.forEach(it => {
        if (it.type === 'ad') {
          const src = {};
          if (it.headline) src.stem = it.headline;
          if (it.body) src.back = it.body;
          if (src.stem || src.back) out.push({ id: 'i_' + unitKey(it.id), src });
        } else {
          out.push({ id: 'i_' + unitKey(it.id), src: { stem: it.text, options: it.options.slice() } });
        }
      });
    });
    out.forEach(u => { u.h = hashUnit(u.src); });
    return out;
  }
  /* A copy of the loop in `lang`, using only translations whose source still matches.
     Option ORDER never changes, so answers are recorded by index exactly as before.
     Translated items are marked `tr: true` so the screen can say so. */
  function localize(loop, tr, lang) {
    const L = loop && loop.timing ? loop : normalizeLoop(loop);
    if (!tr || !tr.u || !lang || lang === L.lang || tr.src !== L.lang) return L;
    const C = JSON.parse(JSON.stringify(L));
    const pick = (id, src) => { const u = tr.u[id]; return u && u.h === hashUnit(src) && u.v ? u.v : null; };
    let v;
    if (C.brand.title && (v = pick('b', { stem: C.brand.title })) && v.stem) C.brand.title = v.stem;
    if (C.compliance.prize && (v = pick('p', { stem: C.compliance.prize })) && v.stem) C.compliance.prize = v.stem;
    C.sets.forEach(set => {
      if (set.title && (v = pick('s_' + unitKey(set.id), { stem: set.title })) && v.stem) set.title = v.stem;
      set.items.forEach(it => {
        if (it.type === 'ad') {
          const src = {}; if (it.headline) src.stem = it.headline; if (it.body) src.back = it.body;
          if ((src.stem || src.back) && (v = pick('i_' + unitKey(it.id), src))) {
            if (src.stem && v.stem) it.headline = v.stem;
            if (src.back && v.back) it.body = v.back;
            it.tr = true;
          }
        } else if ((v = pick('i_' + unitKey(it.id), { stem: it.text, options: it.options }))) {
          if (v.stem) it.text = v.stem;
          if (Array.isArray(v.options) && v.options.length === it.options.length) it.options = v.options.map((o, i) => o || it.options[i]);
          it.tr = true;
        }
      });
    });
    C.localizedTo = lang;
    return C;
  }

  return { DEFAULT_TIMING, LIMITS, MAX_POINTS, AVATARS, LANGS, hashUnit, translationUnits, localize, normalizeLoop, timeline, positionAt,
           periodKey, score, cleanName, safeUrl, genCode, answerKey, isVideo };
});
