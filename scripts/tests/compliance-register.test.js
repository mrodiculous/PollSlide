/* Tests for the compliance register (lib/compliance-register.js).
 *
 * This file produces something that gets shown to schools and procurement teams, so
 * the tests that matter most are the ones stopping it from overstating anything:
 *
 *   • a control with no evidence must report "none", never "met"
 *   • the external-audit row must be red no matter what else is true
 *   • "has not accepted yet" must never be counted as "accepted"
 *
 * A register that grades itself generously is worse than no register, because it gets
 * quoted at people who are relying on it.
 *
 * Run: node scripts/tests/compliance-register.test.js
 */
const path = require('path');
const C = require(path.resolve(__dirname, '../../lib/compliance-register.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const byId = (rows, id) => rows.find(r => r.id === id);
const DAY = 86400000;

console.log('\nThe register is well formed');
ok('every control has an id, area and claim',
   C.CONTROLS.every(c => c.id && c.area && c.claim));
ok('ids are unique', new Set(C.CONTROLS.map(c => c.id)).size === C.CONTROLS.length);
ok('every control maps to a framework reference',
   C.CONTROLS.every(c => c.maps && c.maps.iso && c.maps.soc2));
ok('every control has a verify function', C.CONTROLS.every(c => typeof c.verify === 'function'));

console.log('\nNothing is claimed without evidence');
let rows = C.assessControls({});
ok('an empty world produces a full assessment', rows.length === C.CONTROLS.length);
ok('every row has a status',  rows.every(r => ['met','partial','none'].includes(r.status)));
ok('every row has a detail a person can read', rows.every(r => r.detail && r.detail.length > 5));
ok('a control with no evidence list reports "none"',
   C.CONTROLS.filter(c => !c.evidence.length).every(c => byId(rows, c.id).status === 'none'));

console.log('\nThe external-audit row is red, and stays red');
const audit = byId(rows, 'AU-1');
ok('it exists',              !!audit);
ok('it reports none',        audit.status === 'none');
ok('…even when every fact is perfect',
   byId(C.assessControls({ adminEndpointsGated: 9, adminEndpointsTotal: 9, auditLogEntries: 500,
     lastBackupAt: Date.now(), watchdogLastRunAt: Date.now(), policyVersion: 3,
     usersOnCurrentPolicy: 10, usersTotal: 10, emailModeClassesWithoutAttestation: 0,
     testAssertions: 999, testFiles: 20, httpsOnly: true, subprocessorsPageOk: true }), 'AU-1').status === 'none');
ok('and it says why, in words a customer would need to hear',
   /cannot be self-certified/i.test(audit.detail), audit.detail);
ok('unevidenced controls sort to the top, where they get looked at',
   rows[0].status === 'none');

console.log('\nStatus is derived from facts, not asserted');
ok('backups: never run is "none"',    byId(C.assessControls({}), 'BK-1').status === 'none');
ok('backups: yesterday is "met"',     byId(C.assessControls({ lastBackupAt: Date.now() - 3600e3 }), 'BK-1').status === 'met');
ok('backups: ten days ago is "partial", not "met"',
   byId(C.assessControls({ lastBackupAt: Date.now() - 10 * DAY }), 'BK-1').status === 'partial');
ok('…and says how long it has been',
   /10 days ago/.test(byId(C.assessControls({ lastBackupAt: Date.now() - 10 * DAY }), 'BK-1').detail));
ok('watchdog: stale is "partial"',    byId(C.assessControls({ watchdogLastRunAt: Date.now() - 3 * DAY }), 'AV-1').status === 'partial');
ok('watchdog: recent is "met"',       byId(C.assessControls({ watchdogLastRunAt: Date.now() - 3600e3 }), 'AV-1').status === 'met');
ok('admin gating: partial when not every endpoint is gated',
   byId(C.assessControls({ adminEndpointsGated: 6, adminEndpointsTotal: 9 }), 'AC-1').status === 'partial');
ok('admin gating: unmeasured is "none", not "met"',
   byId(C.assessControls({}), 'AC-1').status === 'none');

console.log('\nAn unattested email-mode class downgrades data minimisation');
ok('clean is met',     byId(C.assessControls({ emailModeClassesWithoutAttestation: 0 }), 'DM-1').status === 'met');
ok('one gap is partial', byId(C.assessControls({ emailModeClassesWithoutAttestation: 1 }), 'DM-1').status === 'partial');
ok('…and it says how many',
   /1 class\(es\)/.test(byId(C.assessControls({ emailModeClassesWithoutAttestation: 1 }), 'DM-1').detail));

console.log('\nA control whose verify throws does not take the register down');
const broken = Object.assign({}, C.CONTROLS[0], { verify: () => { throw new Error('boom'); } });
const saved = C.CONTROLS[0];
C.CONTROLS[0] = broken;
const safe = C.assessControls({});
C.CONTROLS[0] = saved;
ok('it still returns every row', safe.length === C.CONTROLS.length);
ok('and the broken one reports none', safe.find(r => r.id === saved.id).status === 'none');

/* ── attestation records ─────────────────────────────────────────────────── */
const USERS = {
  u1: { email: 'ms.rivera@school.edu', acceptedPolicyVersion: 3, acceptedPolicyAt: 1000,
        acceptedPolicyLog: { 2: { at: 500, docs: ['terms'], summary: 'Clarified retention' },
                             3: { at: 1000, docs: ['terms','privacy'] } },
        classes: { c1: { name: 'Biology 101', verifyMode: 'email', attestedAt: 900,
                         attestedBy: 'ms.rivera@school.edu', attestedFor: 'email' },
                   c2: { name: 'Chemistry',   verifyMode: 'email' },                 // no attestation
                   c3: { name: 'Physics',     verifyMode: 'pin' } } },
  u2: { email: 'old@x.test', acceptedPolicyVersion: 2, acceptedPolicyAt: 400 },      // behind, no log
  u3: { email: 'never@x.test' },                                                     // never accepted
};
const POLICY = { version: 3 };

console.log('\nWho accepted what, and when');
let att = C.attestationRows(USERS, POLICY);
ok('policy acceptances are listed',   att.filter(r => r.kind === 'policy').length === 3, att.map(r=>r.what));
ok('class attestations are listed',   att.filter(r => r.kind === 'class').length === 1);
ok('an unattested class produces NO record', !att.some(r => /Chemistry/.test(r.what)));
ok('newest first',                    att[0].at >= att[att.length - 1].at);
ok('each row names a person',         att.every(r => r.who && r.who.length > 3));
ok('each row is timestamped',         att.every(r => typeof r.at === 'number'));
ok('the documents agreed to are carried',
   att.find(r => r.what === 'Terms & Privacy v3').documents === 'terms, privacy');
ok('a pre-logging acceptance is still recorded, and says so',
   att.some(r => r.uid === 'u2' && /before per-version logging/i.test(r.detail)));
ok('the class attestation names who attested and for what',
   att.find(r => r.kind === 'class').who === 'ms.rivera@school.edu' &&
   /email verification mode/.test(att.find(r => r.kind === 'class').documents));
ok('a user who never accepted contributes nothing', !att.some(r => r.uid === 'u3'));
ok('policy and class records are never merged',
   new Set(att.map(r => r.kind)).size === 2);

console.log('\nThe gaps are reported separately from the acceptances');
const gaps = C.attestationGaps(USERS, POLICY);
ok('a user behind the current version is outstanding',
   gaps.policyOutstanding.some(g => g.uid === 'u2'));
ok('a user who never accepted is outstanding',
   gaps.policyOutstanding.some(g => g.uid === 'u3'));
ok('a user on the current version is NOT outstanding',
   !gaps.policyOutstanding.some(g => g.uid === 'u1'));
ok('the outstanding row says which version they are on',
   gaps.policyOutstanding.find(g => g.uid === 'u2').on === 2);
ok('an email-mode class with no attestation is flagged',
   gaps.classesWithoutAttestation.length === 1 &&
   gaps.classesWithoutAttestation[0].className === 'Chemistry');
ok('a PIN-mode class is not flagged — it stores no personal data',
   !gaps.classesWithoutAttestation.some(g => g.className === 'Physics'));

console.log('\nThe summary counts honestly');
const s = C.summarize(USERS, POLICY);
ok('three users',                    s.usersTotal === 3);
ok('only one is on the current policy', s.usersOnCurrentPolicy === 1, s);
ok('…which is NOT rounded up to all', s.usersOnCurrentPolicy !== s.usersTotal);
ok('the unattested class is counted', s.emailModeClassesWithoutAttestation === 1);
ok('with no published policy, nobody is counted as accepted',
   C.summarize(USERS, {}).usersOnCurrentPolicy === 0);
ok('…and the control says the machinery is armed but unused',
   /no policy version has been published/i.test(byId(C.assessControls(C.summarize(USERS, {})), 'CN-1').detail));

console.log('\nDegenerate input');
ok('no users',        C.attestationRows({}, POLICY).length === 0);
ok('null users',      C.attestationRows(null, null).length === 0);
ok('null policy',     typeof C.summarize(USERS, null).usersTotal === 'number');
ok('a null user entry is skipped', C.attestationRows({ x: null }, POLICY).length === 0);
ok('gaps on empty input', C.attestationGaps(null, null).policyOutstanding.length === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
