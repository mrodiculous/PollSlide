/* PollSlide — one place that answers "what plan is this Stripe subscription?"
 * ---------------------------------------------------------------------------
 * This logic used to live only inside api/stripe-webhook.js. The Auto-pilot drift
 * check needs the same answer, and a second copy of a price→tier map is a bug with
 * a delay fuse: the day a price id changes, one copy gets updated and the other
 * silently starts giving wrong answers about what people paid for.
 *
 * STRICT MODE matters. The webhook is reacting to a real event and would rather
 * guess "pro" than do nothing. The watchdog is deciding whether to CHANGE someone's
 * plan on its own — there, a guess is unacceptable, so strict mode returns null and
 * the drift check treats "don't know" as "not drift" and leaves the account alone.
 * --------------------------------------------------------------------------- */

const VALID_TIERS = ['pro', 'team_small', 'team_large'];

// Read env at call time, not module load, so a changed env var takes effect on the
// next invocation rather than needing a cold start to be noticed.
function priceIdMap() {
  return {
    [process.env.STRIPE_PRICE_PRO_MONTHLY]: 'pro',
    [process.env.STRIPE_PRICE_PRO_ANNUAL]: 'pro',
    [process.env.STRIPE_PRICE_TEAM_SMALL_MONTHLY]: 'team_small',
    [process.env.STRIPE_PRICE_TEAM_SMALL_ANNUAL]: 'team_small',
    [process.env.STRIPE_PRICE_TEAM_LARGE_MONTHLY]: 'team_large',
    [process.env.STRIPE_PRICE_TEAM_LARGE_ANNUAL]: 'team_large',
  };
}

function getTierFromPriceId(priceId) {
  if (!priceId) return null;
  return priceIdMap()[priceId] || null;   // null = unknown; let the caller decide
}

// The price's lookup key IS the current plan — e.g. "pollslide_team_small_monthly" →
// "team_small". This reflects the REAL plan after a Customer-Portal switch, unlike the
// subscription's metadata.plan (stamped at checkout, never updated on a switch).
function planFromLookupKey(lookupKey) {
  if (!lookupKey || lookupKey.indexOf('pollslide_') !== 0) return null;
  const plan = lookupKey.replace('pollslide_', '').replace(/_(monthly|annual)$/, '');
  return VALID_TIERS.includes(plan) ? plan : null;
}

/* Resolve the true current tier for a subscription.
 *   lookup key  →  price-id env map  →  subscription metadata
 * opts.strict: return null instead of falling back to 'pro' when nothing matched.
 */
async function tierForSubscription(stripe, sub, opts = {}) {
  const priceItem = sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price;
  const priceId = priceItem && priceItem.id;
  let lookupKey = priceItem && priceItem.lookup_key;
  if (!lookupKey && priceId && stripe) {
    try { const p = await stripe.prices.retrieve(priceId); lookupKey = p.lookup_key; } catch (e) { /* fall through */ }
  }
  const metaPlan = sub.metadata && sub.metadata.plan;
  return planFromLookupKey(lookupKey)
      || getTierFromPriceId(priceId)
      || (VALID_TIERS.includes(metaPlan) ? metaPlan : (opts.strict ? null : 'pro'));
}

module.exports = { VALID_TIERS, priceIdMap, getTierFromPriceId, planFromLookupKey, tierForSubscription };
