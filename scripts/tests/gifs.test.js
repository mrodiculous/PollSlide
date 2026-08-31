/* Tests for contextual GIFs (lib/gifs.js).
 *
 * This feature puts third-party images on a projector in front of a class, so the
 * tests that matter most are the ones about NOT doing something:
 *
 *   • the safe-search filter is a constant, not a parameter
 *   • a malformed setting means OFF, never on
 *   • an answer like "B" or "42" is never searched literally
 *   • a result with no description is never used — a GIF with no alt text is a slide
 *     a blind student cannot read
 *
 * Run: node scripts/tests/gifs.test.js
 */
const path = require('path');
const G = require(path.resolve(__dirname, '../../lib/gifs.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

console.log('\nSafety is not a setting');
ok('the filter is Tenor\'s strictest', G.SAFE_FILTER === 'high');
ok('and it is exported as a constant, not read from an argument',
   typeof G.SAFE_FILTER === 'string');

console.log('\nA malformed policy means OFF');
ok('undefined',        !G.gifsEnabled(undefined));
ok('null',             !G.gifsEnabled(null));
ok('empty object',     !G.gifsEnabled({}));
ok('a string',         !G.gifsEnabled('yes'));
ok('question:"true" (a string) is NOT on', !G.gifPolicy({ question: 'true' }).question);
ok('question:1 is not on',                 !G.gifPolicy({ question: 1 }).question);
ok('only a real boolean turns it on',      G.gifPolicy({ question: true }).question);
ok('the two toggles are independent',
   G.gifPolicy({ question: true }).answer === false &&
   G.gifPolicy({ answer: true }).question === false);
ok('both can be on together',
   G.gifsEnabled({ question: true, answer: true }));

console.log('\nA question is reduced to the ONE thing it is about');
/* A GIF engine is a keyword engine. Every extra word narrows the pool toward nothing,
 * and the words that survive from a question are usually the ones doing the asking.
 * Each case below is a real question shape that the previous version got wrong. */
const term = (q) => G.searchTerm(q);
ok('the topic wins over the verbs of asking',
   term('Which app do millennials blame for ruining dating?') === 'dating',
   term('Which app do millennials blame for ruining dating?'));
ok('quiz scaffolding is dropped entirely',
   term('Which of the following best describes photosynthesis?') === 'photosynthesis',
   term('Which of the following best describes photosynthesis?'));
ok('…and so is "identify the correct definition of"',
   term('Identify the correct definition of inflation') === 'inflation',
   term('Identify the correct definition of inflation'));
ok('a proper noun beats everything else',
   term('How many time zones does China officially use?') === 'China',
   term('How many time zones does China officially use?'));
ok('a multi-word proper noun stays together',
   term('In what year did the Berlin Wall come down?') === 'Berlin Wall',
   term('In what year did the Berlin Wall come down?'));
ok('…and another',
   term('What was the main cause of the French Revolution?') === 'French Revolution',
   term('What was the main cause of the French Revolution?'));
ok('two adjacent words are kept when they are one idea',
   term('Which of these is NOT a programming language?') === 'programming language',
   term('Which of these is NOT a programming language?'));
ok('never more than two words — a longer phrase finds nothing',
   ['Which of the following best describes the process by which plants convert sunlight into chemical energy?',
    'What are the primary economic causes of long-term structural unemployment in developing nations?']
     .every(q => term(q).split(' ').length <= G.MAX_TERM_WORDS),
   ['Which of the following best describes the process by which plants convert sunlight into chemical energy?',
    'What are the primary economic causes of long-term structural unemployment in developing nations?'].map(term));
ok('punctuation never leaks in',
   !/[?!.,]/.test(term('What is photosynthesis, exactly?!')));
ok('accents survive',      /café/i.test(term('Where is the café?')));
ok('empty input is empty', term('') === '' && term(null) === '');
ok('emoji never become the search term',
   !/🎉/.test(term('🎉 Celebrate the harvest festival')));
ok('a question of pure scaffolding still searches something rather than nothing',
   term('What is it?').length > 0, term('What is it?'));

console.log('\nAn answer that cannot be pictured is never searched literally');
['B', '42', 'true', 'False', 'yes', 'no', '3.14', '1 + 1', 'all of the above', 'None of the above']
  .forEach(a => ok(`"${a}" is not picturable`, !G.answerIsPicturable(a)));
['photosynthesis', 'the Amazon rainforest', 'Marie Curie', 'a volcano']
  .forEach(a => ok(`"${a}" is`, G.answerIsPicturable(a)));

console.log('\n…it gets a reaction term instead');
const t1 = G.answerTerm('B', { seed: 'q1' });
ok('a letter answer yields a reaction, not the letter',
   G.REACTION.correct.includes(t1) && t1 !== 'B', t1);
ok('a number answer likewise',
   G.REACTION.correct.includes(G.answerTerm('42', { seed: 'q2' })));
/* An answer is tidied, not dissected. Mining it the way a question is mined turned
 * "the Amazon rainforest" into "Amazon" — a shopping company rather than a forest. */
ok('a real answer keeps its own words, minus the article',
   G.answerTerm('the Amazon rainforest', { seed: 'q3' }) === 'Amazon rainforest',
   G.answerTerm('the Amazon rainforest', { seed: 'q3' }));
ok('a person keeps both names',  G.answerTerm('Marie Curie', { seed:'x' }) === 'Marie Curie');
ok('capitalisation is preserved — it is a proper noun',
   G.answerTerm('The French Revolution', { seed:'x' }) === 'French Revolution');
ok('a long answer is capped rather than searched whole',
   G.answerTerm('the process by which plants convert sunlight into energy', { seed:'x' }).split(' ').length <= 3);
ok('a WRONG reveal never gets a celebration',
   G.REACTION.neutral.includes(G.answerTerm('B', { seed: 'q1', correct: false })));
ok('the choice is stable for the same question — a deck does not reshuffle between runs',
   G.answerTerm('B', { seed: 'q1' }) === G.answerTerm('B', { seed: 'q1' }));
ok('but different questions can differ',
   new Set(['a','b','c','d','e','f'].map(s => G.answerTerm('B', { seed: s }))).size > 1);

console.log('\nTurning a provider result into what we store');
const raw = { id: '123', content_description: 'a cat knocking a glass off a table',
  media_formats: { tinygif: { url: 'https://t.test/a.gif', dims: [220, 160] },
                   gifpreview: { url: 'https://t.test/a.png', dims: [220, 160] } } };
const n = G.normalizeTenor(raw);
ok('tenor: id, url and still are kept', n.id === '123' && /a\.gif$/.test(n.url) && /a\.png$/.test(n.still));
ok('tenor: dimensions are kept',        n.width === 220 && n.height === 160);
ok('tenor: content_description becomes alt text', n.alt === 'a cat knocking a glass off a table');
ok('tenor: the source is recorded — needed for attribution', n.source === 'tenor');
ok('tenor: alt text is capped',
   G.normalizeTenor({ id:'x', content_description:'y'.repeat(400),
     media_formats:{ tinygif:{url:'u'} } }).alt.length <= 140);
ok('tenor: a result with no usable media is dropped',
   G.normalizeTenor({ id: 'x', content_description: 'd', media_formats: {} }) === null);
ok('tenor: junk is dropped', G.normalizeTenor(null) === null && G.normalizeTenor('x') === null);

/* Giphy exists because Tenor stopped issuing keys. A feature resting on one free
 * third-party service is a feature that breaks without warning. */
const graw = { id: 'g1', alt_text: 'a dog running through a sprinkler',
  images: { fixed_height_small: { url: 'https://g.test/b.gif', width: '200', height: '150' },
            fixed_height_small_still: { url: 'https://g.test/b.png', width: '200', height: '150' } } };
const gn = G.normalizeGiphy(graw);
ok('giphy: url and still are kept',  /b\.gif$/.test(gn.url) && /b\.png$/.test(gn.still));
ok('giphy: STRING dimensions become numbers', gn.width === 200 && gn.height === 150);
ok('giphy: alt_text becomes alt text', gn.alt === 'a dog running through a sprinkler');
ok('giphy: falls back to title when alt_text is absent — it often is',
   G.normalizeGiphy({ id:'g2', title:'a shrug', images:{ fixed_height_small:{url:'u'} } }).alt === 'a shrug');
ok('giphy: the source is recorded',  gn.source === 'giphy');
ok('giphy: no usable image is dropped', G.normalizeGiphy({ id:'g3', title:'t', images:{} }) === null);

ok('BOTH PROVIDERS PRODUCE THE SAME RECORD SHAPE — nothing downstream can tell them apart',
   JSON.stringify(Object.keys(n).sort()) === JSON.stringify(Object.keys(gn).sort()),
   { tenor: Object.keys(n).sort(), giphy: Object.keys(gn).sort() });
ok('normalizeMany dispatches on the provider name',
   G.normalizeMany([raw], 'tenor')[0].source === 'tenor' &&
   G.normalizeMany([graw], 'giphy')[0].source === 'giphy');
ok('…and an unknown provider name falls back rather than throwing',
   Array.isArray(G.normalizeMany([raw], 'nope')));
ok('normalizeMany on junk is empty, not a crash',
   G.normalizeMany(null, 'giphy').length === 0 && G.normalizeMany([null, 'x'], 'tenor').length === 0);

console.log('\nChoosing one — from records that are ALREADY normalised');
/* The contract that nearly shipped broken: the endpoint normalises, because only the
 * server knows which provider answered. pickBest must therefore take normalised
 * records. An earlier version normalised again here, so every real result became null
 * — and the browser test missed it because its stub returned raw provider JSON
 * instead of what the endpoint actually sends. */
const rec = (id, alt, w, h) => ({ id, url: 'https://t.test/' + id + '.gif', still: null,
                                  width: w, height: h, alt, source: 'tenor' });
ok('a record straight from the endpoint is usable',
   G.pickBest([rec('a', 'a cat', 200, 200)], { seed: 'x' }).id === 'a');
ok('…which is exactly what normalizeMany produces',
   G.pickBest(G.normalizeMany([raw], 'tenor'), { seed: 'x' }).id === '123');
ok('and a giphy one too',
   G.pickBest(G.normalizeMany([graw], 'giphy'), { seed: 'x' }).id === 'g1');
ok('a GIF with NO description is never chosen — it could not be given alt text',
   G.pickBest([rec('a', '', 200, 200)]) === null);
ok('…even when others exist, the described one wins',
   G.pickBest([rec('a', '', 200, 200), rec('b', 'a dog', 200, 200)], { seed: 'x' }).id === 'b');
ok('an absurdly wide GIF is skipped — it breaks the slide',
   G.pickBest([rec('wide', 'a banner', 1200, 100), rec('ok', 'a dog', 200, 200)], { seed: 's' }).id === 'ok');
ok('an absurdly tall one too',
   G.pickBest([rec('tall', 'a tower', 100, 900), rec('ok', 'a dog', 200, 200)], { seed: 's' }).id === 'ok');
ok('unknown dimensions are allowed rather than discarded',
   !!G.pickBest([rec('u', 'd', null, null)]));
ok('the same seed always picks the same GIF',
   G.pickBest([rec('a','x',200,200), rec('b','y',200,200), rec('c','z',200,200)], { seed:'q7' }).id ===
   G.pickBest([rec('a','x',200,200), rec('b','y',200,200), rec('c','z',200,200)], { seed:'q7' }).id);
ok('nothing usable returns null, not a broken record',
   G.pickBest([]) === null && G.pickBest(null) === null);
ok('a record with no url is ignored',
   G.pickBest([{ id:'x', alt:'a thing' }, rec('ok','a dog',200,200)], { seed:'s' }).id === 'ok');
ok('if every result is oddly shaped, a described one is still used rather than none',
   G.pickBest([rec('w','a banner',1200,100)], { seed:'s' }) !== null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
