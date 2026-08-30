/* Tests for repeat suppression in api/polly.js.
 *
 * WHY: asked for 25 funny millennial pub-quiz questions, Polly returned three that
 * were the same question twice. The machinery to prevent that already existed — the
 * generation loop feeds everything so far back as `avoid`, and dropRepeats() is the
 * net underneath. What failed was the SIMILARITY TEST: it caught near-identical
 * wording, and a model asked four times for "funny millennial questions" doesn't
 * repeat wording, it repeats the JOKE.
 *
 * So this file is a labelled corpus, not a set of unit assertions. Each pair is
 * marked DUPE (a human would object to seeing both) or DISTINCT (both are fine),
 * and the thresholds are tuned against it. Numbers nobody measures are guesses.
 *
 * Run: node scripts/tests/polly-dedupe.test.js
 */
const path = require('path');
const { dropRepeats } = require(path.resolve(__dirname, '../../api/polly.js')).__test;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

// Build a quiz question the same shape normalizeQuestions() produces.
const q = (text, opts, correctIdx) => ({
  text, options: opts, correctAnswers: [correctIdx], type: 'multiple_choice',
});

/* Pairs a person would call the same question, phrased differently — the actual
 * failure. Note how little literal wording several of them share. */
const DUPES = [
  [ q('Which app do millennials blame for ruining dating?', ['Tinder','LinkedIn','Uber','Venmo'], 0),
    q('What dating app defined an entire millennial generation of bad decisions?', ['Tinder','Bumble','Hinge','Grindr'], 0) ],

  [ q('What food is blamed for millennials not owning homes?', ['Avocado toast','Sushi','Kale','Quinoa'], 0),
    q('According to boomers, which brunch item cost millennials a mortgage?', ['Avocado toast','Eggs Benedict','Pancakes','Granola'], 0) ],

  [ q('Which social network did millennials abandon to their parents?', ['Facebook','TikTok','Reddit','Discord'], 0),
    q('What platform became "the one your mum is on"?', ['Facebook','Snapchat','Twitter','Tumblr'], 0) ],

  [ q('What year did the first iPhone launch?', ['2007','2005','2009','2010'], 0),
    q('In which year did Apple release the original iPhone?', ['2007','2006','2008','2011'], 0) ],

  [ q('Which messaging app icon is a ghost?', ['Snapchat','WhatsApp','Signal','Telegram'], 0),
    q('What app do you associate with a little white ghost logo?', ['Snapchat','Viber','Line','WeChat'], 0) ],
];

/* Pairs that share a lot of wording but are genuinely different questions. If the
 * thresholds catch these, Polly starts silently eating good questions — the failure
 * mode that is WORSE than a repeat, because you can't see what you didn't get. */
const DISTINCT = [
  [ q('What is the capital of France?', ['Paris','Lyon','Nice','Marseille'], 0),
    q('What is the capital of Spain?', ['Madrid','Barcelona','Seville','Valencia'], 0) ],

  [ q('Which app do millennials blame for ruining dating?', ['Tinder','LinkedIn','Uber','Venmo'], 0),
    q('Which app do millennials blame for ruining their sleep?', ['TikTok','Tinder','Uber','Venmo'], 0) ],

  [ q('What year did the first iPhone launch?', ['2007','2005','2009','2010'], 0),
    q('What year did Facebook launch?', ['2004','2006','2007','2002'], 0) ],

  [ q('Who sang "Mr. Brightside"?', ['The Killers','Coldplay','Oasis','Blur'], 0),
    q('Who sang "Wonderwall"?', ['Oasis','The Killers','Blur','Pulp'], 0) ],

  [ q('What does "FOMO" stand for?', ['Fear of missing out','Fond of my own','Free of my order','Fear of moving on'], 0),
    q('What does "YOLO" stand for?', ['You only live once','Your own life order','Yell out loud once','Yes on love only'], 0) ],
];

/* The client sends already-in-the-deck questions as { text, answers } — the same
 * shape api/polly.js's asAvoid() produces for its own top-up loop. Feeding raw
 * question objects here instead would silently strip the answers and test a code
 * path production never takes. */
const asAvoid = (q) => ({
  text: q.text || q.front || '',
  answers: q.back ? [q.back] : (q.correctAnswers || []).map(i => (q.options || [])[i]).filter(Boolean),
});

function isDropped(pair) {
  // Second question offered when the first is already in the deck.
  return dropRepeats([pair[1]], [asAvoid(pair[0])], 'quiz').length === 0;
}

console.log('\nRepeats a person would object to');
let caught = 0;
DUPES.forEach((pair, i) => {
  const dropped = isDropped(pair);
  if (dropped) caught++;
  ok(`#${i + 1} caught — "${pair[1].text.slice(0, 52)}…"`, dropped);
});

console.log('\nGenuinely different questions must survive');
let survived = 0;
DISTINCT.forEach((pair, i) => {
  const kept = !isDropped(pair);
  if (kept) survived++;
  ok(`#${i + 1} kept — "${pair[1].text.slice(0, 52)}…"`, kept);
});

/* A deliberate trade, recorded rather than hidden.
 * These two test genuinely different facts, and they are dropped anyway because both
 * answer "Netflix". In a 25-question pub quiz the same answer coming up twice reads
 * as a repeat to the room whether or not the facts differ — which is the complaint
 * this whole change exists to fix. The top-up loop simply generates a replacement,
 * so the cost is a little more generation, not a shorter quiz.
 * If this ever proves too aggressive, the lever is the GENERIC_ANSWER exemption in
 * api/polly.js — widen it, don't weaken the rule. */
console.log('\nDeliberately dropped: the same answer twice in one quiz');
{
  const a = q('Which streaming service made binge-watching normal?', ['Netflix','Hulu','Disney+','Peacock'], 0);
  const b = q('Which streaming service is known for its red logo?', ['Netflix','Hulu','Max','Prime'], 0);
  ok('a second question with the same answer is treated as a repeat',
     dropRepeats([b], [asAvoid(a)], 'quiz').length === 0);
}

console.log('\nGeneric answers are exempt — or every true/false question would collide');
{
  const t1 = q('Millennials invented the selfie. True or false?', ['True','False'], 0);
  const t2 = q('Nokia once made rubber boots. True or false?', ['True','False'], 0);
  ok('two unrelated true/false questions both survive',
     dropRepeats([t2], [asAvoid(t1)], 'quiz').length === 1);
}

console.log('\nWithin a single batch');
{
  const batch = [DUPES[0][0], DUPES[0][1], DISTINCT[0][0], DISTINCT[0][1]];
  const kept = dropRepeats(batch, [], 'quiz');
  ok('a repeat inside one batch is removed', kept.length === 3, kept.map(x => x.text));
}

console.log('\nSurveys are deliberately exempt');
{
  const a = q('How satisfied are you with the venue?', ['1','2','3'], 0);
  const b = q('How satisfied are you with the food?', ['1','2','3'], 0);
  ok('parallel survey phrasings are kept', dropRepeats([b], [a], 'survey').length === 1);
}

console.log(`\nCaught ${caught}/${DUPES.length} repeats · kept ${survived}/${DISTINCT.length} good questions`);
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
