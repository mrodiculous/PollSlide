#!/usr/bin/env node
/* The Checkout Session parameters, asserted as source, because this is where live checkout
 * broke and nothing was watching.
 *
 * WHAT HAPPENED (2026-09-08): Stripe went live, and every purchase — all three plans, both
 * billing cycles, all four credit packs — failed with
 *
 *     "Tax ID collection requires updating business name on the customer. To enable tax ID
 *      collection for an existing customer, please set customer_update[name] to auto."
 *
 * because the optional tax block set `customer_update = { address: 'auto' }` and enabled
 * `tax_id_collection` without also permitting `name`. Stripe only enforces that when the
 * session is attached to an EXISTING customer, and create-checkout.js creates one a few lines
 * earlier — so it failed for everybody, always, and only once real money was switched on.
 *
 * It could not be caught by a normal test: it needs a live Stripe call. So these assert the
 * shape of the request instead, which is the part we control and the part that was wrong.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
/* Comments are stripped first. Every assertion here is about what the code SENDS, and the
   comments in these files quote the very Stripe parameters being checked — so scanning the
   raw text matches the explanation of a bug as readily as the bug. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p) => strip(fs.readFileSync(path.join(ROOT, p), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
};

/* Pull the block guarded by an env var, so the assertions are about the code that actually
   runs when that flag is on rather than about the file as a whole. */
/* The guard string appears more than once — stripe-admin.js reads the env var once to report
   it and again to build the params — so take the window that actually contains the params,
   not the first match. Anchoring on the first occurrence tested 900 characters of the wrong
   function and reported the parameters missing when they were fine. */
function taxBlock(src) {
  for (const guard of ["STRIPE_AUTOMATIC_TAX === '1'", 'out.automaticTax']) {
    let i = -1;
    while ((i = src.indexOf(guard, i + 1)) !== -1) {
      const win = src.slice(i, i + 900);
      if (/tax_id_collection/.test(win)) return win;
    }
  }
  return '';
}

for (const file of ['api/create-checkout.js', 'api/stripe-admin.js']) {
  console.log('\n' + file + ' — tax block');
  const src = read(file);
  const tax = taxBlock(src);
  ok('the file has a tax block to check', tax.length > 0);
  if (!tax) continue;

  const collectsTaxId = /tax_id_collection/.test(tax);
  ok('tax_id_collection is enabled (this is what makes the pairing below mandatory)', collectsTaxId);

  const cu = /customer_update\s*=\s*\{([^}]*)\}/.exec(tax);
  ok('customer_update is set alongside it', !!cu,
     'without it Stripe refuses the session for any existing customer');
  if (cu) {
    ok("customer_update permits address", /address:\s*'auto'/.test(cu[1]), cu[1].trim());
    ok("customer_update permits NAME — the one that was missing",
       /name:\s*'auto'/.test(cu[1]), cu[1].trim());
  }
  ok('automatic_tax is enabled in the same block', /automatic_tax/.test(tax));
  // written as an object literal in one file and an assignment in the other
  ok('a billing address is required, which Stripe needs before it can know a rate',
     /billing_address_collection\s*[:=]\s*'required'/.test(tax));
}

console.log('\nThe dry run exercises the same path as a real purchase');
{
  const src = read('api/stripe-admin.js');
  const dry = src.slice(src.indexOf("action === 'checkout-dryrun'"));
  ok('it attaches a real customer, not customer_email',
     /customer:\s*temp\.id/.test(dry) && !/customer_email/.test(dry),
     'customer_email skips every rule that only applies to an existing customer — the first ' +
     'version of this check passed while live checkout was failing');
  ok('the throwaway customer is always deleted', /finally\s*\{[\s\S]{0,200}customers\.del/.test(dry));
  ok('the session is expired rather than left open', /sessions\.expire/.test(dry));
}

console.log('\nBoth checkout paths report failures where someone can see them');
{
  const p = read('presenter.html');
  ok('there is one shared error renderer', /function showCheckoutError/.test(p));
  ok('the plan path uses it', /showErr\s*=\s*\(headline, detail\)\s*=>\s*showCheckoutError/.test(p));
  ok('the credit path uses it', /buyCredits[\s\S]{0,2000}showCheckoutError/.test(p));
  const z = /\.toast\s*\{[^}]*z-index:\s*(\d+)/.exec(p);
  ok('the toast outranks every modal in the file', z && Number(z[1]) > 200000,
     z ? 'toast z-index is ' + z[1] : 'no toast z-index found');
  ok('the billing portal does not close the picker before it knows it can open',
     !/function openBillingPortal\(\)\s*\{\s*document\.getElementById\('planPickerModal'\)\?\.remove\(\)/.test(p),
     'closing first is what made a complimentary plan look like the window just vanished');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
