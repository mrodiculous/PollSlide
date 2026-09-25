/* Plans can't be self-granted — and every legitimate way a plan changes still works.
 * Run: node scripts/tests/plan-integrity.test.js
 *
 * The holes this closes (found 2026-09-25): a signed-in user could write their own
 * users/<uid>/tier, create a workspace labelled with any plan and have the team service
 * grant it to a second account, add themselves to any team, and pick their own role via
 * the open team_invites index. The fixes are in database-rules.json and api/team.js. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const R = JSON.parse(read('database-rules.json')).rules;
const presenter = read('presenter.html'), admin = read('admin.html'), team = read('api/team.js');

console.log('\nNobody raises their own plan');
{
  const v = (R.users.$uid.tier || {})['.validate'] || '';
  ok('users/<uid>/tier is validated', !!v);
  ok('…the same value is always fine (a whole-record save)', /newData\.val\(\) === data\.val\(\)/.test(v));
  ok('…dropping to free is allowed (leaving a team, presenter.html validateMembership)', /newData\.val\(\) === 'free'/.test(v) && /tier'\)\.set\('free'\)/.test(presenter));
  ok('…the admin panel (help@) can set any plan', /help@pollslide\.com/.test(v) && /users\/\$\{uid\}\/tier`\)\.set\(tier\)/.test(admin));
  ok('…Stripe and the team service set plans server-side (Admin SDK bypasses rules)', /setUserTier/.test(team) && /setUserTier/.test(read('api/stripe-webhook.js')));
}

console.log('\nA team\'s plan is its owner\'s real plan');
{
  const v = (R.workspaces.$wsId.tier || {})['.validate'] || '';
  ok('workspaces/<id>/tier is validated against the owner', /child\('users'\)\.child\(auth\.uid\)\.child\('tier'\)/.test(v));
  ok('…legacy plan names still create their team (team → team_small, white → team_large)', /'team_small' && .*=== 'team'/.test(v) && /'team_large' && .*=== 'white'/.test(v));
  ok('…the presenter creates teams with the normalised owner plan', /const tier = normalizeTier\(userTier\)/.test(presenter));
  ok('…free users can still create their team', /newData\.val\(\) === 'free'/.test(v));
}

console.log('\nJoining a team needs a real invite');
{
  const w = R.workspaces.$wsId.members.$uid['.write'];
  ok('self-join requires the team\'s own invite for your email', /child\('invites'\)\.child\(auth\.token\.email\.toLowerCase\(\)/.test(w) && /child\('email'\)\.val\(\) === auth\.token\.email\.toLowerCase\(\)/.test(w));
  ok('…at the invited role', /newData\.child\('role'\)\.val\(\) === data\.parent\(\)\.parent\(\)\.child\('invites'\)/.test(w));
  ok('…you can always leave', /\$uid === auth\.uid && \(!newData\.exists\(\)/.test(w));
  ok('…you can\'t change your own role', /data\.exists\(\) && newData\.child\('role'\)\.val\(\) === data\.child\('role'\)\.val\(\)/.test(w));
  ok('…owners and team admins still manage members', /ownerUid'\)\.val\(\) === auth\.uid/.test(w) && /role'\)\.val\(\) === 'admin'/.test(w));
  // The rule rebuilds presenter/api emailKey(): lowercase, then . # $ / [ ] @ → _
  const key = e => e.toLowerCase().trim().replace(/[.#$/\[\]@]/g, '_');
  const rulesKey = e => ['.', '#', '$', '/', '[', ']', '@'].reduce((s, c) => s.split(c).join('_'), e.toLowerCase());
  ok('the rule computes the same invite key as the app', ['Jo.Smith@School.org', 'a#b$c@x.co'].every(e => key(e) === rulesKey(e)));
  ok('the key in the rule covers every character the app replaces', ['.', '#', '$', '/', '[', ']', '@'].every(c => w.includes(`replace('${c}', '_')`)));
}

console.log('\nThe invite index grants nothing');
{
  const w = R.team_invites.$emailKey['.write'];
  ok('only the team\'s owner or admin writes an invite', /newData\.exists\(\) && \(root\.child\('workspaces'\)\.child\(newData\.child\('wsId'\)/.test(w));
  ok('the invitee, owner or admin can remove it', /\$emailKey === auth\.token\.email/.test(w) && /data\.child\('wsId'\)/.test(w));
  ok('the team service takes the role from the workspace invite, not the index', /role: wsInv\.role === 'admin' \? 'admin' : 'member'/.test(team) && !/role: inv\.role \|\| 'member', joinedAt/.test(team));
  ok('the team service still checks the invite matches the caller\'s email', /Invite does not match your account/.test(team));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
