/* Tests for class rosters and stable student identity (lib/roster.js).
 *
 * Name handling is where this feature goes subtly wrong, and the cost of getting it
 * wrong is a grade attached to the wrong child. So the rules that matter most here
 * are the ones about NOT doing something: never merge two students automatically,
 * never delete one who left, never let a rename orphan their history.
 *
 * Run: node scripts/tests/roster.test.js
 */
const path = require('path');
const R = require(path.resolve(__dirname, '../../lib/roster.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

console.log('\nThe same student, spelled differently');
ok('case',              R.sameStudent('Jamie Smith', 'jamie smith'));
ok('trailing punctuation', R.sameStudent('Jamie K.', 'Jamie K'));
ok('doubled spaces',    R.sameStudent('Jamie  Smith', 'Jamie Smith'));
ok('accents',           R.sameStudent('Renée Dubois', 'Renee Dubois'));
ok('"Last, First" vs "First Last"', R.sameStudent('Smith, Jamie', 'Jamie Smith'));
ok('stray punctuation', R.sameStudent('jamie!!!', 'Jamie'));

console.log('\nDifferent students must stay different');
ok('different surnames', !R.sameStudent('Jamie Smith', 'Jamie Jones'));
ok('a first name is not a full name', !R.sameStudent('Jamie', 'Jamie Smith'));
ok('empty matches nothing', !R.sameStudent('', ''));
ok('siblings',          !R.sameStudent('Alex Chen', 'Alexa Chen'));

console.log('\nPasting a class list');
ok('one name per line', R.parseRoster('Ana Ruiz\nBen Cole\nCara Diaz').length === 3);
ok('blank lines dropped', R.parseRoster('Ana Ruiz\n\n\nBen Cole').length === 2);
/* Found by pasting a real-looking export in the browser: "Student Name" was
 * accepted as a student, because the header check was an exact-match list. */
['Name','Student Name','Full Name','Last Name','First Name','Student ID','Email Address','Pupil','Surname','No.']
  .forEach(h => ok(`header "${h}" is not a student`, !R.parseRoster(h + '\nAna Ruiz').includes(h)));
['Ana Ruiz','Mary-Jane Watson','Li Wei','Jo','Renée Dubois']
  .forEach(n => ok(`but "${n}" still is`, R.parseRoster(n).includes(n)));
ok('"Last, First" is flipped',
   R.parseRoster('Ruiz, Ana').join() === 'Ana Ruiz', R.parseRoster('Ruiz, Ana'));
ok('CSV takes the first column',
   R.parseRoster('Ana Ruiz,ana@school.edu,Year 9').join() === 'Ana Ruiz', R.parseRoster('Ana Ruiz,ana@school.edu,Year 9'));
ok('tab-separated works too',
   R.parseRoster('Ana Ruiz\tana@school.edu').join() === 'Ana Ruiz');
ok('the same person twice becomes one',
   R.parseRoster('Ana Ruiz\nana ruiz\nAna  Ruiz.').length === 1);
ok('an absurdly long line is capped',
   R.parseRoster('x'.repeat(300))[0].length === 80);
ok('empty paste is empty, not a crash', R.parseRoster('').length === 0);
ok('null is safe', R.parseRoster(null).length === 0);

console.log('\nStudent ids');
ok('ids are unique', new Set(Array.from({length:500}, R.newStudentId)).size === 500);
ok('ids are RTDB-key-safe', Array.from({length:50}, R.newStudentId).every(id => !/[.$#[\]/]/.test(id)));

console.log('\nUpdating a class list mid-term');
const first = R.mergeRoster({}, ['Ana Ruiz', 'Ben Cole', 'Cara Diaz']);
ok('everyone is added the first time', first.added.length === 3 && Object.keys(first.roster).length === 3);

const anaId = Object.entries(first.roster).find(([, s]) => s.name === 'Ana Ruiz')[0];
const second = R.mergeRoster(first.roster, ['Ana Ruiz', 'Ben Cole', 'Dan Fox']);
ok('a new student is reported as added', second.added.join() === 'Dan Fox', second.added);
ok('someone off the list is reported as left', second.left.join() === 'Cara Diaz', second.left);
ok('a student who left is KEPT, not deleted',
   Object.values(second.roster).some(s => s.name === 'Cara Diaz'));
ok('…and marked with when they left',
   !!Object.values(second.roster).find(s => s.name === 'Cara Diaz').left);
ok('…and excluded from the list students pick from',
   !R.activeStudents(second.roster).some(s => s.name === 'Cara Diaz'));
ok('an unchanged student keeps their id — history stays attached',
   Object.entries(second.roster).find(([, s]) => s.name === 'Ana Ruiz')[0] === anaId);

const third = R.mergeRoster(second.roster, ['Ana Ruiz', 'Ben Cole', 'Dan Fox', 'Cara Diaz']);
ok('coming back reuses the SAME id, so earlier answers reconnect',
   Object.entries(third.roster).find(([, s]) => s.name === 'Cara Diaz')[0] ===
   Object.entries(second.roster).find(([, s]) => s.name === 'Cara Diaz')[0]);
ok('and is reported as rejoined, not added', third.rejoined.join() === 'Cara Diaz', third.rejoined);

console.log('\nRe-pasting an identical list changes nothing');
const again = R.mergeRoster(third.roster, ['Ana Ruiz', 'Ben Cole', 'Dan Fox', 'Cara Diaz']);
ok('nothing added, nothing left', !again.added.length && !again.left.length);
ok('roster size unchanged', Object.keys(again.roster).length === Object.keys(third.roster).length);

console.log('\nThe list students actually see');
const active = R.activeStudents(third.roster);
ok('alphabetical', active.map(s => s.name).join() === 'Ana Ruiz,Ben Cole,Cara Diaz,Dan Fox', active.map(s=>s.name));
ok('every entry carries its stable id', active.every(s => /^st_/.test(s.id)));
ok('an empty roster is safe', R.activeStudents({}).length === 0 && R.activeStudents(null).length === 0);

console.log('\nNear-misses are surfaced, never merged');
const dup = R.mergeRoster({}, ['Jamie', 'Jamie Smith', 'Ana Ruiz']);
ok('both are kept as separate students', R.activeStudents(dup.roster).length === 3);
const pairs = R.possibleDuplicates(dup.roster);
ok('but the pair is flagged for the teacher to judge', pairs.length === 1, pairs.map(p => p.map(x=>x.name)));
ok('unrelated names are not flagged',
   !R.possibleDuplicates(R.mergeRoster({}, ['Ana Ruiz','Ben Cole']).roster).length);

console.log('\nVerification codes a student types off paper');
const codes = Array.from({length:400}, R.newStudentCode);
ok('six characters',        codes.every(c => c.length === 6));
ok('unique enough',         new Set(codes).size > 395, new Set(codes).size);
ok('no 0/O/1/I/5/S — the pairs people mistype',
   codes.every(c => !/[01IOS5]/.test(c)));
ok('no vowels, so it cannot spell a word in front of a class',
   codes.every(c => !/[AEIOU]/.test(c)));
ok('typed loosely still matches', R.normCode(' bc4-df7 ') === 'BC4DF7');
ok('normCode is safe on junk', R.normCode(null) === '' && R.normCode(undefined) === '');

console.log('\nCompliance depends on the method, and says so');
const pin = R.complianceFor('pin'), code = R.complianceFor('code'), email = R.complianceFor('email');
ok('PIN collects no personal data',   !pin.collectsPersonalData);
ok('issued codes collect none either', !code.collectsPersonalData);
ok('email DOES collect personal data', email.collectsPersonalData);
ok('…and is the only one needing an attestation',
   email.needsAttestation && !pin.needsAttestation && !code.needsAttestation);
ok('the email warning names COPPA',   email.points.some(p => /COPPA/.test(p)));
ok('…and promises deletion',          email.points.some(p => /deleted/i.test(p)));
ok('…and rules out marketing',        email.points.some(p => /marketing/i.test(p)));
ok('a confirmation sentence exists to record', !!email.confirm && !pin.confirm);
ok('PIN mode warns about the first-claim weakness',
   pin.points.some(p => /first person to pick/i.test(p)));
ok('an unknown mode is treated as the safe one',
   !R.complianceFor('nonsense').collectsPersonalData);
ok('all three modes are declared', R.VERIFY_MODES.join() === 'pin,code,email');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
