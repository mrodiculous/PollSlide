/* Tests for the Auto-pilot decision logic (lib/watchdog.js).
 *
 * These cover the two things that make or break this feature:
 *   1. thresholds — does it call a real problem a problem, and leave healthy alone
 *   2. email discipline — a check failing every 15 minutes must produce ONE email,
 *      not 96. That rule is the difference between a tool Rod reads and one he
 *      filters to trash.
 *
 * Run: node scripts/tests/watchdog.test.js
 */
const {
  evalBackupAge, evalErrorSpike, evalTierDrift, evalProbe, evalAiReachable,
  decideNotification, ESCALATE_AFTER_MS, isStoredBackup,
} = require('../../lib/watchdog');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
const H = 3600000, NOW = 1_700_000_000_000;

console.log('\nBackup freshness');
const B = (o) => evalBackupAge(Object.assign({ now: NOW, maxAgeHours: 48, bucketConfigured: true }, o));
ok('fresh backup passes',         B({ lastOkAt: NOW - 2 * H }).ok);
ok('49h-old backup fails',        !B({ lastOkAt: NOW - 49 * H }).ok);
ok('exactly at the limit passes', B({ lastOkAt: NOW - 48 * H }).ok);
ok('never-backed-up fails',       !B({ lastOkAt: 0 }).ok);

// Regression: a real backup email fired saying "no successful backup has ever been
// recorded" while backups were fine, because the log field is `at` and the check read
// `t`. isStoredBackup is now the single reader of that record shape.
console.log('\nBackup log record shape (the `at` vs `t` regression)');
ok('a stored backup counts',        isStoredBackup({ at: NOW, ok: true, file: 'backups/x.json' }));
ok('a failed backup does not',      !isStoredBackup({ at: NOW, ok: false, error: 'boom' }));
ok('a manual download does NOT count as an off-site backup',
   !isStoredBackup({ at: NOW, bytes: 100, mode: 'download' }));
ok('a record with no timestamp does not count', !isStoredBackup({ ok: true }));
ok('null/undefined are safe',       !isStoredBackup(null) && !isStoredBackup(undefined));

console.log('\nNo backup destination configured');
const noBucket = B({ lastOkAt: NOW - 1 * H, bucketConfigured: false });
ok('unconfigured bucket fails even with a recent log entry', !noBucket.ok);
ok('it is flagged as a config issue, not a staleness issue', noBucket.configIssue === true);
ok('the message names BACKUP_BUCKET', /BACKUP_BUCKET/.test(noBucket.detail));
ok('a configured bucket sets no configIssue flag',
   B({ lastOkAt: NOW - 1 * H }).configIssue === undefined);

console.log('\nClient error spike');
ok('quiet day passes',          evalErrorSpike({ total: 3, distinct: 2, worst: { count: 2, message: 'x', page: '/p' } }).ok);
ok('one fault hitting 10 fails', !evalErrorSpike({ total: 10, distinct: 1, worst: { count: 10, message: 'x', page: '/p' } }).ok);
ok('many small faults fail',    !evalErrorSpike({ total: 40, distinct: 20, worst: { count: 4, message: 'x', page: '/p' } }).ok);
ok('zero errors passes',        evalErrorSpike({ total: 0, distinct: 0, worst: null }).ok);

console.log('\nStripe tier drift');
ok('matching tiers pass',       evalTierDrift({ rows: [{ uid: 'a', actual: 'pro', expected: 'pro' }] }).ok);
ok('drift is caught',           !evalTierDrift({ rows: [{ uid: 'a', email: 'r@x.com', actual: 'free', expected: 'team_small' }] }).ok);
ok('unknown Stripe price is not treated as drift',
   evalTierDrift({ rows: [{ uid: 'a', actual: 'pro', expected: null }] }).ok);
ok('no linked customers passes', evalTierDrift({ rows: [] }).ok);

// The safety property: auto-fix may only ever GIVE access back, never take it away.
console.log('\nTier drift — direction decides whether we may act (the safety rule)');
const under = evalTierDrift({ rows: [{ uid: 'a', email: 'paid@x.com', actual: 'free', expected: 'team_small' }] });
ok('paid-but-downgraded is queued for RESTORE', under.restore.length === 1 && under.review.length === 0);
const over = evalTierDrift({ rows: [{ uid: 'b', email: 'member@x.com', actual: 'team_small', expected: 'free' }] });
ok('granted-above-Stripe is queued for REVIEW, never auto-fixed',
   over.review.length === 1 && over.restore.length === 0);
ok('over-granted detail warns not to assume it is wrong',
   /team members and comps legitimately sit above/.test(over.detail));
const both = evalTierDrift({ rows: [
  { uid: 'a', actual: 'free', expected: 'pro' },
  { uid: 'b', actual: 'team_large', expected: 'pro' },
]});
ok('mixed batch splits correctly', both.restore.length === 1 && both.review.length === 1);
ok('pro → team_small counts as a restore (rank, not alphabetical)',
   evalTierDrift({ rows: [{ uid: 'a', actual: 'pro', expected: 'team_small' }] }).restore.length === 1);
ok('team_large → team_small counts as a review',
   evalTierDrift({ rows: [{ uid: 'a', actual: 'team_large', expected: 'team_small' }] }).review.length === 1);

console.log('\nEndpoint probes');
ok('all 200 passes',            evalProbe({ results: [{ name: 'a', status: 200, ok: true }] }).ok);
ok('a 500 fails',               !evalProbe({ results: [{ name: 'a', status: 500, ok: false }] }).ok);

console.log('\nAI availability');
ok('local up passes',           evalAiReachable({ localOk: true, cloudConfigured: false }).ok);
ok('local down + cloud key passes', evalAiReachable({ localOk: false, cloudConfigured: true }).ok);
ok('local down + no cloud key fails', !evalAiReachable({ localOk: false, cloudConfigured: false }).ok);

console.log('\nEmail discipline');
const open = (t) => ({ status: 'open', firstAt: t, notified: { opened: t } });

ok('healthy + no history = silence',
   decideNotification(null, { ok: true }, false, NOW) === null);
ok('healthy + previously resolved = silence',
   decideNotification({ status: 'resolved' }, { ok: true }, false, NOW) === null);
ok('first failure emails once',
   decideNotification(null, { ok: false }, false, NOW).kind === 'opened');
ok('self-healed sends ONE email and closes the incident', (() => {
  const d = decideNotification(null, { ok: false }, true, NOW);
  return d.kind === 'self_healed' && d.status === 'resolved';
})());
ok('still broken 15 min later = SILENCE (the anti-spam rule)',
   decideNotification(open(NOW - 15 * 60000), { ok: false }, false, NOW).kind === null);
ok('still broken 12h later = still silence',
   decideNotification(open(NOW - 12 * H), { ok: false }, false, NOW).kind === null);
ok('still broken 24h later = one escalation',
   decideNotification(open(NOW - 25 * H), { ok: false }, false, NOW).kind === 'escalated');
ok('escalation does not repeat the next run', (() => {
  const prev = { status: 'open', firstAt: NOW - 30 * H, notified: { opened: NOW - 30 * H, escalated: NOW - 10 * 60000 } };
  return decideNotification(prev, { ok: false }, false, NOW).kind === null;
})());
ok('recovery emails once',
   decideNotification(open(NOW - 2 * H), { ok: true }, false, NOW).kind === 'resolved');
ok('recovery does not repeat once resolved',
   decideNotification({ status: 'resolved' }, { ok: true }, false, NOW) === null);

// The headline claim: a check failing continuously is a handful of emails, not one
// per run. Simulate the real cron and count.
console.log('\nA broken check left failing');
function simulate(runs) {
  let prev = null, emails = 0;
  for (let i = 0; i < runs; i++) {               // one run every 15 minutes
    const t = NOW + i * 15 * 60000;
    const d = decideNotification(prev, { ok: false }, false, t);
    if (d && d.kind) emails++;
    prev = {
      status: 'open',
      firstAt: (prev && prev.firstAt) || t,
      notified: Object.assign({}, prev && prev.notified, d && d.kind ? { [d.kind]: t } : {}),
    };
  }
  return emails;
}
ok('96 runs (24h) → 1 email, not 96', simulate(96) === 1, { emails: simulate(96) });
ok('200 runs (50h) → 3 emails (opened + escalation at 24h + at 48h)', simulate(200) === 3, { emails: simulate(200) });

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
