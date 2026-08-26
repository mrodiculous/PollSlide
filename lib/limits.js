/* PollSlide — plan limits, server-side.
 * ---------------------------------------------------------------------------
 * presenter.html has its own TIERS table for the UI. The share endpoint needs the
 * SAME numbers to decide whether a recipient may accept another deck, and a second
 * hand-maintained copy of a pricing table is a bug with a delay fuse: the day a cap
 * changes, one copy gets updated and the other quietly starts lying.
 *
 * These values must stay identical to TIERS in presenter.html.
 * scripts/tests/limits.test.js parses that table out of the HTML and asserts they
 * agree, so the two cannot drift apart silently.
 * --------------------------------------------------------------------------- */

const TIERS = {
  free:       { name: 'Free',       maxPresentations: 3,        maxParticipants: 25,       maxMembers: 1,  aiMonthly: 5   },
  pro:        { name: 'Pro',        maxPresentations: Infinity, maxParticipants: Infinity, maxMembers: 1,  aiMonthly: 20  },
  team_small: { name: 'Team Small', maxPresentations: Infinity, maxParticipants: Infinity, maxMembers: 5,  aiMonthly: 100 },
  team_large: { name: 'Team Large', maxPresentations: Infinity, maxParticipants: Infinity, maxMembers: 25, aiMonthly: 300 },
};

// Legacy keys: old 'team' was the 5-seat plan, old 'white' the largest.
function normalizeTier(t) {
  if (t === 'team') return 'team_small';
  if (t === 'white') return 'team_large';
  return TIERS[t] ? t : 'free';
}

function limitsFor(tier) { return TIERS[normalizeTier(tier)] || TIERS.free; }

module.exports = { TIERS, normalizeTier, limitsFor };
