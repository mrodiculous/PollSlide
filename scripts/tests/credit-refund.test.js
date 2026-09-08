#!/usr/bin/env node
/* Reversing a refunded credit pack.
 *
 * WHY THESE CASES: the webhook handled five events and none of them was a refund, so a
 * refunded credit pack left the credits sitting in the account — buy 500, spend them, ask
 * for the money back. The handler that fixes it is easy to get subtly wrong in ways that
 * only show up with real money, so the arithmetic is tested here instead:
 *
 *   • charge.refunded fires ONCE PER REFUND and carries the RUNNING total, so half and then
 *     the other half arrive as two events. The first version keyed off a done/refunded flag,
 *     honoured the first and dropped the second — half the credits kept, all the money back.
 *   • Stripe redelivers events. A redelivery must remove nothing the second time.
 *   • Rounding on a partial refund must never favour the customer.
 */
const path = require('path');
const { creditsToReverse } = require(path.resolve(__dirname, '..', '..', 'lib', 'credit-refund.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
};
const charge = (amount, refunded) => ({ amount, amount_refunded: refunded });

console.log('\nA full refund takes back everything');
{
  const r = creditsToReverse({ credits: 100 }, charge(3000, 3000));
  ok('all 100 credits come off', r.take === 100, r);
  ok('the record is marked refunded', r.status === 'refunded', r.status);
}

console.log('\nA partial refund takes back the same share');
{
  const r = creditsToReverse({ credits: 100 }, charge(3000, 1500));
  ok('half the pack is 50 credits', r.take === 50, r);
  ok('it is marked partial, not refunded', r.status === 'partially_refunded', r.status);

  const third = creditsToReverse({ credits: 20 }, charge(800, 267));
  ok('a third of 20 rounds UP to 7, never down in the customer’s favour',
     third.take === 7, third);
}

console.log('\nTwo refunds settle the difference, they do not double-count');
{
  const first = creditsToReverse({ credits: 100 }, charge(3000, 1500));
  ok('first event removes 50', first.take === 50, first);
  // Stripe now reports the RUNNING total, and the record remembers what was taken.
  const second = creditsToReverse({ credits: 100, creditsRemoved: first.owed }, charge(3000, 3000));
  ok('second event removes only the remaining 50', second.take === 50, second);
  ok('and 100 total have been reversed, not 150', first.owed + second.take === 100,
     { first: first.owed, second: second.take });
  ok('the second event closes it out as refunded', second.status === 'refunded', second.status);
}

console.log('\nA redelivered event changes nothing');
{
  const done = { credits: 100, creditsRemoved: 100 };
  const again = creditsToReverse(done, charge(3000, 3000));
  ok('take is zero', again.take === 0, again);
  ok('it says why', /already reversed/.test(again.reason || ''), again.reason);

  const partialAgain = creditsToReverse({ credits: 100, creditsRemoved: 50 }, charge(3000, 1500));
  ok('a redelivered PARTIAL refund is also a no-op', partialAgain.take === 0, partialAgain);
}

console.log('\nThe cases that must not throw or over-take');
{
  ok('a purchase that granted nothing is a no-op',
     creditsToReverse({ credits: 0 }, charge(3000, 3000)).take === 0);
  ok('a missing record is a no-op', creditsToReverse(null, charge(3000, 3000)).take === 0);
  ok('a zero-amount charge is treated as a full refund rather than dividing by zero',
     creditsToReverse({ credits: 50 }, charge(0, 0)).take === 50);
  ok('a refund larger than the charge cannot take more than was granted',
     creditsToReverse({ credits: 100 }, charge(3000, 9999)).take === 100);
  ok('a zero refund takes nothing', creditsToReverse({ credits: 100 }, charge(3000, 0)).take === 0);
  ok('a negative amount_refunded cannot ADD credits',
     creditsToReverse({ credits: 100 }, charge(3000, -500)).take === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
