/* PollSlide — how a student is doing over time.
 * ---------------------------------------------------------------------------
 * Stable student identity was built so one student is one person across devices,
 * sessions and differently-typed names. This is the thing that identity was FOR:
 * "is Ana getting this?" — a question a per-session report cannot answer.
 *
 * THE HONESTY PROBLEM, WHICH IS THE WHOLE DESIGN
 * A trend line through two points is not a trend, it is a line. Telling a teacher that
 * a child is "declining" on the strength of two quizzes — one of which they may have
 * taken with a headache — is worse than telling them nothing, because it carries the
 * authority of a computed number and it will reach a parents' evening.
 *
 * So:
 *   • Below MIN_FOR_TREND sessions the answer is "not enough yet", never a direction.
 *   • A change smaller than NOISE_BAND is "steady", not a direction. Real classroom
 *     scores bounce by ten points for reasons that have nothing to do with learning.
 *   • Trend compares the FIRST HALF to the SECOND HALF, not first-to-last. One bad
 *     Monday should not be able to invert a term's worth of progress.
 *   • Ungraded questions never enter a score. A reflection prompt is not a mark.
 *
 * This module reports what the numbers say and refuses to say more than they support.
 * --------------------------------------------------------------------------- */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const MIN_FOR_TREND = 3;     // fewer than three sittings is not a direction
  const NOISE_BAND = 8;        // percentage points; below this it is "steady"

  // Mirrors psBasePoints and gradebook.points — one definition of "a mark".
  function points(rec) {
    if (!rec) return null;
    if (rec.isCorrect === true) return 1;
    if (typeof rec.isCorrect === 'number' && rec.isCorrect > 0) return rec.isCorrect;
    if (rec.isCorrect === false || rec.isCorrect === 0) return 0;
    return null;                 // ungraded — not a zero, and not part of a score
  }

  // Same rule as report.html and gradebook.js: the class roster's id, else the name.
  const keyOf = (r) => (r && r.studentId) || ('name:' + String((r && r.name) || '').trim().toLowerCase());

  /* A "sitting" is one deck on one day. Two questions answered in the same session
   * belong to one score; the same deck retaken next term is a separate one, because
   * that is the comparison a teacher means when they ask whether someone improved. */
  const sittingOf = (r) => {
    const day = r && r.date ? new Date(r.date).toISOString().slice(0, 10) : 'undated';
    return `${(r && r.presId) || '?'}|${day}`;
  };

  function round(n) { return Math.round(n * 10) / 10; }

  /* first half vs second half. With an odd count the middle sitting is deliberately
   * left out of both — it belongs to neither half, and letting it tip the comparison
   * would make a three-session trend hinge on one score. */
  function trendOf(scores) {
    if (!Array.isArray(scores) || scores.length < MIN_FOR_TREND) {
      return { direction: 'unknown', change: null,
               why: `Needs ${MIN_FOR_TREND} sittings before a direction means anything.` };
    }
    const half = Math.floor(scores.length / 2);
    const first = scores.slice(0, half);
    const last = scores.slice(scores.length - half);
    const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
    const change = round(avg(last) - avg(first));
    if (Math.abs(change) < NOISE_BAND) {
      return { direction: 'steady', change,
               why: `Moved ${change > 0 ? '+' : ''}${change} points — inside normal variation.` };
    }
    return { direction: change > 0 ? 'improving' : 'declining', change,
             why: `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)} points from their first sittings to their most recent.` };
  }

  /**
   * records: report.html's flattened rows (one per answer), any number of sessions.
   * Returns one entry per student, newest sitting last.
   */
  function byStudent(records) {
    const recs = (Array.isArray(records) ? records : []).filter(Boolean);
    const people = new Map();

    recs.forEach(r => {
      const p = points(r);
      const k = keyOf(r);
      if (!people.has(k)) {
        people.set(k, { key: k, name: r.name || 'Anonymous', studentId: r.studentId || '', sittings: new Map() });
      }
      const person = people.get(k);
      if (r.name) person.name = r.name;
      if (r.studentId) person.studentId = r.studentId;

      const sid = sittingOf(r);
      if (!person.sittings.has(sid)) {
        person.sittings.set(sid, { id: sid, presId: r.presId, presName: r.presName || '',
                                   date: r.date || null, earned: 0, graded: 0, answered: 0 });
      }
      const s = person.sittings.get(sid);
      s.answered++;
      if (r.date && (!s.date || r.date < s.date)) s.date = r.date;   // when it started
      if (p !== null) { s.graded++; s.earned += p; }
    });

    return [...people.values()].map(person => {
      const sittings = [...person.sittings.values()]
        .filter(s => s.graded > 0)                 // an ungraded survey is not a score
        .sort((a, b) => (a.date || 0) - (b.date || 0))
        .map(s => ({ ...s, score: Math.round(s.earned / s.graded * 100) }));
      const scores = sittings.map(s => s.score);
      const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      return {
        key: person.key, name: person.name, studentId: person.studentId,
        sittings, scores, sittingCount: sittings.length,
        average: avg,
        best: scores.length ? Math.max(...scores) : null,
        latest: scores.length ? scores[scores.length - 1] : null,
        trend: trendOf(scores),
      };
    }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /* Who to look at first. NOT a ranking — a teacher does not need a leaderboard of
   * their own class, they need to know who to check on. Lowest recent score first,
   * and anyone genuinely declining ahead of anyone merely low, because a drop is news
   * and a consistently low score usually is not. */
  function needsAttention(students, limit) {
    const list = (Array.isArray(students) ? students : []).filter(s => s.sittingCount > 0);
    const scored = list.map(s => ({
      ...s,
      _rank: (s.trend.direction === 'declining' ? -1000 : 0) + (s.latest == null ? 999 : s.latest),
    }));
    return scored.sort((a, b) => a._rank - b._rank).slice(0, limit || 5)
                 .filter(s => s.trend.direction === 'declining' || (s.latest != null && s.latest < 60));
  }

  /* One line for the class as a whole. Deliberately plain: no letter grades, no
   * percentile, nothing that reads as a judgement PollSlide is not qualified to make. */
  function classSummary(students) {
    const withScores = (students || []).filter(s => s.average != null);
    if (!withScores.length) return { students: 0, average: null, sittings: 0 };
    const sittings = withScores.reduce((n, s) => n + s.sittingCount, 0);
    return {
      students: withScores.length,
      average: Math.round(withScores.reduce((n, s) => n + s.average, 0) / withScores.length),
      sittings,
      improving: withScores.filter(s => s.trend.direction === 'improving').length,
      declining: withScores.filter(s => s.trend.direction === 'declining').length,
      notEnoughYet: withScores.filter(s => s.trend.direction === 'unknown').length,
    };
  }

  return { MIN_FOR_TREND, NOISE_BAND, points, keyOf, sittingOf, trendOf,
           byStudent, needsAttention, classSummary };
});
