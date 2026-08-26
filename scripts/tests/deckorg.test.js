/* Tests for deck organization — search, sort, pinning, folders, archive.
 *
 * The functions are extracted STRAIGHT OUT of presenter.html between the
 * PS_DECKORG_PURE fences and run in a vm. Copying them into this file would let the
 * two drift apart, and a test that passes against a stale copy is worse than no test.
 *
 * These cover the rules that are easy to get quietly wrong:
 *   • search spans every folder, not just the open one
 *   • pinned decks float to the top of every ordering
 *   • archived decks stay out of the normal list AND out of folder counts
 *   • folder depth is capped, and a deck can't smuggle a deeper path in
 *
 * Run: node scripts/tests/deckorg.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '../../presenter.html'), 'utf8');
const start = html.indexOf('// ── PS_DECKORG_PURE_START ──');
const end = html.indexOf('// ── PS_DECKORG_PURE_END ──');
if (start < 0 || end < 0) {
  console.error('✗ Could not find the PS_DECKORG_PURE fences in presenter.html');
  process.exit(1);
}
const source = html.slice(start, end);

// The dependencies the extracted code closes over in the real page.
const ctx = {
  toQArr: (q) => (Array.isArray(q) ? q : q && typeof q === 'object' ? Object.values(q) : []),
  presType: (p) => (p && ['poll', 'survey', 'quiz', 'study'].includes(p.productType) ? p.productType : 'poll'),
};
vm.createContext(ctx);
vm.runInContext(source, ctx);
const {
  folderParts, folderJoin, normalizeFolder, deckFolder, folderContains,
  deckSearchText, visibleDecks, subfolders, groupDecks, FOLDER_MAX_DEPTH,
} = ctx;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const DAY = 86400000, NOW = Date.now();
const deck = (o) => Object.assign({ name: 'Untitled', productType: 'poll', questions: [], createdAt: NOW - 30 * DAY }, o);

// A teacher's actual shape: one lesson holding three different product types.
const DECKS = {
  d1: deck({ name: 'Warm-up: what is a gene?', productType: 'poll',  folder: 'Biology 101/Unit 3', createdAt: NOW - 10 * DAY, lastOpenedAt: NOW - 1 * DAY }),
  d2: deck({ name: 'Punnett squares',          productType: 'quiz',  folder: 'Biology 101/Unit 3', createdAt: NOW - 9 * DAY,  lastOpenedAt: NOW - 6 * DAY,
             questions: [{ text: 'Cross a heterozygote with a homozygote', options: ['1:1', '3:1'] }] }),
  d3: deck({ name: 'Genetics vocabulary',      productType: 'study', folder: 'Biology 101/Unit 3', createdAt: NOW - 8 * DAY }),
  d4: deck({ name: 'Cell division check',      productType: 'quiz',  folder: 'Biology 101/Unit 2', createdAt: NOW - 40 * DAY, pinned: true }),
  d5: deck({ name: 'Staff meeting pulse',      productType: 'poll',  createdAt: NOW - 2 * DAY }),                 // unfiled
  d6: deck({ name: 'Old midterm 2024',         productType: 'quiz',  folder: 'Biology 101', archived: true }),
  d7: deck({ name: 'Chem safety quiz',         productType: 'quiz',  folder: 'Chemistry 201', createdAt: NOW - 5 * DAY }),
};
const ids = (rows) => rows.map(r => r.id);

console.log('\nFolder paths');
ok('splits a path',                folderJoin(folderParts('Biology 101/Unit 3')) === 'Biology 101/Unit 3');
ok('trims and drops empties',      normalizeFolder('  Biology 101 // Unit 3  ') === 'Biology 101/Unit 3');
ok('caps depth at FOLDER_MAX_DEPTH', normalizeFolder('a/b/c/d') === 'a/b', normalizeFolder('a/b/c/d'));
ok('a deck cannot smuggle a deeper path', deckFolder({ folder: 'a/b/c/d/e' }) === 'a/b');
ok('root contains everything',     folderContains('', 'anything/at/all'));
ok('a folder contains itself',     folderContains('Biology 101', 'Biology 101'));
ok('a folder contains its children', folderContains('Biology 101', 'Biology 101/Unit 3'));
ok('a folder does NOT contain a lookalike', !folderContains('Bio', 'Biology 101'), 'prefix collision');

console.log('\nFolder scoping');
const inUnit3 = visibleDecks(DECKS, { folder: 'Biology 101/Unit 3' });
ok('shows only that folder, all three types', ids(inUnit3).sort().join() === 'd1,d2,d3', ids(inUnit3));
ok('a lesson\'s poll, quiz AND study set sit together',
   new Set(inUnit3.map(r => r.deck.productType)).size === 3);
ok('root shows only unfiled decks', ids(visibleDecks(DECKS, { folder: '' })).join() === 'd5', ids(visibleDecks(DECKS, { folder: '' })));

console.log('\nType filter composes with the folder');
ok('quiz inside Unit 3 → just the quiz',
   ids(visibleDecks(DECKS, { folder: 'Biology 101/Unit 3', type: 'quiz' })).join() === 'd2');
ok('type "all" does not filter',
   visibleDecks(DECKS, { folder: 'Biology 101/Unit 3', type: 'all' }).length === 3);

console.log('\nSearch');
const hit = visibleDecks(DECKS, { query: 'punnett', folder: 'Chemistry 201' });
ok('search IGNORES the open folder (the classic mistake)', ids(hit).join() === 'd2', ids(hit));
ok('search matches question text, not just names',
   ids(visibleDecks(DECKS, { query: 'heterozygote' })).join() === 'd2');
ok('search matches option text',
   ids(visibleDecks(DECKS, { query: '3:1' })).join() === 'd2');
ok('search is case-insensitive', visibleDecks(DECKS, { query: 'PUNNETT' }).length === 1);
ok('search still excludes archived decks',
   visibleDecks(DECKS, { query: 'midterm' }).length === 0);
ok('search finds archived when asked',
   ids(visibleDecks(DECKS, { query: 'midterm', archived: true })).join() === 'd6');
ok('no match → empty', visibleDecks(DECKS, { query: 'zzzz' }).length === 0);

console.log('\nArchive');
ok('archived decks are hidden by default',
   !ids(visibleDecks(DECKS, { folder: 'Biology 101' })).includes('d6'));
ok('the archived view shows only archived',
   ids(visibleDecks(DECKS, { archived: true, folder: 'Biology 101' })).join() === 'd6');
// Regression: the archive was folder-scoped, so a deck archived from inside any
// folder vanished from it — the archive looked permanently empty.
ok('the archive is FLAT — no folder filter finds decks archived from anywhere',
   ids(visibleDecks(DECKS, { archived: true, folder: undefined })).join() === 'd6');
ok('an archived deck filed in a folder is not hidden at the root',
   ids(visibleDecks({ z: deck({ name: 'Filed away', folder: 'Deep/Nested', archived: true }) },
                    { archived: true, folder: undefined })).join() === 'z');

console.log('\nSorting');
const recent = visibleDecks(DECKS, { sort: 'recent', folder: 'Biology 101/Unit 3' });
ok('recent uses lastOpenedAt over createdAt', ids(recent)[0] === 'd1', ids(recent));
ok('a deck never opened falls back to createdAt', ids(recent)[2] === 'd3', ids(recent));
const byName = visibleDecks(DECKS, { sort: 'name', folder: 'Biology 101/Unit 3' });
ok('A–Z sorts by name', ids(byName).join() === 'd3,d2,d1', ids(byName));
const byCreated = visibleDecks(DECKS, { sort: 'created', folder: 'Biology 101/Unit 3' });
ok('Newest sorts by createdAt desc', ids(byCreated).join() === 'd3,d2,d1', ids(byCreated));

console.log('\nPinning beats every sort');
['recent', 'created', 'name'].forEach(sort => {
  const all = visibleDecks(DECKS, { sort });
  ok(`pinned floats to the top under "${sort}"`, all[0].id === 'd4', ids(all).slice(0, 2));
});
ok('an unpinned deck never outranks a pinned one',
   visibleDecks(DECKS, { sort: 'name' }).findIndex(r => r.deck.pinned) === 0);

console.log('\nSubfolders');
const roots = subfolders(DECKS, '', []);
ok('root lists top-level folders only',
   roots.map(f => f.name).join() === 'Biology 101,Chemistry 201', roots.map(f => f.name));
ok('counts are recursive', roots.find(f => f.name === 'Biology 101').count === 4,
   roots.find(f => f.name === 'Biology 101'));
ok('archived decks are excluded from counts',
   subfolders({ a: deck({ folder: 'X', archived: true }) }, '', []).length === 0);
ok('an unfiled deck creates no folder', !roots.some(f => f.name === 'Staff meeting pulse'));
const bioKids = subfolders(DECKS, 'Biology 101', []);
ok('descends one level', bioKids.map(f => f.name).join() === 'Unit 2,Unit 3', bioKids.map(f => f.name));
ok('an empty folder still appears',
   subfolders(DECKS, '', ['Physics 300']).some(f => f.name === 'Physics 300'));
ok('an empty folder counts zero',
   subfolders(DECKS, '', ['Physics 300']).find(f => f.name === 'Physics 300').count === 0);

console.log('\nGrouping');
const gSearch = groupDecks(visibleDecks(DECKS, { query: 'quiz' }), { searching: true });
ok('search collapses to one result section', gSearch.length === 1 && gSearch[0].key === 'results');
ok('search results show their folder path', gSearch[0].showPath === true);
const gRoot = groupDecks(visibleDecks(DECKS, { folder: '' }), {
  folder: '', folders: roots, pinned: visibleDecks(DECKS, {}).filter(r => r.deck.pinned),
});
ok('root shows Pinned, Folders, then Decks',
   gRoot.map(s => s.key).join() === 'pinned,folders,decks', gRoot.map(s => s.key));
ok('a pinned deck is not listed twice',
   !gRoot.find(s => s.key === 'decks').decks.some(r => r.deck.pinned));
const gFolder = groupDecks(inUnit3, { folder: 'Biology 101/Unit 3', folders: [], pinned: [] });
ok('inside a folder there is no separate Pinned section',
   gFolder.map(s => s.key).join() === 'decks');
ok('the section is labelled for the folder',
   gFolder[0].label === 'In this folder');

console.log('\nEdge cases');
ok('empty deck map is safe', visibleDecks({}, {}).length === 0);
ok('null deck map is safe', visibleDecks(null, {}).length === 0);
ok('a deck with no questions is safe', deckSearchText(deck({})) === 'untitled');
ok('questions stored as an object still search',
   deckSearchText(deck({ questions: { a: { text: 'Mitosis' } } })).includes('mitosis'));
ok('subfolders of an empty map is safe', subfolders({}, '', []).length === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
