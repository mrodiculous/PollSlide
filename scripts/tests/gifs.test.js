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

console.log('\nA question becomes a search a GIF engine can answer');
ok('stopwords are dropped, content words kept in order',
   G.searchTerm('Which app do millennials blame for ruining dating?') === 'app millennials blame ruining',
   G.searchTerm('Which app do millennials blame for ruining dating?'));
ok('punctuation does not leak in',
   !/[?!.,]/.test(G.searchTerm('What is photosynthesis, exactly?!')));
ok('the term is capped to a few words',
   G.searchTerm('one two three four five six seven eight nine ten eleven twelve').split(' ').length <= G.MAX_TERM_WORDS);
ok('a question of pure stopwords still searches something',
   G.searchTerm('What is it?').length > 0, G.searchTerm('What is it?'));
ok('accents survive',      /café/.test(G.searchTerm('Where is the café?')));
ok('empty input is empty', G.searchTerm('') === '' && G.searchTerm(null) === '');
ok('emoji do not become the search term',
   !/🎉/.test(G.searchTerm('🎉 Celebrate the harvest festival')));

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
ok('a real answer is searched on its own words',
   G.answerTerm('the Amazon rainforest', { seed: 'q3' }) === 'amazon rainforest',
   G.answerTerm('the Amazon rainforest', { seed: 'q3' }));
ok('a WRONG reveal never gets a celebration',
   G.REACTION.neutral.includes(G.answerTerm('B', { seed: 'q1', correct: false })));
ok('the choice is stable for the same question — a deck does not reshuffle between runs',
   G.answerTerm('B', { seed: 'q1' }) === G.answerTerm('B', { seed: 'q1' }));
ok('but different questions can differ',
   new Set(['a','b','c','d','e','f'].map(s => G.answerTerm('B', { seed: s }))).size > 1);

console.log('\nTurning a Tenor result into what we store');
const raw = { id: '123', content_description: 'a cat knocking a glass off a table',
  media_formats: { tinygif: { url: 'https://t.test/a.gif', dims: [220, 160] },
                   gifpreview: { url: 'https://t.test/a.png', dims: [220, 160] } } };
const n = G.normalizeResult(raw);
ok('id, url and still are kept', n.id === '123' && /a\.gif$/.test(n.url) && /a\.png$/.test(n.still));
ok('dimensions are kept',        n.width === 220 && n.height === 160);
ok('Tenor\'s description becomes alt text', n.alt === 'a cat knocking a glass off a table');
ok('the source is recorded — needed for attribution', n.source === 'tenor');
ok('alt text is capped',
   G.normalizeResult({ id:'x', content_description:'y'.repeat(400),
     media_formats:{ tinygif:{url:'u'} } }).alt.length <= 140);
ok('a result with no usable media is dropped',
   G.normalizeResult({ id: 'x', content_description: 'd', media_formats: {} }) === null);
ok('junk is dropped', G.normalizeResult(null) === null && G.normalizeResult('x') === null);

console.log('\nChoosing one');
const mk = (id, alt, w, h) => ({ id, content_description: alt,
  media_formats: { tinygif: { url: 'https://t.test/' + id + '.gif', dims: [w, h] } } });
ok('a GIF with NO description is never chosen — it could not be given alt text',
   G.pickBest([mk('a', '', 200, 200)]) === null);
ok('…even when others exist, the described one wins',
   G.pickBest([mk('a', '', 200, 200), mk('b', 'a dog', 200, 200)], { seed: 'x' }).id === 'b');
ok('an absurdly wide GIF is skipped — it breaks the slide',
   G.pickBest([mk('wide', 'a banner', 1200, 100), mk('ok', 'a dog', 200, 200)], { seed: 's' }).id === 'ok');
ok('an absurdly tall one too',
   G.pickBest([mk('tall', 'a tower', 100, 900), mk('ok', 'a dog', 200, 200)], { seed: 's' }).id === 'ok');
ok('unknown dimensions are allowed rather than discarded',
   !!G.pickBest([{ id:'u', content_description:'d', media_formats:{ tinygif:{ url:'u' } } }]));
ok('the same seed always picks the same GIF',
   G.pickBest([mk('a','x',200,200), mk('b','y',200,200), mk('c','z',200,200)], { seed:'q7' }).id ===
   G.pickBest([mk('a','x',200,200), mk('b','y',200,200), mk('c','z',200,200)], { seed:'q7' }).id);
ok('nothing usable returns null, not a broken record',
   G.pickBest([]) === null && G.pickBest(null) === null);
ok('if every result is oddly shaped, a described one is still used rather than none',
   G.pickBest([mk('w','a banner',1200,100)], { seed:'s' }) !== null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
