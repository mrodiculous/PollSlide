/* PollSlide — class rosters and stable student identity.
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 * A participant used to be `p_<timestamp>_<random>` in that browser's localStorage,
 * and their name was free text typed fresh every session. So the same student on a
 * different device was a different person, clearing the browser erased them, and
 * "Jamie", "jamie", "Jamie K." and "jamie!!!" were four students. A teacher could
 * therefore never see one student's progress across two decks — which is most of
 * what teaching actually needs.
 *
 * THE APPROACH
 * The teacher owns the list. A class holds students, each with a stable id that
 * never changes. When a deck is assigned to a class, the audience page shows that
 * roster instead of a name box, and every answer carries the student id.
 *
 * Deliberately NO student accounts. "Scan a QR and go, no app, no sign-up" is the
 * thing PollSlide is good at, and putting a login in front of a classroom would
 * cost more than it returns. The teacher's list is the source of truth instead.
 *
 * Everything here is pure so the name handling — which is where this goes subtly
 * wrong — can be tested without a browser or a database.
 * --------------------------------------------------------------------------- */

/* A name reduced to what makes two spellings the SAME person.
 * Case, accents, punctuation and doubled spaces all vary between how a teacher
 * types a list and how a student would type their own name. Word ORDER does not
 * survive normalisation deliberately — "Smith, Jamie" and "Jamie Smith" are the
 * same student, and a roster pasted out of a school system is usually the former. */
function normName(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')                       // punctuation → space
    .split(/\s+/).filter(Boolean)
    .sort()                                             // order-insensitive
    .join(' ');
}

/* Do these two names refer to the same student?
 * Exact-after-normalising only. Fuzzy matching is deliberately NOT done here: the
 * cost of wrongly merging two students is a grade on the wrong child's record, and
 * no convenience is worth that. Near-misses are surfaced to the teacher instead. */
function sameStudent(a, b) {
  const na = normName(a), nb = normName(b);
  return !!na && na === nb;
}

/* Turn whatever the teacher pasted into a clean student list.
 * Accepts one name per line, or CSV/tab rows where the name is the first column,
 * or "Last, First". Blank lines, a header row and duplicates all disappear. */
function parseRoster(text) {
  const rows = String(text == null ? '' : text).split(/\r?\n/);
  const out = [], seen = new Set();
  for (let raw of rows) {
    let line = String(raw).trim();
    if (!line) continue;

    // A TAB always means columns — the name is the first one. Only a COMMA can
    // mean "Last, First", and even then only when both halves look like names:
    // "Ana Ruiz, ana@school.edu" is a name and an email, not a surname and a
    // forename, and flipping it produced "ana@school.edu Ana Ruiz".
    const looksLikeName = (p) => p && !/[@\d]/.test(p) && p.split(/\s+/).length <= 2;
    if (line.includes('\t')) {
      line = line.split('\t')[0].trim();
    } else {
      const parts = line.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length === 2 && parts.every(looksLikeName)) {
        line = parts[1] + ' ' + parts[0];               // Last, First → First Last
      } else if (parts.length > 1) {
        line = parts[0];
      }
    }

    line = line.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    /* A header row names a column, not a person. An exact-match list was too
     * brittle — a real school export says "Student Name", "Last Name" or
     * "Pupil Full Name", and one of those became a student called Student Name.
     * So: a line made up ENTIRELY of header words is a header. A real person is
     * vanishingly unlikely to be called "Full Name". */
    const HEADER_WORD = /^(name|names|student|students|pupil|pupils|full|first|last|given|family|sur|surname|forename|email|e-mail|address|id|no|number|#|row)$/i;
    if (line.split(/\s+/).every(w => HEADER_WORD.test(w.replace(/[^\w#-]/g, '')))) continue;
    if (line.length > 80) line = line.slice(0, 80);

    const key = normName(line);
    if (!key || seen.has(key)) continue;                // same person twice
    seen.add(key);
    out.push(line);
  }
  return out;
}

/* A stable id for a student. Generated once when they join the roster and never
 * derived from the name — renaming a student (a marriage, a correction, a typo
 * fixed in week three) must not orphan everything they have already answered. */
function newStudentId() {
  return 'st_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Merge a pasted list into an existing roster.
 * Returns what to write plus what CHANGED, because a teacher re-pasting an updated
 * class list needs to see that three joined and one left — silently reconciling a
 * roster is how a student quietly stops being counted.
 * Students no longer on the list are marked left, NEVER deleted: their answers must
 * stay attributed, and a mis-paste must be undoable. */
function mergeRoster(existing, names) {
  const roster = Object.assign({}, existing || {});
  const byKey = {};
  Object.entries(roster).forEach(([id, st]) => { if (st && st.name) byKey[normName(st.name)] = id; });

  const added = [], rejoined = [], kept = [];
  const seen = new Set();

  for (const name of (names || [])) {
    const key = normName(name);
    if (!key) continue;
    seen.add(key);
    const id = byKey[key];
    if (id) {
      if (roster[id].left) { roster[id] = Object.assign({}, roster[id], { left: null }); rejoined.push(name); }
      else kept.push(name);
    } else {
      const nid = newStudentId();
      roster[nid] = { name, addedAt: Date.now() };
      byKey[key] = nid;
      added.push(name);
    }
  }

  const left = [];
  Object.entries(roster).forEach(([id, st]) => {
    if (!st || !st.name || st.left) return;
    if (!seen.has(normName(st.name))) { roster[id] = Object.assign({}, st, { left: Date.now() }); left.push(st.name); }
  });

  return { roster, added, rejoined, left, kept };
}

/* The list the audience page shows. Students who have left are excluded, and the
 * order is alphabetical by the name as the teacher wrote it — a class list in
 * insertion order is unusable once it is more than a handful of people. */
function activeStudents(roster) {
  return Object.entries(roster || {})
    .filter(([, st]) => st && st.name && !st.left)
    .map(([id, st]) => ({ id, name: st.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* Names close enough to be worth a second look before they become two students.
 * Reported to the teacher, never merged automatically — see sameStudent(). */
function possibleDuplicates(roster) {
  const list = activeStudents(roster);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = normName(list[i].name).split(' '), b = normName(list[j].name).split(' ');
      const shared = a.filter(w => b.includes(w));
      // Share every word of the shorter name but are not identical — e.g.
      // "Jamie" against "Jamie Smith".
      if (shared.length && shared.length === Math.min(a.length, b.length) && a.length !== b.length) {
        out.push([list[i], list[j]]);
      }
    }
  }
  return out;
}

/* ── How a student proves they are who they picked ──────────────────────────
 * Three methods, chosen per class, because the right answer genuinely differs:
 *
 *   pin    Student sets a PIN the first time. No teacher setup, no personal data
 *          beyond the name you already hold. The weakness is first claim — whoever
 *          gets there first owns the name — which is visible and fixable in seconds
 *          from the roster. Best for primary and secondary.
 *
 *   code   You issue a short code per student and hand it out. Nobody can claim
 *          someone else's name, and still no personal data. Costs you a printout.
 *
 *   email  A code is emailed to the student. Strongest link to a real person, and
 *          the only one that COLLECTS PERSONAL DATA — which changes your legal
 *          obligations, so it is gated behind an explicit attestation rather than
 *          being a quiet dropdown choice. Best for higher education.
 * ------------------------------------------------------------------------- */
var VERIFY_MODES = ['pin', 'code', 'email'];

/* Storing a child's email is a different legal act from storing their name. Under
 * COPPA a school can consent on a parent's behalf for under-13s, but only for
 * educational use, and GDPR wants a lawful basis and a retention limit. PollSlide
 * cannot verify any of that — so it states the obligation, records that the teacher
 * accepted it, and timestamps it. That record is the point: it is what makes the
 * choice auditable later. */
function complianceFor(mode) {
  if (mode === 'email') {
    return {
      collectsPersonalData: true,
      needsAttestation: true,
      title: 'Emailing codes stores student email addresses',
      points: [
        'Email addresses are personal data. Storing a student\'s means your school or institution must already have a lawful basis for it.',
        'For students under 13 (US, COPPA) a school may consent on a parent\'s behalf, but only for educational use.',
        'Addresses are used solely to send a sign-in code. They are never used for marketing and never shared.',
        'They are deleted when you remove the student or delete the class.',
      ],
      confirm: 'I confirm my school or institution has the right to use these students\' email addresses for this purpose.',
    };
  }
  return {
    collectsPersonalData: false,
    needsAttestation: false,
    title: mode === 'code' ? 'Codes you issue' : 'Student-chosen PINs',
    points: mode === 'code'
      ? ['No personal data beyond the names you already added.',
         'Print or read out each student\'s code. Anyone without it cannot claim that name.']
      : ['No personal data beyond the names you already added.',
         'The first person to pick a name sets its PIN — if the wrong student claims one, clear it from this screen and they set a new one.'],
    confirm: null,
  };
}

/* A code a student can read off paper and type on a phone without errors.
 * No 0/O/1/I/5/S — the pairs people actually mistype — and no vowels, so it can
 * never accidentally spell a word in front of a class. */
function newStudentCode() {
  const A = 'BCDFGHJKMNPQRTVWXY23479';
  let out = '';
  for (let i = 0; i < 6; i++) out += A[Math.floor(Math.random() * A.length)];
  return out;
}
// Typed codes arrive with spaces, hyphens and the wrong case.
function normCode(c) { return String(c == null ? '' : c).toUpperCase().replace(/[^A-Z0-9]/g, ''); }

var PSRoster = {
  VERIFY_MODES, complianceFor, newStudentCode, normCode, normName, sameStudent, parseRoster, newStudentId, mergeRoster, activeStudents, possibleDuplicates };
if (typeof module !== 'undefined' && module.exports) module.exports = PSRoster;
if (typeof window !== 'undefined') window.PSRoster = PSRoster;
