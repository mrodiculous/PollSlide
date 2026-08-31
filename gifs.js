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

  const MAX_TERM_WORDS = 4;
  const MAX_TERM_CHARS = 60;

  /* Reaction terms for the reveal, when the answer itself has nothing to picture.
   * Separate lists so a wrong answer never gets a celebration. */
  const REACTION = {
    correct: ['celebration', 'well done', 'applause', 'yes success', 'high five'],
    neutral: ['drum roll', 'the answer is', 'reveal', 'thinking'],
  };

  function words(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')     // keep letters, numbers, apostrophes, hyphens
      .split(/\s+/)
      .filter(Boolean);
  }

  /* Reduce a sentence to the words that carry the picture, in their original order.
   * Order matters: "dating millennials" and "millennials dating" return different GIFs,
   * and the original order is the one a person would have typed. */
  function searchTerm(text) {
    const w = words(text);
    if (!w.length) return '';
    let keep = w.filter(x => x.length > 2 && !STOP.has(x));
    // A question made entirely of stopwords ("What is it?") keeps its longest words
    // rather than searching for nothing at all.
    if (!keep.length) keep = w.slice().sort((a, b) => b.length - a.length).slice(0, 2);
    return keep.slice(0, MAX_TERM_WORDS).join(' ').slice(0, MAX_TERM_CHARS).trim();
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
  function answerTerm(answer, opts) {
    const o = opts || {};
    if (answerIsPicturable(answer)) return searchTerm(answer);
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
  function gifPolicy(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    return { question: r.question === true, answer: r.answer === true };
  }
  const gifsEnabled = (raw) => { const p = gifPolicy(raw); return p.question || p.answer; };

  /* One Tenor result → the small record stored on the question. Everything the renderer
   * and the audit log need, and nothing else. */
  function normalizeResult(r) {
    if (!r || typeof r !== 'object') return null;
    const media = (r.media_formats || r.media || {});
    const pick = (...names) => {
      for (const n of names) {
        const m = media[n];
        const url = m && (m.url || (Array.isArray(m) ? null : null));
        if (url) return { url, dims: m.dims || null };
      }
      return null;
    };
    // gif is the animation; gifpreview/tinygif is the still shown under reduced motion.
    const anim = pick('tinygif', 'gif', 'mediumgif');
    const still = pick('gifpreview', 'tinygifpreview', 'nanogifpreview');
    if (!anim) return null;
    return {
      id: String(r.id || ''),
      url: anim.url,
      still: still ? still.url : null,
      width: (anim.dims && anim.dims[0]) || null,
      height: (anim.dims && anim.dims[1]) || null,
      // content_description is Tenor's own alt text — a real sentence, not a filename.
      alt: String(r.content_description || r.title || '').slice(0, 140),
      source: 'tenor',
    };
  }

  /* Choose from the candidates. Wildly wide or tall GIFs break the slide layout, and a
   * result with no description cannot be given alt text — which would make the slide
   * inaccessible to a student using a screen reader, so it is skipped rather than
   * shipped with an empty alt. */
  function pickBest(results, opts) {
    const o = opts || {};
    const list = (Array.isArray(results) ? results : []).map(normalizeResult).filter(Boolean);
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
  searchTerm, answerTerm, answerIsPicturable, gifPolicy, gifsEnabled,
  normalizeResult, pickBest,
};

});
