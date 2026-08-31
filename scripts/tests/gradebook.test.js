/* Tests for the gradebook export (lib/gradebook.js).
 *
 * This file produces a number that goes on a child's record, so the tests that matter
 * most are the ones about NOT inventing data: a student who never answered gets a
 * blank, not a zero; an ungraded reflection question never becomes part of a score;
 * and one person is one row however many devices they used.
 *
 * Plus the spreadsheet one: a name or an answer beginning "=" is a formula to Excel,
 * Sheets and Numbers. It must not be.
 *
 * Run: node scripts/tests/gradebook.test.js
 */
const path = require('path');
const G = require(path.resolve(__dirname, '../../lib/gradebook.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

// A record in report.html's flattened shape.
const rec = (o) => Object.assign({ qIdx: 0, qText: 'Q', name: 'Ana Ruiz', answer: '0' }, o);

console.log('\nA cell that a spreadsheet would run as a formula');
ok('= is neutralised',  G.csvCell('=1+1').startsWith('"\'='));
ok('+ is neutralised',  G.csvCell('+1').startsWith('"\'+'));
ok('- is neutralised',  G.csvCell('-1').startsWith('"\'-'));
ok('@ is neutralised',  G.csvCell('@SUM(A1)').startsWith('"\'@'));
ok('a leading tab is neutralised',    G.csvCell('\tx').startsWith('"\'\t'));
ok('a leading return is neutralised', G.csvCell('\rx').startsWith('"\'\r'));
ok('the dangerous one really is caught',
   G.csvCell('=HYPERLINK("http://evil.test","click")').indexOf("\"'=") === 0);
ok('an ordinary name is untouched',   G.csvCell('Ana Ruiz') === '"Ana Ruiz"');
ok('a negative NUMBER still exports readably (the apostrophe is stripped on display)',
   G.csvCell(-3) === '"\'-3"');
ok('quotes are doubled, not dropped', G.csvCell('She said "hi"') === '"She said ""hi"""');
ok('a comma does not split the cell',  G.csvCell('Ruiz, Ana') === '"Ruiz, Ana"');
ok('a newline stays inside the cell',  G.csvCell('a\nb') === '"a\nb"');
ok('null and undefined are empty',     G.csvCell(null) === '""' && G.csvCell(undefined) === '""');

console.log('\nRows are CRLF-separated, which is what Excel expects');
ok('CRLF between rows', G.toCSV([['a'], ['b']]) === '"a"\r\n"b"');

console.log('\nPoints agree with the leaderboard');
ok('correct is one point',        G.points({ isCorrect: true }) === 1);
ok('wrong is zero',               G.points({ isCorrect: false }) === 0);
ok('partial credit is kept',      G.points({ isCorrect: 0.5 }) === 0.5);
ok('UNGRADED is null, not zero — this is the whole point',
   G.points({ isCorrect: null }) === null && G.points({}) === null);
ok('an explicit 0 is a zero, not ungraded', G.points({ isCorrect: 0 }) === 0);
ok('no record at all is null',    G.points(null) === null);

console.log('\nOne row per student');
let g = G.buildGradebook([
  rec({ qIdx: 0, isCorrect: true,  studentId: 'st_ana', name: 'Ana R.' }),
  rec({ qIdx: 1, isCorrect: false, studentId: 'st_ana', name: 'Ana R.' }),
  rec({ qIdx: 0, isCorrect: true,  studentId: 'st_ben', name: 'Ben C.' }),
  rec({ qIdx: 1, isCorrect: true,  studentId: 'st_ben', name: 'Ben C.' }),
]);
ok('two students, two rows',   g.rows.length === 2);
ok('sorted by name',           g.rows[0][0] === 'Ana R.' && g.rows[1][0] === 'Ben C.');
ok('a column per question',    g.headers.join() === 'Student,Student ID,Q1,Q2,Answered,Score,Percent', g.headers);
ok('Ana scored 1 of 2',        g.rows[0].slice(-3).join() === '2/2,1,50%', g.rows[0]);
ok('Ben scored 2 of 2',        g.rows[1].slice(-3).join() === '2/2,2,100%', g.rows[1]);
ok('the student id is carried through', g.rows[0][1] === 'st_ana');

console.log('\nThe same student on two devices is ONE row');
g = G.buildGradebook([
  rec({ qIdx: 0, isCorrect: true, studentId: 'st_ana', name: 'Ana R.', pid: 'chromebook' }),
  rec({ qIdx: 1, isCorrect: true, studentId: 'st_ana', name: 'Ana R.', pid: 'phone' }),
]);
ok('one row',            g.rows.length === 1);
ok('with both answers',  g.rows[0].slice(-3).join() === '2/2,2,100%', g.rows[0]);

console.log('\nWithout a class, people are matched on the name they typed');
g = G.buildGradebook([
  rec({ qIdx: 0, isCorrect: true,  name: 'Dan' }),
  rec({ qIdx: 1, isCorrect: false, name: 'dan' }),          // same person, different case
  rec({ qIdx: 0, isCorrect: true,  name: 'Sam' }),
]);
ok('case-insensitive name match',  g.rows.length === 2, g.rows.map(r => r[0]));
ok('and the teacher is warned the matching is only as good as the typing',
   g.warnings.some(w => /assign this deck to a class/i.test(w)), g.warnings);

console.log('\nA student who never answered gets a BLANK, not a zero');
g = G.buildGradebook([
  rec({ qIdx: 0, isCorrect: true, name: 'Ana R.' }),
  rec({ qIdx: 1, isCorrect: true, name: 'Ana R.' }),
  rec({ qIdx: 0, isCorrect: true, name: 'Ben C.' }),          // Ben never answered Q2
]);
const ben = g.rows.find(r => r[0] === 'Ben C.');
ok('the missing cell is empty',       ben[3] === '', ben);
ok('…and is NOT scored as wrong',     ben[ben.length - 2] === 1, ben);
ok('the Answered column shows it',    ben[ben.length - 3] === '1/2', ben);
ok('a wrong answer IS a zero, and reads differently from a blank',
   G.buildGradebook([rec({ qIdx: 0, isCorrect: false, name: 'X' })]).rows[0][2] === 0);

console.log('\nUngraded questions are not part of a grade');
g = G.buildGradebook([
  rec({ qIdx: 0, isCorrect: true,  name: 'Ana R.' }),
  rec({ qIdx: 1, isCorrect: null,  name: 'Ana R.', qText: 'How did that feel?' }),   // reflection
  rec({ qIdx: 2, isCorrect: false, name: 'Ana R.' }),
]);
ok('the reflection question is not a column',
   g.headers.join() === 'Student,Student ID,Q1,Q3,Answered,Score,Percent', g.headers);
ok('and does not drag the percentage down', g.rows[0][g.rows[0].length - 1] === '50%', g.rows[0]);
ok('the teacher is told what was left out',
   g.warnings.some(w => /1 ungraded question left out/.test(w)), g.warnings);
ok('a question counts as graded if ANY student was graded on it',
   G.buildGradebook([rec({ qIdx: 0, isCorrect: null, name: 'A' }), rec({ qIdx: 0, isCorrect: true, name: 'B' })])
     .questions.length === 1);

console.log('\nPartial credit');
g = G.buildGradebook([rec({ qIdx: 0, isCorrect: 0.5, name: 'Ana R.' }), rec({ qIdx: 1, isCorrect: 1, name: 'Ana R.' })]);
ok('a half mark survives to the cell', g.rows[0][2] === 0.5, g.rows[0]);
ok('and into the score',               g.rows[0][g.rows[0].length - 2] === 1.5, g.rows[0]);
ok('percentages are rounded sensibly', g.rows[0][g.rows[0].length - 1] === '75%');

console.log('\nNothing to export');
g = G.buildGradebook([]);
ok('no rows, no crash',              g.rows.length === 0);
ok('and it says why',                g.warnings.some(w => /No graded questions/.test(w)));
ok('null input is safe',             G.buildGradebook(null).rows.length === 0);
ok('junk records are skipped, not fatal',
   G.buildGradebook([null, undefined, { qIdx: 'x' }]).rows.length >= 0);
ok('a deck of only reflection questions says so',
   G.buildGradebook([rec({ isCorrect: null })]).warnings.some(w => /No graded questions/.test(w)));

console.log('\nThe finished file');
const csv = G.gradebookCSV(
  [rec({ qIdx: 0, isCorrect: true, name: '=cmd|calc', studentId: 'st_x' })],
  { title: 'Unit 3 quiz', className: 'Biology 101' });
ok('carries a title',            csv.indexOf('"Unit 3 quiz"') === 0, csv.slice(0, 40));
ok('names the class',            /"Class","Biology 101"/.test(csv));
ok('has the header row',         /"Student","Student ID","Q1"/.test(csv));
ok('and the dangerous name is inert', /"'=cmd\|calc"/.test(csv), csv);
ok('no title block when none is given', G.gradebookCSV([rec({ isCorrect: true })], {}).indexOf('"Student"') === 0);

console.log('\nThe filename says what it is');
ok('includes the deck title', /unit-3-quiz/.test(G.fileName('Unit 3 quiz')));
ok('and the date',            /\d{4}-\d{2}-\d{2}\.csv$/.test(G.fileName('x')));
ok('a slash in the title cannot escape the filename', !/[/\\]/.test(G.fileName('a/b\\c')));
ok('an emoji title still yields a usable name', G.fileName('📋 Quiz').length > 20);
ok('an empty title still yields a name', /gradebook/.test(G.fileName('')));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
