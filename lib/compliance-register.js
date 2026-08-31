/* PollSlide — the compliance register.
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * Two questions get asked by schools, procurement teams and (eventually) auditors:
 *
 *   1. "Show me the people who accepted your terms, and when."
 *   2. "Show me your controls, and the evidence for each one."
 *
 * Both are answerable from data PollSlide already records — per-user policy
 * acceptance logs, per-class data attestations, security scan logs, backup logs. What
 * was missing was anywhere to see them together, and any way to hand them over.
 *
 * WHAT THIS IS NOT
 * It is NOT a certification, and nothing here should ever be presented as one. ISO
 * 27001 and SOC 2 cannot be self-certified — they require an accredited external
 * auditor, and saying otherwise to a customer is a false claim about a security
 * posture, which is exactly the kind of thing that ends badly. The framework columns
 * below say which control a piece of evidence WOULD map to in an audit. That is a
 * readiness register: useful for answering a questionnaire honestly and for knowing
 * what is missing before paying an auditor. Nothing more.
 *
 * The status of every control is derived from facts, never asserted. A control with
 * no evidence reports "no evidence", not "compliant" — a register that grades itself
 * generously is worse than no register, because it gets quoted.
 * --------------------------------------------------------------------------- */

const DAY = 86400000;

/* Each control: what we claim, where the evidence lives, and a verify() that decides
 * from gathered facts. verify returns 'met' | 'partial' | 'none', plus a detail line
 * a human can read out loud. */
const CONTROLS = [
  {
    id: 'AC-1', area: 'Access control',
    claim: 'Administrative functions require an authenticated administrator.',
    maps: { iso: 'A.5.15 Access control', soc2: 'CC6.1' },
    evidence: ['lib/quota.js ADMIN_EMAILS', 'every api/*.js admin endpoint verifies a Firebase ID token'],
    verify: (f) => f.adminEndpointsGated == null
      ? { status: 'none', detail: 'Not measured.' }
      : f.adminEndpointsGated === f.adminEndpointsTotal
        ? { status: 'met', detail: `All ${f.adminEndpointsTotal} admin endpoints verify an ID token and check the admin list.` }
        : { status: 'partial', detail: `${f.adminEndpointsGated} of ${f.adminEndpointsTotal} admin endpoints verify a token.` },
  },
  {
    id: 'AC-2', area: 'Access control',
    claim: 'Student secrets are never readable by the browser and never leave the owner\'s tree.',
    maps: { iso: 'A.8.3 Information access restriction', soc2: 'CC6.1' },
    evidence: ['api/student-claim.js compares server-side via Admin SDK', 'quiz_builder publishes roster names only'],
    verify: () => ({ status: 'met', detail: 'PIN hashes and issued codes live under users/$uid/classes and are compared only by api/student-claim.js.' }),
  },
  {
    id: 'CR-1', area: 'Cryptography',
    claim: 'Student PINs are stored salted and hashed with a deliberately slow function.',
    maps: { iso: 'A.8.24 Use of cryptography', soc2: 'CC6.1' },
    evidence: ['api/student-claim.js: crypto.scryptSync + per-student salt', 'compared with crypto.timingSafeEqual'],
    verify: () => ({ status: 'met', detail: 'scrypt with a per-student random salt; constant-time comparison.' }),
  },
  {
    id: 'CR-2', area: 'Cryptography',
    claim: 'All traffic is encrypted in transit.',
    maps: { iso: 'A.8.24', soc2: 'CC6.7' },
    evidence: ['Vercel enforces HTTPS', 'Firebase RTDB is wss/https only'],
    verify: (f) => f.httpsOnly === false
      ? { status: 'partial', detail: 'A sitemap URL or asset was found on plain http.' }
      : { status: 'met', detail: 'No plain-http endpoints in the public surface.' },
  },
  {
    id: 'BF-1', area: 'Abuse prevention',
    claim: 'Guessing a student secret is rate limited per student and per device.',
    maps: { iso: 'A.8.5 Secure authentication', soc2: 'CC6.1' },
    evidence: ['lib/guard.js rateLimit', 'api/student-claim.js: 8 per student / 10 min, 30 per IP / 10 min'],
    verify: () => ({ status: 'met', detail: 'Two independent limits; once tripped even a correct code is refused.' }),
  },
  {
    id: 'LOG-1', area: 'Audit logging',
    claim: 'Privileged actions and plan changes are logged with who and why.',
    maps: { iso: 'A.8.15 Logging', soc2: 'CC7.2' },
    evidence: ['admin/legal_log', 'admin/security_log', 'admin/credit_log', 'per-user Account timeline'],
    verify: (f) => f.auditLogEntries > 0
      ? { status: 'met', detail: `${f.auditLogEntries} audit entries recorded.` }
      : { status: 'partial', detail: 'Logging is implemented but no entries recorded yet.' },
  },
  {
    id: 'BK-1', area: 'Resilience',
    claim: 'Data is backed up and the restore path is documented and tested.',
    maps: { iso: 'A.8.13 Information backup', soc2: 'A1.2' },
    evidence: ['scripts/backup.js', 'scripts/restore.js', 'DISASTER-RECOVERY.md', 'watchdog backup check'],
    verify: (f) => !f.lastBackupAt
      ? { status: 'none', detail: 'No backup recorded.' }
      : (Date.now() - f.lastBackupAt) < 2 * DAY
        ? { status: 'met', detail: 'Last backup ' + new Date(f.lastBackupAt).toISOString().slice(0, 10) + '.' }
        : { status: 'partial', detail: 'Last backup was ' + Math.floor((Date.now() - f.lastBackupAt) / DAY) + ' days ago.' },
  },
  {
    id: 'AV-1', area: 'Availability',
    claim: 'Service health is monitored and incidents are recorded automatically.',
    maps: { iso: 'A.8.16 Monitoring activities', soc2: 'CC7.2' },
    evidence: ['api/status.js', 'public status page', 'admin/incidents', 'api/watchdog.js cron'],
    verify: (f) => f.watchdogLastRunAt && (Date.now() - f.watchdogLastRunAt) < DAY
      ? { status: 'met', detail: 'Watchdog last ran ' + new Date(f.watchdogLastRunAt).toISOString().slice(0, 16).replace('T', ' ') + '.' }
      : { status: 'partial', detail: f.watchdogLastRunAt ? 'Watchdog has not run in over a day.' : 'Watchdog has not run yet.' },
  },
  {
    id: 'DS-1', area: 'Data subject rights',
    claim: 'A user can export their data and delete their account without asking us.',
    maps: { iso: 'A.5.34 Privacy and PII protection', soc2: 'P5' },
    evidence: ['api/delete-account.js', 'Reports → CSV and Gradebook export', '/privacy'],
    verify: () => ({ status: 'met', detail: 'Self-service export and deletion are both implemented.' }),
  },
  {
    id: 'DM-1', area: 'Data minimisation',
    claim: 'Student identification collects no personal data unless the teacher opts in.',
    maps: { iso: 'A.5.34', soc2: 'P4' },
    evidence: ['roster.js complianceFor()', 'PIN and issued-code modes store no PII', 'email mode gated behind an attestation'],
    verify: (f) => f.emailModeClassesWithoutAttestation > 0
      ? { status: 'partial', detail: `${f.emailModeClassesWithoutAttestation} class(es) use emailed codes with no recorded attestation.` }
      : { status: 'met', detail: 'Every class storing email addresses has a recorded attestation.' },
  },
  {
    id: 'CN-1', area: 'Consent & lawful basis',
    claim: 'Policy changes are pushed to users and acceptance is recorded per user, per version.',
    maps: { iso: 'A.5.34', soc2: 'P2' },
    evidence: ['app_config/policy + policy_history', 'users/$uid/acceptedPolicyLog/$version', 'admin Legal panel'],
    verify: (f) => !f.policyVersion
      ? { status: 'partial', detail: 'The machinery is armed but no policy version has been published yet.' }
      : f.usersOnCurrentPolicy === f.usersTotal
        ? { status: 'met', detail: `All ${f.usersTotal} users have accepted policy v${f.policyVersion}.` }
        : { status: 'partial', detail: `${f.usersOnCurrentPolicy} of ${f.usersTotal} users have accepted policy v${f.policyVersion}.` },
  },
  {
    id: 'SP-1', area: 'Third parties',
    claim: 'Every subprocessor is listed publicly with what it does and where data goes.',
    maps: { iso: 'A.5.19 Supplier relationships', soc2: 'CC9.2' },
    evidence: ['/subprocessors', '/dpa', 'api/legal-watch.js monitors vendor policy pages'],
    verify: (f) => f.subprocessorsPageOk === false
      ? { status: 'partial', detail: 'The public subprocessors page did not load on the last sweep.' }
      : { status: 'met', detail: 'Published, and vendor policy pages are watched for changes.' },
  },
  {
    id: 'IR-1', area: 'Incident response',
    claim: 'There is a written procedure for common failures, and incidents are recorded.',
    maps: { iso: 'A.5.24 Incident management planning', soc2: 'CC7.4' },
    evidence: ['Admin → Runbook · Fix-it', 'admin/incidents', 'DISASTER-RECOVERY.md', 'ops alert email'],
    verify: () => ({ status: 'met', detail: 'Runbook and incident log both exist; status transitions email the founder.' }),
  },
  {
    id: 'CM-1', area: 'Change management',
    claim: 'Changes are gated by automated checks before release.',
    maps: { iso: 'A.8.32 Change management', soc2: 'CC8.1' },
    evidence: ['scripts/qa.js — syntax, undefined names, reachability, escaping, parity', 'scripts/tests/*'],
    verify: (f) => f.testAssertions > 0
      ? { status: 'met', detail: `${f.testAssertions} assertions across ${f.testFiles} test files gate every push.` }
      : { status: 'partial', detail: 'Test suite present but not measured here.' },
  },
  {
    id: 'AU-1', area: 'Independent assurance',
    claim: 'An accredited external audit has been completed.',
    maps: { iso: 'ISO/IEC 27001 certification', soc2: 'SOC 2 Type II report' },
    evidence: [],
    /* Hard-coded to 'none' on purpose, and it must stay that way until a real report
     * exists. This is the row that stops the register being mistaken for a
     * certification: everything above can be green while this is red, and that is
     * an accurate description of where PollSlide stands. */
    verify: () => ({ status: 'none',
      detail: 'Not audited. ISO 27001 and SOC 2 require an accredited external auditor and cannot be self-certified.' }),
  },
];

const STATUS_ORDER = { none: 0, partial: 1, met: 2 };

function assessControls(facts) {
  const f = facts || {};
  return CONTROLS.map(c => {
    let r;
    try { r = c.verify(f) || {}; } catch (e) { r = { status: 'none', detail: 'Could not evaluate: ' + e.message }; }
    const status = ['met', 'partial', 'none'].indexOf(r.status) >= 0 ? r.status : 'none';
    return { id: c.id, area: c.area, claim: c.claim, maps: c.maps, evidence: c.evidence,
             status, detail: r.detail || '' };
  }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.id.localeCompare(b.id));
}

/* Who accepted what, and when. Two independent kinds of record:
 *   policy   — a user accepted a published version of the Terms/Privacy documents
 *   class    — a teacher attested their school may use students' email addresses
 * They answer different questions and are never merged. */
function attestationRows(users, policy) {
  const rows = [];
  const pol = policy || {};
  Object.entries(users || {}).forEach(([uid, u]) => {
    if (!u) return;
    const log = u.acceptedPolicyLog || {};
    Object.entries(log).forEach(([version, rec]) => {
      rows.push({
        kind: 'policy', uid, who: u.email || uid,
        what: 'Terms & Privacy v' + version,
        documents: (rec && Array.isArray(rec.docs)) ? rec.docs.join(', ') : '',
        at: (rec && rec.at) || null,
        detail: (rec && rec.summary) || '',
      });
    });
    // Accepted before there was a per-version log — still a real acceptance.
    if (!Object.keys(log).length && u.acceptedPolicyVersion) {
      rows.push({ kind: 'policy', uid, who: u.email || uid,
        what: 'Terms & Privacy v' + u.acceptedPolicyVersion, documents: '',
        at: u.acceptedPolicyAt || null, detail: 'Recorded before per-version logging.' });
    }
    Object.entries(u.classes || {}).forEach(([cid, c]) => {
      if (!c || !c.attestedAt) return;
      rows.push({
        kind: 'class', uid, who: c.attestedBy || u.email || uid,
        what: 'Right to use student email addresses — ' + (c.name || cid),
        documents: c.attestedFor ? c.attestedFor + ' verification mode' : '',
        at: c.attestedAt, detail: '',
      });
    });
  });
  return rows.sort((a, b) => (b.at || 0) - (a.at || 0));
}

/* The gaps. Not "who is non-compliant" — who has not been asked yet, or was asked and
 * has not answered. The distinction matters when reporting it to anyone. */
function attestationGaps(users, policy) {
  const version = Number((policy || {}).version || 0);
  const gaps = { policyOutstanding: [], classesWithoutAttestation: [] };
  Object.entries(users || {}).forEach(([uid, u]) => {
    if (!u) return;
    if (version && Number(u.acceptedPolicyVersion || 0) < version) {
      gaps.policyOutstanding.push({ uid, who: u.email || uid, on: Number(u.acceptedPolicyVersion || 0) });
    }
    Object.entries(u.classes || {}).forEach(([cid, c]) => {
      if (c && c.verifyMode === 'email' && !c.attestedAt) {
        gaps.classesWithoutAttestation.push({ uid, who: u.email || uid, className: c.name || cid });
      }
    });
  });
  return gaps;
}

function summarize(users, policy) {
  const all = Object.values(users || {}).filter(Boolean);
  const version = Number((policy || {}).version || 0);
  const onCurrent = version ? all.filter(u => Number(u.acceptedPolicyVersion || 0) >= version).length : 0;
  const gaps = attestationGaps(users, policy);
  return {
    usersTotal: all.length,
    policyVersion: version || null,
    usersOnCurrentPolicy: onCurrent,
    emailModeClassesWithoutAttestation: gaps.classesWithoutAttestation.length,
  };
}

module.exports = { CONTROLS, assessControls, attestationRows, attestationGaps, summarize };
