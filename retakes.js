/* PollSlide — second attempts.
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * A student answers, then realises they misread the question. Until now the page
 * simply refused: "You already answered this question!". For a live poll that is
 * right — a poll is a snapshot of the room. For a quiz a teacher is using to find
 * out who understood something, it is the wrong answer to the wrong question.
 *
 * THE SHAPE OF THE FIX
 * `sessions/$code/responses/$qid/$pid` keeps meaning exactly what it always meant:
 * THE ANSWER THAT COUNTS. Every existing reader — the live leaderboard, the report,
 * the recap, the dashboards, the CSV — keeps working with no change at all. The
 * history of earlier tries lives beside it, at `sessions/$code/attempts/$qid/$pid/$n`.
 *
 * That one decision is what keeps this feature small. The alternative — making every
 * reader understand attempts — would touch every scoring path in the product, and
 * each of those is a place a grade could come out wrong.
 *
 * WHOSE CHOICE IS WHAT
 * The teacher decides, per deck: whether retakes are allowed at all, how many tries,
 * and which attempt counts. Retakes are OFF by default, so a deck that has always
 * refused a second answer keeps refusing one.
 *
 * WHICH ATTEMPT COUNTS is a genuine pedagogical choice, not a technical one:
 *   best   the point of a retake is to let someone show they've got it now
 *   last   where the latest answer is the current state of their understanding
 *   first  when you want the retake recorded but the original graded
 * Default is `best`, because a teacher who turns retakes ON has already decided the
 * second try should be able to help.
 * --------------------------------------------------------------------------- */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSRetakes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const COUNT_MODES = ['best', 'last', 'first'];
  const MAX_ATTEMPTS = 10;      // past this it isn't a retake, it's a guessing game

  /* Anything stored, missing, half-written or hand-edited becomes a usable policy.
   * A malformed setting must never mean "unlimited retakes on a graded quiz", so
   * every unknown shape falls back to OFF. */
  function retakePolicy(raw) {
    const r = (raw && typeof raw === 'object') ? raw : {};
    const allowed = r.allowed === true;
    let max = parseInt(r.max, 10);
    if (!(max >= 2)) max = 2;                       // "on" means at least a second try
    if (max > MAX_ATTEMPTS) max = MAX_ATTEMPTS;
    const counts = COUNT_MODES.indexOf(r.counts) >= 0 ? r.counts : 'best';
    return { allowed, max, counts };
  }

  // How many tries this student has already used on this question.
  function attemptsUsed(history) {
    if (!history || typeof history !== 'object') return 0;
    return Object.keys(history).length;
  }

  function canRetake(policy, used) {
    const p = retakePolicy(policy);
    return p.allowed && (used || 0) < p.max;
  }

  function attemptsLeft(policy, used) {
    const p = retakePolicy(policy);
    if (!p.allowed) return 0;
    return Math.max(0, p.max - (used || 0));
  }

  /* Mirrors psBasePoints in the shared game-modes block: true = 1, a number = partial
   * credit, anything else = 0. If these two ever disagreed, "best attempt" would pick
   * a different answer than the leaderboard would score — the student would see one
   * number and the teacher another. */
  function scoreOf(rec) {
    if (!rec) return 0;
    if (rec.isCorrect === true) return 1;
    if (typeof rec.isCorrect === 'number' && rec.isCorrect > 0) return rec.isCorrect;
    return 0;
  }

  /* Does this new attempt become the one that counts?
   * `first` never replaces — the attempt is still recorded, just not graded.
   * A tie under `best` keeps the earlier answer: they hadn't improved on it. */
  function shouldReplace(counts, current, incoming) {
    const mode = COUNT_MODES.indexOf(counts) >= 0 ? counts : 'best';
    if (!current) return true;                      // nothing to replace
    if (mode === 'first') return false;
    if (mode === 'last') return true;
    return scoreOf(incoming) > scoreOf(current);
  }

  /* One sentence, written for whoever is reading it. The student needs to know
   * whether trying again can help them; the teacher needs to know what they just
   * switched on. Same policy, two honest descriptions. */
  function describePolicy(policy, audience) {
    const p = retakePolicy(policy);
    if (!p.allowed) {
      return audience === 'student'
        ? 'You get one answer for each question.'
        : 'One answer per question. A second answer is refused.';
    }
    const tries = p.max === 2 ? 'twice' : `up to ${p.max} times`;
    if (audience === 'student') {
      if (p.counts === 'best')  return `You can answer ${tries}. Your best try is the one that counts.`;
      if (p.counts === 'last')  return `You can answer ${tries}. Your last try is the one that counts.`;
      return `You can answer ${tries}, but your first answer is the one that counts.`;
    }
    const which = p.counts === 'best' ? 'best' : p.counts === 'last' ? 'most recent' : 'first';
    return `Students can answer ${tries}. The ${which} attempt is graded; every attempt is kept in the report.`;
  }

  // Short label for the deck menu — must read as a state, not an instruction.
  function shortLabel(policy) {
    const p = retakePolicy(policy);
    if (!p.allowed) return 'Retakes: off';
    const which = p.counts === 'best' ? 'best counts' : p.counts === 'last' ? 'last counts' : 'first counts';
    return `Retakes: ${p.max} tries, ${which}`;
  }

  return {
    COUNT_MODES, MAX_ATTEMPTS,
    retakePolicy, attemptsUsed, canRetake, attemptsLeft,
    scoreOf, shouldReplace, describePolicy, shortLabel,
  };
});
