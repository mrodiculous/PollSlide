/* PollSlide — the export a teacher actually files.
 * ---------------------------------------------------------------------------
 * The existing CSV export is a list of ANSWERS: one row per response, good for
 * reading what people said. A gradebook is a different shape entirely — one row per
 * student, one column per question, a score on the end — because that is the shape
 * Google Classroom and Canvas import, and the shape a teacher's own spreadsheet
 * already has. Handing a teacher 400 answer rows and asking them to pivot it is
 * handing them homework.
 *
 * THREE THINGS THIS GETS RIGHT ON PURPOSE
 *
 * 1. A blank cell is not a zero. A student who never answered and a student who
 *    answered wrongly are different facts about different children, and collapsing
 *    them into "0" is the export quietly inventing a wrong grade. Blank means no
 *    answer; 0 means answered and earned nothing. The Answered column makes the
 *    difference legible without reading every cell.
 *
 * 2. One row per PERSON. Grouping is by studentId when the deck belongs to a class,
 *    so a student who answered on the school Chromebook and finished on their phone
 *    is one row — the same rule the live leaderboard uses.
 *
 * 3. Only graded questions become columns. A reflection prompt with no correct answer
 *    is not part of a grade, and a column of blanks in a gradebook import is noise
 *    that someone has to delete by hand.
 *
 * AND ONE THING ABOUT SPREADSHEETS
 * A cell beginning = + - or @ is a FORMULA to Excel, Sheets and Numbers. Student
 * names and typed answers come from people, so an answer of `=1+1` becomes a live
 * formula in the teacher's gradebook, and `=HYPERLINK(...)` becomes something worse.
 * Every cell is neutralised on the way out. See csvCell.
 * --------------------------------------------------------------------------- */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSGradebook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* Formula injection. Excel/Sheets/Numbers treat a leading = + - @ (and a leading
   * tab or carriage return, which people paste without seeing) as the start of a
   * formula, so a NAME or an ANSWER can execute in the teacher's spreadsheet. A
   * leading apostrophe is the standard neutraliser: spreadsheets strip it on display,
   * so the cell still READS correctly to the teacher. */
  function csvCell(v) {
    let s = (v === null || v === undefined) ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCSV(rows) {
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n');   // CRLF: Excel's dialect
  }

  // Mirrors psBasePoints, so a gradebook cell and the leaderboard never disagree.
  function points(rec) {
    if (!rec) return null;
    if (rec.isCorrect === true) return 1;
    if (typeof rec.isCorrect === 'number' && rec.isCorrect > 0) return rec.isCorrect;
    if (rec.isCorrect === false || rec.isCorrect === 0) return 0;
    return null;                       // ungraded — not a zero
  }

  const isGraded = (rec) => points(rec) !== null;

  /* Identity: the class roster's stable id when there is one, otherwise the typed
   * name folded to lower case. Matches report.html's respondentKey — if these two
   * ever diverged, the gradebook would have a different set of students than the
   * report the teacher was just looking at. */
  function respondentKey(r) {
    return (r && r.studentId) || ('name:' + String((r && r.name) || '').trim().toLowerCase());
  }

  function round(n) { return Math.round(n * 100) / 100; }

  /**
   * records: flattened answer rows (report.html's shape) for ONE presentation.
   * Returns { headers, rows, students, questions, skipped, warnings }.
   */
  function buildGradebook(records, opts) {
    const o = opts || {};
    const recs = Array.isArray(records) ? records.filter(Boolean) : [];

    // Which questions are actually graded? A question counts if ANY answer to it was
    // graded — one student skipping it doesn't make the question ungraded.
    const byQ = new Map();
    recs.forEach(r => {
      const i = Number(r.qIdx);
      if (!Number.isFinite(i)) return;
      if (!byQ.has(i)) byQ.set(i, { qIdx: i, text: r.qText || '', graded: false });
      if (isGraded(r)) byQ.get(i).graded = true;
    });
    const all = [...byQ.values()].sort((a, b) => a.qIdx - b.qIdx);
    const questions = all.filter(q => q.graded);
    const skipped = all.filter(q => !q.graded);

    // One entry per person. Latest name wins — a student who fixed their spelling
    // mid-session should appear under the spelling they meant.
    const people = new Map();
    recs.forEach(r => {
      const k = respondentKey(r);
      if (!people.has(k)) people.set(k, { key: k, name: r.name || 'Anonymous', studentId: r.studentId || '', answers: new Map() });
      const p = people.get(k);
      if (r.name) p.name = r.name;
      if (r.studentId) p.studentId = r.studentId;
      const i = Number(r.qIdx);
      // If the same person somehow has two rows for one question, keep the graded one.
      if (!p.answers.has(i) || (!isGraded(p.answers.get(i)) && isGraded(r))) p.answers.set(i, r);
    });

    const students = [...people.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const headers = ['Student', 'Student ID']
      .concat(questions.map((q, n) => `Q${q.qIdx + 1}`))
      .concat(['Answered', 'Score', 'Percent']);

    const rows = students.map(s => {
      let earned = 0, answered = 0;
      const cells = questions.map(q => {
        const rec = s.answers.get(q.qIdx);
        const p = points(rec);
        if (p === null) return '';                 // never answered — NOT a zero
        answered++; earned += p;
        return round(p);
      });
      const pct = questions.length ? Math.round(earned / questions.length * 100) : 0;
      return [s.name, s.studentId].concat(cells)
        .concat([`${answered}/${questions.length}`, round(earned), pct + '%']);
    });

    const warnings = [];
    if (!questions.length) warnings.push('No graded questions in this selection — a gradebook needs at least one question with a correct answer.');
    if (skipped.length) warnings.push(`${skipped.length} ungraded question${skipped.length === 1 ? '' : 's'} left out (no correct answer set).`);
    if (students.some(s => !s.studentId)) warnings.push('Some students have no ID — assign this deck to a class to match people across devices.');

    return { headers, rows, students, questions, skipped, warnings };
  }

  /* The header block above the table. Teachers file these and open them months later;
   * a bare grid of numbers with no title is a file nobody can identify. Both
   * Classroom and Canvas skip leading blank-prefixed lines on import, and a teacher
   * can delete two rows regardless. */
  function gradebookCSV(records, opts) {
    const o = opts || {};
    const g = buildGradebook(records, o);
    const title = [];
    if (o.title) title.push([o.title]);
    if (o.className) title.push(['Class', o.className]);
    if (title.length) title.push([]);
    return toCSV(title.concat([g.headers]).concat(g.rows));
  }

  function fileName(title) {
    // Lower-cased so the same deck always yields the same filename, whatever case the
    // teacher typed its name in that day.
    const safe = String(title || 'gradebook').toLowerCase()
                   .replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 50)
                 || 'gradebook';
    return `pollslide-gradebook-${safe}-${new Date().toISOString().slice(0, 10)}.csv`;
  }

  return { csvCell, toCSV, points, respondentKey, buildGradebook, gradebookCSV, fileName };
});
