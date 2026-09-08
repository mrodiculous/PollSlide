/* PollSlide — how many Polly credits a refund takes back.
 * ---------------------------------------------------------------------------
 * Pulled out of api/stripe-webhook.js because it is arithmetic about money, and because
 * the interesting cases cannot be reached from a live Stripe test without actually
 * refunding things: a partial refund followed by the rest, a duplicate delivery of the
 * same event, a customer who has already spent what they bought.
 *
 * THE RULE: reconcile against the TOTAL refunded so far, never against a done/refunded
 * flag. `charge.refunded` fires once per refund and carries the RUNNING `amount_refunded`,
 * so refunding half and then the other half delivers two events. A binary status honours
 * the first and drops the second — the customer keeps half the credits and all the money.
 */

/* @param purchase {credits, creditsRemoved?}  the record addCredits() wrote
 * @param charge   {amount, amount_refunded}   the Stripe charge, in cents
 * @returns {take, owed, status, reason}
 *          take  — credits to remove NOW (0 means this event changes nothing)
 *          owed  — total that should have been removed across all refunds so far
 */
function creditsToReverse(purchase, charge) {
  const granted = (purchase && purchase.credits) || 0;
  if (!granted) return { take: 0, owed: 0, status: null, reason: 'nothing was granted' };

  const amount = (charge && charge.amount) || 0;
  // No amount to divide by (a $0 purchase, or a malformed charge) is treated as a full
  // refund: the alternative is dividing by zero and silently taking nothing back.
  const share = amount ? Math.max(0, Math.min(1, (charge.amount_refunded || 0) / amount)) : 1;

  // Rounded UP, so a partial refund never leaves the customer ahead on the rounding.
  const owed  = Math.min(granted, Math.ceil(granted * share));
  const taken = (purchase && purchase.creditsRemoved) || 0;
  const take  = owed - taken;

  if (take <= 0) {
    return { take: 0, owed: taken, status: null,
             reason: `${taken} of ${granted} already reversed` };
  }
  return { take, owed, status: owed >= granted ? 'refunded' : 'partially_refunded', reason: null };
}

module.exports = { creditsToReverse };
