/* PollSlide — contextual GIFs for questions and answers.
 * ---------------------------------------------------------------------------
 * A per-deck setting: put a GIF beside each question, beside each revealed answer, or
 * both. Candidates are fetched when the teacher ticks the box and shown in the editor
 * for review — nothing unvetted ever reaches a projector in front of a class.
 *
 * THREE THINGS THIS MODULE EXISTS TO GET RIGHT
 *
 * 1. A GOOD SEARCH TERM. "Which app do millennials blame for ruining dating?" searched
 *    verbatim returns nothing useful. The words that carry the picture are "millennials
 *    dating" — so the question is reduced to its content words, in order, capped short.
 *    Search engines for GIFs are keyword engines, not sentence engines.
 *
 * 2. AN ANSWER IS OFTEN NOT SEARCHABLE. The correct answer to a maths question is "42";
 *    to a multiple-choice question it may be "B". Searching those returns noise or
 *    something worse. When an answer has nothing to picture, this falls back to a
 *    REACTION term — the moment being illustrated is "the answer is revealed", and a
 *    celebration GIF is honest about that where a literal one would be nonsense.
 *
 * 3. SAFETY IS NOT A PREFERENCE. This is used in classrooms. The content filter is set
 *    here and cannot be lowered by a caller — see SAFE_FILTER. A deck-level toggle that
 *    could turn safety down would eventually be turned down.
 * --------------------------------------------------------------------------- */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSGifs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* Tenor's strictest setting. Deliberately a constant and never a parameter: the moment
   * this becomes an option, some code path passes 'medium'. If a looser filter is ever
   * genuinely needed, that is a new named export with its own justification, not a knob. */
  const SAFE_FILTER = 'high';

  // Words that never help a picture search. Kept small on purpose — an aggressive list
  // strips the meaning out of short questions.
  const STOP = new Set(('a an the and or but if then than that this these those of to in on at by for ' +
    'with from into about as is are was were be been being do does did doing have has had having ' +
    'will would shall should can could may might must it its it\'s they them their there here what ' +
    'which who whom whose when where why how many much most more some any all each every both ' +
    'you your yours we our us i me my he she his her him not no nor so too very just only own same ' +
    'up down out off over under again further once').split(' '));

  const MAX_TERM_WORDS = 2;      // a GIF search is a keyword search, not a sentence
  const MAX_TERM_CHARS = 40;

  /* Prepositions STOP does not carry. STOP is tuned for scoring question words, where
   * these are rare; an ANSWER is where they show up ("water THROUGH the stem"), and one
   * left in front turns the search into a phrase nothing matches. */
  const PREP = new Set(('through during before after above below between among within without '
    + 'across behind beyond toward towards upon against along around near per via versus '
    + 'inside outside beside besides despite except including regarding until while since').split(' '));

  /* Words that appear in questions and never describe what the question is ABOUT.
   * These are the scaffolding of asking — "which of the following best describes" —
   * and every one of them that survives into the search dilutes the word that matters.
   * Separate from STOP because these are specifically quiz-shaped, not generally common. */
  const SCAFFOLD = new Set(('following best describes describe identify choose select name state '
    + 'define definition correct incorrect true false statement statements option options answer '
    + 'answers question questions example examples term terms called known mainly mostly primarily '
    + 'commonly generally usually typically often sometimes always never main chief major minor '
    + 'result results cause causes reason reasons purpose type types kind kinds part parts number '
    + 'amount level stage step steps way ways thing things word words letter letters year years '
    + 'time times day days did does do done use used uses using come comes came go goes went '
    + 'get gets got make makes made take takes took give gives gave say says said').split(' '));

  /* Reaction terms for the reveal, when the answer itself has nothing to picture.
   * Separate lists so a wrong answer never gets a celebration. */
  const REACTION = {
    correct: ['celebration', 'well done', 'applause', 'yes success', 'high five'],
    neutral: ['drum roll', 'the answer is', 'reveal', 'thinking'],
  };

  function words(s) {
    return String(s == null ? '' : s)
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  /* THE ONE THING THE QUESTION IS ABOUT.
   *
   * "Which of the following best describes photosynthesis?" should search for
   * `photosynthesis`, not for `following best describes photosynthesis`. A GIF engine
   * is a keyword engine: every extra word narrows the pool toward nothing, and the
   * words that survive from a question are usually the ones asking it rather than the
   * one being asked about.
   *
   * So candidates are SCORED rather than taken in order:
   *   • a capitalised word mid-sentence is a proper noun, and proper nouns are the most
   *     searchable things there are — adjacent ones stay together ("Berlin Wall")
   *   • later words score higher: English questions put the topic at the end
   *     ("...blame for ruining DATING?")
   *   • longer words score higher — specific beats generic
   *   • a gerund straight after a preposition is usually the verb of the asking
   *     ("for RUINING dating"), not the subject
   */
  function searchTerm(text) {
    const raw = words(text);
    if (!raw.length) return '';
    const lower = raw.map(w => w.toLowerCase());

    // Keep runs of capitalised words together — "Berlin Wall", "French Revolution".
    const proper = [];
    for (let i = 1; i < raw.length; i++) {          // skip index 0: sentence case
      if (!/^[A-Z][a-z'-]+$/.test(raw[i])) continue;
      const run = [raw[i]];
      while (i + 1 < raw.length && /^[A-Z][a-z'-]+$/.test(raw[i + 1])) { run.push(raw[i + 1]); i++; }
      if (!run.every(w => STOP.has(w.toLowerCase()))) proper.push(run.join(' '));
    }
    if (proper.length) return proper[proper.length - 1].slice(0, MAX_TERM_CHARS);

    const scored = [];
    lower.forEach((w, i) => {
      if (w.length < 3 || STOP.has(w) || SCAFFOLD.has(w)) return;
      let score = 0;
      score += (i / Math.max(1, lower.length - 1)) * 3;    // topic tends to come last
      score += Math.min(w.length, 12) / 6;                 // specific words are longer
      // "for ruining dating" — the gerund is how the question is phrased, not its subject
      if (/ing$/.test(w) && i > 0 && ['for','of','at','by','in','on','about','with'].includes(lower[i-1])) score -= 2.5;
      if (/ing$/.test(w)) score -= 0.6;
      scored.push({ w: raw[i], score, i });
    });
    if (!scored.length) {
      // A question made only of scaffolding still has to search for something.
      const fallback = raw.filter(w => w.length > 3);
      return (fallback.length ? fallback : raw).slice(-MAX_TERM_WORDS).join(' ').slice(0, MAX_TERM_CHARS);
    }
    const top = scored.slice().sort((a, b) => b.score - a.score).slice(0, MAX_TERM_WORDS);
    /* Two words only when the second is nearly as good AND sits beside the first —
     * "time zones", "programming language". A distant second word is a different idea
     * and pairing them searches for neither. */
    top.sort((a, b) => a.i - b.i);
    const best = scored.slice().sort((a, b) => b.score - a.score)[0];
    const keep = top.filter(x => x === best || (Math.abs(x.i - best.i) === 1 && x.score > best.score * 0.62));
    return keep.map(x => x.w.toLowerCase()).join(' ').slice(0, MAX_TERM_CHARS).trim();
  }

  /* Is this answer worth searching for a picture of? "42", "B", "true" and "none of the
   * above" are not — searching them returns noise, and for a single letter it returns
   * whatever that letter happens to be a meme for, which is the risk this avoids. */
  function answerIsPicturable(answer) {
    const raw = String(answer == null ? '' : answer).trim();
    if (raw.length < 3) return false;                        // "B", "42"
    if (/^[\d\s.,%+\-/*=<>()]+$/.test(raw)) return false;    // pure numbers or arithmetic
    if (/^(true|false|yes|no|both|neither|all|none)\b/i.test(raw)) return false;
    if (/^(all|none) of the above$/i.test(raw)) return false;
    const w = words(raw).filter(x => !STOP.has(x) && x.length > 2);
    return w.length > 0;
  }

  /* The term for the reveal. `seed` makes the reaction choice stable for a given
   * question — the same deck presented twice should not shuffle its GIFs, which would
   * make a teacher think something is broken. */
  /* An ANSWER is not a question and must not be mined like one. searchTerm exists to
   * find the subject hiding inside a sentence that is mostly asking; an answer IS the
   * subject already. Running it through the same extractor turned "the Amazon
   * rainforest" into "Amazon" — which is a shopping company, not a forest.
   * So: tidy it, do not dissect it. */
  function cleanAnswer(answer) {
    const w = String(answer == null ? '' : answer)
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
    // Only a leading article goes; everything else is the answer the teacher wrote.
    while (w.length > 1 && ['the','a','an'].includes(w[0].toLowerCase())) w.shift();
    if (!w.length) return '';
    /* Keep the END, not the start. An English answer is head-final — the thing it is
     * ABOUT is the last noun phrase ("converting light into CHEMICAL ENERGY"). Taking
     * the first three words instead produced "Converting light into": a fragment ending
     * on a preposition that image search returns nothing for. That is why a fetch came
     * back with a GIF on every question and none on any answer — the question terms
     * were real words, the answer terms were sentence stubs.
     *
     * Function words are dropped everywhere, not just at the ends: trimming only the
     * ends still left "through the stem" and "sugar to grow", because the preposition
     * sits inside the window rather than on its edge. */
    const content = w.filter(x => !STOP.has(x.toLowerCase()) && !PREP.has(x.toLowerCase()));
    /* A short capitalised run is a NAME, and a name survives whole or not at all —
     * cutting "World War Two" to the last two words gives "War Two", which is not a
     * thing. Only applies when the entire answer is that name; a capitalised word inside
     * a longer sentence still goes through the normal tail. */
    if (content.length && content.length <= 3 && content.every(x => /^\p{Lu}/u.test(x))) {
      return content.join(' ').slice(0, MAX_TERM_CHARS).trim();
    }
    const out = (content.length ? content : w).slice(-MAX_TERM_WORDS);
    return out.join(' ').slice(0, MAX_TERM_CHARS).trim();
  }

  function answerTerm(answer, opts) {
    const o = opts || {};
    if (answerIsPicturable(answer)) return cleanAnswer(answer);
    const list = o.correct === false ? REACTION.neutral : REACTION.correct;
    const seed = Math.abs(hash(String(o.seed == null ? answer : o.seed)));
    return list[seed % list.length];
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h;
  }

  /* Normalise the deck-level setting. Anything unrecognised means off — a malformed
   * value must never turn a feature on that puts third-party images on a projector. */
  /* THREE INDEPENDENT SLOTS, not one setting with modes:
   *   question   — a GIF beside the question, up the whole time
   *   answer     — ONE GIF on the correct answer, held back until the reveal
   *   allAnswers — a GIF on EVERY choice, so no single card is decorated
   * The third exists because a picture on the right answer and nothing on the others
   * is a tell the moment they are shown together. `answer` avoids that by waiting for
   * the reveal; `allAnswers` avoids it by giving every option one. They are separate
   * because a deck can legitimately want either, or both. */
  function gifPolicy(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    return { question: r.question === true, answer: r.answer === true,
             allAnswers: r.allAnswers === true };
  }
  const gifsEnabled = (raw) => {
    const p = gifPolicy(raw); return p.question || p.answer || p.allAnswers;
  };

  /* PROVIDER SHAPES LIVE HERE AND NOWHERE ELSE.
   * Tenor and Giphy return completely different JSON. Keeping both normalisers in one
   * place means adding a third provider is a change to this file and the endpoint, and
   * to nothing else — the presenter, the review UI and the slide renderer only ever see
   * the normalised record below.
   *
   * THE RECORD: { id, url, still, width, height, alt, source }
   *   url    the animation
   *   still  a single frame, for anyone who asked for reduced motion
   *   alt    a real sentence. A result without one is dropped in pickBest.
   */
  function normalizeTenor(r) {
    if (!r || typeof r !== 'object') return null;
    const media = (r.media_formats || r.media || {});
    const pick = (...names) => {
      for (const n of names) {
        const m = media[n];
        if (m && m.url) return { url: m.url, dims: m.dims || null };
      }
      return null;
    };
    const anim = pick('tinygif', 'gif', 'mediumgif');
    const still = pick('gifpreview', 'tinygifpreview', 'nanogifpreview');
    if (!anim) return null;
    return {
      id: String(r.id || ''),
      url: anim.url,
      still: still ? still.url : null,
      width: (anim.dims && anim.dims[0]) || null,
      height: (anim.dims && anim.dims[1]) || null,
      alt: String(r.content_description || r.title || '').slice(0, 140),
      source: 'tenor',
    };
  }

  /* Giphy. Different enough to be worth spelling out: images are a named map of
   * objects with STRING width/height, and the alt text is `alt_text` — a newer field
   * that is often absent, in which case `title` is the only thing left. */
  function normalizeGiphy(r) {
    if (!r || typeof r !== 'object') return null;
    const im = r.images || {};
    const pick = (...names) => {
      for (const n of names) {
        const m = im[n];
        if (m && m.url) return { url: m.url, w: parseInt(m.width, 10) || null, h: parseInt(m.height, 10) || null };
      }
      return null;
    };
    const anim = pick('fixed_height_small', 'downsized', 'fixed_height', 'original');
    const still = pick('fixed_height_small_still', 'downsized_still', 'fixed_height_still', 'original_still');
    if (!anim) return null;
    return {
      id: String(r.id || ''),
      url: anim.url,
      still: still ? still.url : null,
      width: anim.w, height: anim.h,
      alt: String(r.alt_text || r.title || '').slice(0, 140),
      source: 'giphy',
    };
  }

  // Raw provider list → normalised records. The ONE place a provider name is mapped.
  function normalizeMany(list, source) {
    const fn = source === 'giphy' ? normalizeGiphy : normalizeTenor;
    return (Array.isArray(list) ? list : []).map(fn).filter(Boolean);
  }

  /* Choose from the candidates. Wildly wide or tall GIFs break the slide layout, and a
   * result with no description cannot be given alt text — which would make the slide
   * inaccessible to a student using a screen reader, so it is skipped rather than
   * shipped with an empty alt. */
  function pickBest(records, opts) {
    const o = opts || {};
    /* These are ALREADY normalised — the endpoint does that, because only the server
     * knows which provider answered. An earlier version normalised here as well, so
     * every real result was normalised twice and came back null; it only looked fine
     * because the test stub returned raw provider JSON instead of what the endpoint
     * actually sends. Hence the contract is stated, and tested, rather than assumed. */
    const list = (Array.isArray(records) ? records : []).filter(g => g && g.url);
    const usable = list.filter(g => {
      if (!g.alt) return false;
      if (!g.width || !g.height) return true;              // unknown dims: allow
      const ratio = g.width / g.height;
      return ratio > 0.4 && ratio < 3.2;
    });
    const pool = usable.length ? usable : list.filter(g => g.alt);
    if (!pool.length) return null;
    // Stable choice for a given seed, so re-opening a deck shows the same GIF.
    const i = o.seed == null ? 0 : Math.abs(hash(String(o.seed))) % pool.length;
    return pool[i];
  }


  return {
  SAFE_FILTER, MAX_TERM_WORDS, REACTION,
  searchTerm, answerTerm, cleanAnswer, answerIsPicturable, gifPolicy, gifsEnabled,
  normalizeTenor, normalizeGiphy, normalizeMany, pickBest,
};

});
