/* Plan limits must agree between the browser and the server.
 *
 * presenter.html gates the UI with its own TIERS table; api/share.js decides whether
 * a recipient may accept another deck using lib/limits.js. If those disagree, a free
 * user is either blocked from something the UI offered, or lets shares slip past a cap
 * the pricing page advertises. Neither shows up in normal testing.
 *
 * So this parses the REAL table out of presenter.html rather than trusting a copy.
 *
 * Run: node scripts/tests/limits.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TIERS, normalizeTier, limitsFor } = require('../../lib/limits');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const html = fs.readFileSync(path.resolve(__dirname, '../../presenter.html'), 'utf8');
const m = html.match(/const TIERS = \{[\s\S]*?\n\};/);
if (!m) { console.error('✗ Could not find the TIERS table in presenter.html'); process.exit(1); }
const ctx = {}; vm.createContext(ctx);
// `const TIERS = {...}` creates a lexical binding, not a property on the context —
// assign it across explicitly or it comes back undefined.
vm.runInContext(m[0] + '\nglobalThis.TIERS = TIERS;', ctx);
const CLIENT = ctx.TIERS;
if (!CLIENT) { console.error('✗ Extracted the TIERS table but it evaluated to nothing'); process.exit(1); }

console.log('\nClient and server tables agree');
const keys = Object.keys(TIERS);
ok('same set of tiers', Object.keys(CLIENT).sort().join() === keys.sort().join(),
   { client: Object.keys(CLIENT), server: keys });

for (const k of keys) {
  const c = CLIENT[k], s = TIERS[k];
  if (!c) { ok(`${k} exists in presenter.html`, false); continue; }
  for (const field of ['name', 'maxPresentations', 'maxParticipants', 'maxMembers', 'aiMonthly']) {
    ok(`${k}.${field} matches`, c[field] === s[field], { client: c[field], server: s[field] });
  }
}

console.log('\nTier normalisation');
ok('legacy "team" → team_small', normalizeTier('team') === 'team_small');
ok('legacy "white" → team_large', normalizeTier('white') === 'team_large');
ok('unknown → free', normalizeTier('platinum') === 'free');
ok('undefined → free', normalizeTier(undefined) === 'free');
ok('a real tier passes through', normalizeTier('pro') === 'pro');

console.log('\nThe check the share endpoint actually performs');
ok('free holds 3 decks', limitsFor('free').maxPresentations === 3);
ok('a 3-deck free user is at the cap', 3 >= limitsFor('free').maxPresentations);
ok('a 2-deck free user may accept one more', !(2 >= limitsFor('free').maxPresentations));
ok('pro is uncapped', limitsFor('pro').maxPresentations === Infinity);
ok('an unknown tier is treated as free, not unlimited',
   limitsFor('nonsense').maxPresentations === 3);
ok('a missing tier is treated as free',
   limitsFor(undefined).maxPresentations === 3);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
