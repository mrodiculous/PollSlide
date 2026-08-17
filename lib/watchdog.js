/* PollSlide — Auto-pilot: detect → fix → tell Rod.
 * ---------------------------------------------------------------------------
 * The point of this file is that problems should find ME, not the other way round,
 * and the ones with a known safe remedy should already be fixed by the time I hear
 * about them.
 *
 * SHAPE
 *   Each entry in CHECKS is: gather() pulls raw facts → evaluate() is a PURE function
 *   deciding ok/not-ok → fix() (optional) applies a known-safe remedy. Keeping
 *   evaluate() pure is what makes the thresholds unit-testable without Firebase; the
 *   alternative is thresholds nobody ever verifies until they misfire at 2am.
 *
 * SELF-HEAL LOOP
 *   not ok + autoFix  →  run fix()  →  gather+evaluate AGAIN to confirm.
 *   Only a confirmed re-check counts as fixed. "I ran the remedy" is not "it works" —
 *   that is the same mistake as asserting a button's label instead of clicking it.
 *
 * EMAIL DISCIPLINE (the reason this stays useful instead of becoming noise)
 *   One email per state TRANSITION, never per run:
 *     • self-healed          → "this broke, I already fixed it"     (single email)
 *     • broken, no remedy    → "this needs you"                     (once)
 *     • still broken 24h on  → escalation                           (once a day, max)
 *     • recovered            → "resolved"                           (once)
 *   A check that is failing every 15 minutes generates ONE email, not 96.
 *
 * SAFETY: every remedy here is idempotent and additive (re-run a backup, sweep a
 * cache, restore a tier to match Stripe). Nothing in this file deletes user content.
 * --------------------------------------------------------------------------- */

const ESCALATE_AFTER_MS = 24 * 60 * 60 * 1000;

/* ── Pure decision helpers (unit-tested in scripts/tests/watchdog.test.js) ── */

function evalBackupAge(d) {
  const maxH = d.maxAgeHours || 48;
  if (!d.lastOkAt) return { ok: false, detail: 'No successful backup has ever been recorded.' };
  const ageH = (d.now - d.lastOkAt) / 3600000;
  if (ageH > maxH) return { ok: false, detail: `Last successful backup was ${ageH.toFixed(1)}h ago (limit ${maxH}h).` };
  return { ok: true, detail: `Last backup ${ageH.toFixed(1)}h ago.` };
}

function evalErrorSpike(d) {
  const worstN = d.worst ? d.worst.count : 0;
  if (worstN >= (d.singleThreshold || 10)) {
    return { ok: false, detail: `“${d.worst.message}” on ${d.worst.page} has hit ${worstN} browsers today.` };
  }
  if (d.total >= (d.totalThreshold || 40)) {
    return { ok: false, detail: `${d.total} client errors today across ${d.distinct} distinct faults.` };
  }
  return { ok: true, detail: `${d.total} client error(s) today.` };
}

const TIER_RANK = { free: 0, pro: 1, team_small: 2, team_large: 3 };

/* Our tier vs what Stripe says.
 *
 * The direction of the disagreement decides whether we may act on it:
 *
 *   RESTORE  (Stripe says they pay for MORE than we're giving them)
 *     Safe to fix automatically. Someone paid and isn't getting it — that is the
 *     Aug 7 bug, and the worst case of being wrong is a user briefly having access
 *     they already paid for.
 *
 *   REVIEW   (Stripe implies LESS than we're giving them)
 *     Never automatic. Two legitimate reasons to sit above your Stripe subscription:
 *     a team member inherits the workspace owner's tier, and a comped account has no
 *     subscription at all. Auto-"fixing" those strips access from people entitled to
 *     it. Those uids are filtered out upstream, but a downgrade still gets a human.
 */
function evalTierDrift(d) {
  const rows = d.rows || [];
  const drift = rows.filter(r => r.expected && r.actual !== r.expected);
  const rank = (t) => (TIER_RANK[t] == null ? -1 : TIER_RANK[t]);
  const restore = drift.filter(r => rank(r.expected) > rank(r.actual));
  const review  = drift.filter(r => rank(r.expected) < rank(r.actual));

  if (!drift.length) {
    return { ok: true, detail: `${rows.length} Stripe-linked account(s) match.`, drift, restore, review };
  }
  const say = (r) => `${r.email || r.uid}: we say “${r.actual}”, Stripe says “${r.expected}”`;
  return {
    ok: false, drift, restore, review,
    detail: [
      restore.length ? `Under-granted (will be restored): ${restore.map(say).join('; ')}` : '',
      review.length  ? `Over-granted (needs your review — do NOT assume it's wrong, team members and comps legitimately sit above Stripe): ${review.map(say).join('; ')}` : '',
    ].filter(Boolean).join(' — '),
  };
}

function evalProbe(d) {
  const bad = (d.results || []).filter(r => !r.ok);
  if (!bad.length) return { ok: true, detail: `${(d.results || []).length} endpoint(s) responding.` };
  return { ok: false, detail: bad.map(r => `${r.name} → ${r.status}`).join('; ') };
}

function evalAiReachable(d) {
  if (d.localOk) return { ok: true, detail: 'Local model responding.' };
  if (d.cloudConfigured) return { ok: true, detail: 'Local model unreachable, but the OpenAI fallback is configured — Polly still works.' };
  return { ok: false, detail: 'Local model unreachable AND no OPENAI_API_KEY set. Polly will fail for every user.' };
}

/* ── Which email (if any) does this transition deserve? ────────────────────────
 * Pure, so the anti-spam rules are actually testable. `prev` is the stored incident
 * (or null); `res` is {ok}; `selfHealed` means a remedy ran and the RE-CHECK passed.
 * Returns null (say nothing) or {kind, status}.
 */
function decideNotification(prev, res, selfHealed, now) {
  const wasOpen = !!prev && prev.status === 'open';

  if (res.ok) {
    if (wasOpen) return { kind: 'resolved', status: 'resolved' };
    return null;                                   // fine, and was already fine
  }
  if (selfHealed) {
    // Broke and is already fixed. Tell Rod once; don't leave an open incident.
    return { kind: 'self_healed', status: 'resolved' };
  }
  if (!wasOpen) return { kind: 'opened', status: 'open' };

  // Already open and still broken — stay quiet unless it has been ignored a full day.
  const lastPing = (prev.notified && (prev.notified.escalated || prev.notified.opened)) || prev.firstAt || 0;
  if (now - lastPing >= ESCALATE_AFTER_MS) return { kind: 'escalated', status: 'open' };
  return { kind: null, status: 'open' };
}

module.exports = {
  ESCALATE_AFTER_MS, TIER_RANK,
  evalBackupAge, evalErrorSpike, evalTierDrift, evalProbe, evalAiReachable,
  decideNotification,
};
