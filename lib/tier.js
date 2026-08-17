// PollSlide — the ONE place a user's plan tier may change.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// On 2026-08-07 an account was silently downgraded team_small → free, and on
// 2026-08-17 silently restored, with no user action. It was impossible to say what
// did it, because FIVE different files wrote `users/<uid>/tier` directly and NONE of
// them recorded who, why, or from what. There was no audit trail to consult.
//
// Every tier change now goes through setUserTier(), which:
//   1. NO-OPS when the tier is already what you're setting. This alone kills a whole
//      class of "you've been downgraded" emails caused by Stripe replaying a webhook
//      or sending an `updated` event that didn't actually change the plan.
//   2. Writes an immutable audit row to admin/tier_log/<uid>/<ts> naming the actor,
//      the source, the reason, and the previous value.
//   3. Returns { changed, from, to } so the CALLER decides whether to email — emails
//      must only ever be sent for a real change.
//
// Nothing here throws: billing must never take down a request path.
// ---------------------------------------------------------------------------
const admin = require('firebase-admin');

const VALID_TIERS = ['free', 'pro', 'team_small', 'team_large'];

/**
 * Change a user's tier, audited and idempotent.
 *
 * @param {object} db     Firebase admin database instance
 * @param {string} uid    Firebase user id
 * @param {string} tier   one of VALID_TIERS
 * @param {object} meta
 *   @param {string} meta.source  machine origin — 'stripe-webhook' | 'comp-sweep' | 'team' | 'admin-panel'
 *   @param {string} meta.reason  human sentence, e.g. 'subscription.deleted'
 *   @param {string} [meta.actor] who caused it: an admin email, 'stripe', 'cron'
 *   @param {string} [meta.ref]   correlating id (Stripe event id, workspace id…)
 * @returns {Promise<{changed:boolean, from:string|null, to:string, reason?:string}>}
 */
async function setUserTier(db, uid, tier, meta = {}) {
  if (!uid) return { changed: false, from: null, to: tier, reason: 'no uid' };
  if (!VALID_TIERS.includes(tier)) {
    // Refuse to write a tier we don't recognise rather than corrupt an account.
    console.error(`setUserTier: refusing unknown tier "${tier}" for ${uid}`);
    return { changed: false, from: null, to: tier, reason: 'invalid tier' };
  }

  let from = null;
  try { from = (await db.ref(`users/${uid}/tier`).get()).val() || 'free'; }
  catch (e) { from = null; }

  // ── Idempotency ──────────────────────────────────────────────────────────
  // Same tier in, same tier out → do nothing at all. No write, no audit noise,
  // and critically no email. Stripe WILL redeliver events; this makes that safe.
  if (from === tier) {
    return { changed: false, from, to: tier, reason: 'already at this tier' };
  }

  const at = Date.now();
  const entry = {
    at,
    from: from || 'unknown',
    to: tier,
    source: String(meta.source || 'unknown').slice(0, 40),
    reason: String(meta.reason || '').slice(0, 200),
    actor: String(meta.actor || 'system').slice(0, 120),
    ref: meta.ref ? String(meta.ref).slice(0, 120) : null,
  };

  await db.ref(`users/${uid}`).update({ tier, tierUpdatedAt: at });
  await db.ref(`admin/users_index/${uid}`).update({ tier, tierUpdatedAt: at }).catch(() => {});
  // Audit row is append-only, keyed by timestamp — never overwritten, never deleted
  // by normal flows, so "what happened to my plan?" always has an answer.
  await db.ref(`admin/tier_log/${uid}/${at}`).set(entry).catch(() => {});

  console.log(`tier ${uid}: ${entry.from} → ${tier} (${entry.source}: ${entry.reason})`);
  return { changed: true, from: entry.from, to: tier };
}

/**
 * Has this Stripe event already been handled? Claims it atomically if not.
 * Stripe guarantees AT LEAST once delivery, so without this a redelivered
 * subscription event re-runs the whole handler — which is the most likely cause of
 * a plan flipping with no user action.
 * @returns {Promise<boolean>} true if this call owns the event (safe to process)
 */
async function claimStripeEvent(db, eventId) {
  if (!eventId) return true;                       // nothing to dedupe on — process it
  try {
    const ref = db.ref(`admin/stripe_events/${eventId}`);
    const r = await ref.transaction(cur => (cur === null ? { at: Date.now() } : undefined));
    return !!r.committed;                          // committed === we claimed it first
  } catch (e) {
    return true;   // never block real billing on the dedupe store failing
  }
}

module.exports = { setUserTier, claimStripeEvent, VALID_TIERS };
