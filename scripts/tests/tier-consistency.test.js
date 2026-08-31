/* The plan limits are written down in three places. This asserts they agree.
 *
 *   lib/limits.js      the server, and the only one that actually ENFORCES anything
 *   presenter.html     what the app shows a user about their own plan
 *   admin.html         what the Plans & tiers page shows Rod
 *
 * They have drifted before, and the drift was invisible: admin.html once had
 * free.aiMonthly = 0, and the page rendered anything ≤ 0 as ∞ — so the admin dashboard
 * cheerfully reported that free users had unlimited Polly while the server was cutting
 * them off at five. Nothing errored. Nobody could have noticed except by reading two
 * files side by side.
 *
 * The right fix is one source of truth, but presenter.html and admin.html are single
 * files served without a build step, so they cannot import lib/limits.js. Until that
 * changes, this test is the thing standing between three copies and a wrong number on
 * a billing page.
 *
 * Run: node scripts/tests/tier-consistency.test.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* Pull a `const NAME = { … };` object literal out of an HTML file and evaluate it.
 * Brace-counting rather than a lazy regex: these objects contain nested braces, and
 * a non-greedy match would stop at the first one. */
function extractObject(src, declaration) {
  const start = src.indexOf(declaration);
  if (start === -1) return null;
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const literal = src.slice(open, i);
  const ctx = { Infinity: Infinity };
  vm.createContext(ctx);
  return vm.runInContext('(' + literal + ')', ctx);
}

const server    = require(path.resolve(ROOT, 'lib/limits.js')).TIERS;
const presenter = extractObject(read('presenter.html'), 'const TIERS =');
const admin     = extractObject(read('admin.html'), 'const TIER_CONFIG =');

console.log('\nAll three tables were found');
ok('lib/limits.js exports TIERS',      !!server && typeof server === 'object');
ok('presenter.html declares TIERS',    !!presenter, presenter);
ok('admin.html declares TIER_CONFIG',  !!admin, admin);

const TIERS = ['free', 'pro', 'team_small', 'team_large'];
console.log('\nThe same four plans exist everywhere');
ok('server has all four',    TIERS.every(t => server[t]));
ok('presenter has all four', TIERS.every(t => presenter[t]));
ok('admin has all four',     TIERS.every(t => admin[t]));
ok('and none of them has an extra plan the others do not',
   Object.keys(server).sort().join() === Object.keys(presenter).sort().join(),
   { server: Object.keys(server), presenter: Object.keys(presenter) });

/* admin.html writes "unlimited" as -1; the other two write Infinity. Same meaning,
 * different spelling — so compare through a normaliser rather than pretending one of
 * them is wrong. */
const unlimited = (v) => v === Infinity || v === -1 || v === null;
const same = (a, b) => (unlimited(a) && unlimited(b)) || a === b;

console.log('\nEvery number agrees, plan by plan');
TIERS.forEach(t => {
  const s = server[t], p = presenter[t], a = admin[t];
  ok(`${t}: name`, s.name === p.name && s.name === a.name, { server: s.name, presenter: p.name, admin: a.name });
  ok(`${t}: monthly Polly allowance`,
     s.aiMonthly === p.aiMonthly && s.aiMonthly === a.aiMonthly,
     { server: s.aiMonthly, presenter: p.aiMonthly, admin: a.aiMonthly });
  ok(`${t}: max presentations`,
     same(s.maxPresentations, p.maxPresentations) && same(s.maxPresentations, a.maxPres),
     { server: String(s.maxPresentations), presenter: String(p.maxPresentations), admin: a.maxPres });
  ok(`${t}: max participants`,
     same(s.maxParticipants, p.maxParticipants) && same(s.maxParticipants, a.maxPart),
     { server: String(s.maxParticipants), presenter: String(p.maxParticipants), admin: a.maxPart });
  ok(`${t}: seats`, s.maxMembers === p.maxMembers,
     { server: s.maxMembers, presenter: p.maxMembers });
});

/* The specific shape of the bug that got shipped: a 0 allowance rendered as ∞.
 * Zero is a real number and must never mean unlimited — if a plan genuinely had no
 * Polly, the honest display is "0", not "∞". */
console.log('\nThe bug that actually shipped cannot come back');
ok('no plan has a zero or negative Polly allowance',
   TIERS.every(t => server[t].aiMonthly > 0),
   TIERS.map(t => t + ':' + server[t].aiMonthly));
ok('free is 5, not unlimited', server.free.aiMonthly === 5 && admin.free.aiMonthly === 5);
ok('the allowance rises with the plan',
   server.free.aiMonthly < server.pro.aiMonthly &&
   server.pro.aiMonthly < server.team_small.aiMonthly &&
   server.team_small.aiMonthly < server.team_large.aiMonthly);

console.log('\nAdmin prices are present and ordered');
ok('every plan has a price', TIERS.every(t => typeof admin[t].price === 'number'));
ok('free costs nothing',     admin.free.price === 0);
ok('price rises with the plan',
   admin.free.price < admin.pro.price &&
   admin.pro.price < admin.team_small.price &&
   admin.team_small.price < admin.team_large.price,
   TIERS.map(t => t + ':' + admin[t].price));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
