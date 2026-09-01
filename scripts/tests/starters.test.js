#!/usr/bin/env node
/* The demo deck ships identically to every new account, so the things that would be
 * embarrassing in front of somebody else's class are asserted here rather than trusted.
 * Most of these exist because the first draft got them wrong. */
const path = require('path');
const S = require(path.resolve(__dirname, '..', '..', 'starters.js'));

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
};

console.log('\nOne demo deck, the same for everyone');
ok('exactly one starter deck', S.STARTERS.length === 1);
ok('it is a quiz, so scoring and the reveal are demonstrated', S.STARTERS[0].product === 'quiz');
ok('five questions', S.STARTERS[0].questions.length === 5);
ok('byId finds it', !!S.byId('demo-quiz'));
ok('forProduct still works for the presenter UI', S.forProduct('quiz').length === 1);

const deck = S.STARTERS[0];
const answerTerms = new Set();
deck.questions.forEach(q => q.options.forEach(o => answerTerms.add(o.gifTerm)));

console.log('\nNothing in it can point at the right answer');
/* The picture above the choices must not BE one of the choices. "running fast" returned
 * a cheetah on the question whose answer is Cheetah — the slide answered itself. */
ok('no question picture is searched on a creature that is also a choice',
   deck.questions.every(q => ![...answerTerms].some(a => q.gifTerm.toLowerCase().includes(a))));
/* Every correct answer sat at option A in the first draft: full marks without reading. */
ok('the correct answer is not always in the same position',
   new Set(deck.questions.map(q => q.correctAnswer)).size >= 3);
ok('every correct answer index actually exists',
   deck.questions.every(q => q.options[q.correctAnswer] !== undefined));

console.log('\nEvery picture has somewhere to go, and something to search for');
ok('every question has a picture term', deck.questions.every(q => !!q.gifTerm));
ok('every choice has a picture term', deck.questions.every(q => q.options.every(o => !!o.gifTerm)));
/* A choice reading "Three" beside a picture of an octopus is a picture of nothing the
 * choice says. Answers are creatures, and each one is searched on itself. */
ok('each choice is searched on its own words',
   deck.questions.every(q => q.options.every(o => o.gifTerm.toLowerCase() === o.text.toLowerCase())));
ok('25 slots to fill — 5 questions plus 20 choices', S.mediaSlots().length === 25);
ok('slot names are unique', new Set(S.mediaSlots().map(s => s.slot)).size === 25);

console.log('\nContent that cannot land badly anywhere');
/* This opens in classrooms in countries we know nothing about. */
const RISKY = /(politic|religio|god|war|army|weapon|gun|kill|death|die|race|racial|gender|sex|body|weight|fat|drug|alcohol|beer|wine|nation|flag|border|immigra|crime|police)/i;
const allText = JSON.stringify(deck);
ok('no risky subject matter anywhere in the deck', !RISKY.test(allText));
ok('every answer is a single plain word', deck.questions.every(q => q.options.every(o => /^[A-Za-z]+$/.test(o.text))));

console.log('\ndeckFrom builds something the app can actually use');
const built = S.deckFrom('demo-quiz', { sessionCode: 'ABC123', now: 111 });
ok('carries the session code and timestamp', built.sessionCode === 'ABC123' && built.createdAt === 111);
ok('marked as ours, so it can be offered for removal later', built.fromStarter === 'demo-quiz');
ok('questions are deep-copied, not shared with the template',
   built.questions[0].options !== deck.questions[0].options);
/* Two decks from one template sharing an options array is a bug that takes an afternoon
 * to believe, so it is asserted rather than assumed. */
const a = S.deckFrom('demo-quiz'), b = S.deckFrom('demo-quiz');
a.questions[0].options[0].text = 'MUTATED';
ok('editing one deck does not edit another', b.questions[0].options[0].text !== 'MUTATED');
ok('…nor the template itself', deck.questions[0].options[0].text !== 'MUTATED');
ok('the build-time term is stripped from the finished deck',
   !JSON.stringify(built).includes('gifTerm'));
ok('every question has a media box, ready to be filled',
   built.questions.every(q => 'image' in q && q.options.every(o => 'img' in o)));

console.log('\nMedia is optional — a missing file must not break the deck');
const noMedia = S.deckFrom('demo-quiz', { media: {} });
ok('with no media it is still a working five-question quiz',
   noMedia.questions.length === 5 && noMedia.questions.every(q => q.image === ''));
const withMedia = S.deckFrom('demo-quiz', { media: {
  q0:   { url: 'u0', still: 's0', alt: 'a clock', term: 'alarm clock', source: 'giphy', id: 'i0' },
  q0o2: { url: 'u2', still: 's2', alt: 'a koala', term: 'koala',       source: 'giphy', id: 'i2' },
} });
ok('a question picture lands in the question\'s own box', withMedia.questions[0].image === 'u0');
ok('a choice picture lands in that choice\'s box', withMedia.questions[0].options[2].img === 'u2');
ok('the search term is kept beside it so the review row can re-run it',
   withMedia.questions[0].imageGif.term === 'alarm clock');
ok('the provider is kept, because their terms require the credit',
   withMedia.questions[0].options[2].imgGif.source === 'giphy');
ok('slots with no media supplied are left empty, not undefined',
   withMedia.questions[0].options[0].img === '' && !withMedia.questions[0].options[0].imgGif);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
