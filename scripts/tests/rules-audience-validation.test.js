#!/usr/bin/env node
/* The audience write paths are unauthenticated by design — anyone with the session code
 * can write an answer. Until 2026-09-19 those paths had ".write": true and NO ".validate",
 * so the size and type of what they wrote was bounded only by client-side code that a
 * participant can edit away. A megabyte "answer" is a cost and rendering problem on a
 * product that projects the result onto a wall in a classroom.
 *
 * THE TRAP THIS FILE EXISTS TO CATCH. The obvious rule is
 * hasChildren(['answer']) && … — and it looks right until you notice the presenter
 * writes CHILDREN of that node directly: responses/$qid/$pid/isCorrect when grading,
 * qa/$id/answered and qa/$id/hidden when moderating. Whether an ancestor .validate
 * fires for a child write is a subtlety nobody should have to be sure about at 2am, so
 * the rules constrain each field ONLY IF IT EXISTS and never require presence. That
 * keeps the whole security value (the length and type caps) and is correct either way.
 * If you ever reintroduce hasChildren here, these tests fail — that is the point.
 */
const fs = require('fs');
const path = require('path');

const rules = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'database-rules.json'), 'utf8'));
const S = rules.rules.sessions.$sessionCode;
const respRule = S.responses && S.responses.$qid && S.responses.$qid.$pid && S.responses.$qid.$pid['.validate'];
const qaRule   = S.qa && S.qa.$id && S.qa.$id['.validate'];

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ✓ ' + name)) : (fail++, console.log('  ✗ ' + name)); };

console.log('\nThe validations exist at all');
ok('responses/$qid/$pid has a .validate', typeof respRule === 'string' && respRule.length > 0);
ok('qa/$id has a .validate', typeof qaRule === 'string' && qaRule.length > 0);
if (!respRule || !qaRule) { console.log('\n0 passed, 2 failed'); process.exit(1); }

/* Shim of the RTDB newData API, enough for these expressions. A null/undefined child is
   treated as absent, which is what RTDB does — writing null deletes the key. */
const nd = (o) => ({
  child: (k) => ({
    exists: () => o[k] !== undefined && o[k] !== null,
    isString: () => typeof o[k] === 'string',
    isNumber: () => typeof o[k] === 'number',
    val: () => o[k],
  }),
  hasChildren: (ks) => ks.every(k => o[k] !== undefined && o[k] !== null),
});
const ev = (rule, o) => Function('newData', `return (${rule});`)(nd(o));
const accepts = (n, rule, o) => ok('accepts ' + n, ev(rule, o) === true);
const rejects = (n, rule, o) => ok('rejects ' + n, ev(rule, o) === false);

console.log('\nEvery shape the app really writes is accepted');
accepts('a full answer record', respRule, { participantId: 'p1', name: 'Ava', team: null, answer: '"Mars"', elapsed: 0, isCorrect: true, submittedAt: 1 });
accepts('a wager/retake record with studentId', respRule, { participantId: 'p1', name: 'Ava', team: 'Reds', wager: 2, answer: '["a","b"]', elapsed: 1200, isCorrect: false, submittedAt: 1, attempt: 2, studentId: 's1' });
accepts('an offline-queue replay', respRule, { participantId: 'p1', name: 'Ava', answer: '"x"', elapsed: 5, arrivedAt: 2, queuedMs: 3000, offline: true });
accepts('the __none__ sentinel for no answer', respRule, { participantId: 'p1', name: 'Ava', answer: '"__none__"', elapsed: 0 });
accepts('a response with no name at all', respRule, { participantId: 'p1', answer: '"x"', elapsed: 0 });
/* presenter.html grades by writing the child directly */
accepts('presenter grading (isCorrect child-write)', respRule, { isCorrect: true });
accepts('a new Q&A question', qaRule, { text: 'Why?', createdAt: 1, name: 'Ben', votes: 0 });
accepts('an upvote transaction (whole node)', qaRule, { text: 'Why?', createdAt: 1, name: 'Ben', votes: 7 });
/* presenter.html moderates by writing children directly */
accepts('presenter marking answered (child-write)', qaRule, { answered: true });
accepts('presenter hiding a question (child-write)', qaRule, { hidden: true });

console.log('\nAbuse is rejected');
rejects('an answer over 4000 chars', respRule, { answer: '"' + 'x'.repeat(4000) + '"', elapsed: 0 });
rejects('a one-megabyte answer', respRule, { answer: 'x'.repeat(1048576), elapsed: 0 });
rejects('a 61-char display name', respRule, { answer: '"x"', name: 'N'.repeat(61) });
rejects('a non-string answer', respRule, { answer: { evil: true } });
rejects('elapsed sent as a string', respRule, { answer: '"x"', elapsed: 'not-a-number' });
rejects('Q&A text over 300 chars', qaRule, { text: 'q'.repeat(301), createdAt: 1 });
rejects('Q&A votes sent as a string', qaRule, { text: 'ok', createdAt: 1, votes: '999999' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
