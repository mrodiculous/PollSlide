/* Team owner handover — the decision, kept pure so every case is tested (2026-10-07).
 * Used by api/team.js (adminTransferPlan / adminTransferOwner); tests:
 * scripts/tests/team-transfer.test.js.
 *
 * THE RULE THE BILLING SYSTEM RELIES ON: a team's OWNER is its PAYER. The Stripe webhook finds
 * the account from `firebase_uid` on the subscription/customer and, when that account's plan
 * changes, moves the whole team with it (stripe-webhook syncWorkspaceTier: owner only).
 * So handover MOVES THE EXISTING SUBSCRIPTION with ownership — same card, same renewal date,
 * no new charge, no proration, never two subscriptions — and the rule stays true:
 *   • paid team   → the subscription's and customer's firebase_uid (and the billing email,
 *                   unless told not to) move to the new owner; "Manage billing" follows;
 *   • comped/demo → no Stripe at all: only ownership moves;
 *   • refused     → the new owner already pays for something (two payers), the old owner has
 *                   more than one live subscription (which one?), the new owner is not on the
 *                   team, or the old owner is not the owner.
 * The old owner stays on the team as an admin and keeps the team plan through it. */
'use strict';

const LIVE = ['active', 'trialing', 'past_due', 'unpaid'];

/* billing: { customerId: string|null, subs: [{ id, status, tier }] } — as read from Stripe. */
function planTransfer({ ws, fromUid, toUid, from, to, moveBillingEmail = true }) {
  const problems = [], steps = [], notes = [];
  if (!ws) return { ok: false, problems: ['Workspace not found.'], steps, notes };
  const members = ws.members || {};
  if (ws.ownerUid !== fromUid) problems.push('The current owner has changed since you opened this — reload.');
  if (!members[toUid]) problems.push('The new owner must already be a member of this team (add them first).');
  if (toUid === fromUid) problems.push('That person is already the owner.');

  const fromLive = ((from && from.subs) || []).filter(s => LIVE.includes(s.status));
  const toLive = ((to && to.subs) || []).filter(s => LIVE.includes(s.status));
  const comp = !!ws.comp;

  if (toLive.length) problems.push(`The new owner already has their own live subscription (${toLive.map(s => s.tier || s.status).join(', ')}). Moving the team's would make them pay twice — cancel theirs first (Stripe), then transfer.`);
  if (fromLive.length > 1) problems.push(`The current owner has ${fromLive.length} live subscriptions — sort that out in Stripe first so it is clear which one pays for the team.`);

  let moveSub = null;
  if (fromLive.length === 1) {
    moveSub = fromLive[0];
    const isTeam = moveSub.tier === 'team_small' || moveSub.tier === 'team_large';
    if (!isTeam) problems.push(`The current owner's subscription is ${moveSub.tier || 'not a team plan'}, not a team plan — this team is not paid by it. Check Stripe before transferring.`);
    if (moveSub.status === 'past_due' || moveSub.status === 'unpaid') notes.push(`The subscription is ${moveSub.status}: the new owner should update the card in "Manage billing" right after the transfer.`);
  } else if (!comp) {
    notes.push('No live subscription found for the current owner (comped plan, enterprise invoice, or a cancelled plan) — only ownership moves; nothing in Stripe changes.');
  }

  const toEmail = (members[toUid] && members[toUid].email) || (to && to.email) || '';
  const fromEmail = (members[fromUid] && members[fromUid].email) || (from && from.email) || '';
  if (moveSub && !problems.length) {
    steps.push(`Stripe: subscription ${moveSub.id} (${moveSub.tier}, ${moveSub.status}) is re-tagged to ${toEmail} — same card, same renewal date, no charge.`);
    steps.push(`Stripe: customer ${from.customerId} is re-tagged to ${toEmail}${moveBillingEmail ? ` and receipts go to ${toEmail}` : ` (receipts keep going to ${fromEmail})`}.`);
    steps.push(`${toEmail} gets "Manage billing"; ${fromEmail} no longer can.`);
  }
  if (!problems.length) {
    steps.push(`${toEmail} becomes the owner; ${fromEmail} becomes an admin and keeps the team plan.`);
    if (comp) steps.push('The free demo carries on unchanged.');
  }
  return { ok: problems.length === 0, problems, steps, notes, moveSub, toEmail, fromEmail, customerId: moveSub ? from.customerId : null };
}

module.exports = { planTransfer, LIVE };
