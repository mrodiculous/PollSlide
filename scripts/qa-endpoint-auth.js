#!/usr/bin/env node
/* PollSlide QA — an endpoint must not take WHO YOU ARE from the request body.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * api/billing-portal.js shipped taking `email` straight from the POST body with no
 * authentication of any kind. Anyone who knew a paying customer's email address could
 * POST it and receive a working Stripe billing-portal link for that customer: their
 * invoices and billing address, their saved payment methods, and the ability to cancel
 * or switch their plan. api/create-checkout.js had the same shape with `email` + `uid`.
 *
 * Both looked fine in review. The endpoint had a CORS allowlist, which reads like a
 * control and is not one — CORS constrains browsers, and an attacker uses curl.
 *
 * THE RULE: identity fields (uid, email, customer, account…) may be READ from the body
 * only by endpoints that also verify a token. If a file destructures one of those names
 * out of req.body and has no verifyToken/CRON_SECRET/internal-key anywhere, that is the
 * bug this gate exists to catch.
 *
 * Deliberately NOT flagged: a body email that is only a *destination* to send something
 * to and not a claim about the caller (enterprise-lead.js takes a lead's address), and
 * webhooks that authenticate by signature (stripe-webhook.js).
 */
const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..', 'api');
const IDENTITY = ['uid', 'email', 'userId', 'customerId', 'customer', 'accountId'];

/* Signature-verified or intentionally public-by-design. Each needs a REASON, so that
   adding to this list is a decision someone has to defend rather than a quick silence. */
const ALLOW = {
  'stripe-webhook.js': 'authenticates by Stripe signature, not by caller identity',
  'enterprise-lead.js': 'body email is the lead being submitted, not a claim about the caller',
  'client-error.js': 'anonymous error beacon; stores no identity-keyed data',
};

/* verifyIdToken is in here because delete-account.js calls the Firebase Admin SDK
   directly instead of the lib/quota helper, and the first version of this gate flagged
   it — a false positive on a file that is actually correct (it checks
   callerUid === uid || isAdmin). A gate that cries wolf gets switched off, which is
   how the bug it was written to catch comes back. */
const hasAuth = (src) =>
  /verifyToken|verifyIdToken|tokenFrom|CRON_SECRET|x-internal-key|INTERNAL_API_KEY|constructEvent/.test(src);

let bad = [], checked = 0;
for (const f of fs.readdirSync(API).filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(API, f), 'utf8');
  checked++;
  if (ALLOW[f]) continue;
  if (hasAuth(src)) continue;

  // does it pull an identity field out of the body?
  const hits = IDENTITY.filter(k => {
    const destructure = new RegExp(`\\{[^}]*\\b${k}\\b[^}]*\\}\\s*=\\s*req\\.body`);
    const direct = new RegExp(`req\\.body(?:\\?\\.|\\.)${k}\\b`);
    return destructure.test(src) || direct.test(src);
  });
  if (hits.length) bad.push({ file: f, fields: hits });
}

console.log('\nEndpoints take identity from a verified token, not the body\n' + '─'.repeat(64));
if (bad.length) {
  for (const b of bad) {
    console.log(`  ✗ api/${b.file}`);
    console.log(`      reads ${b.fields.map(f => `"${f}"`).join(', ')} from req.body with no token verification`);
    console.log(`      Fix: derive it from verifyToken(tokenFrom(req)), or add it to ALLOW with a reason.`);
  }
  console.log(`\n${bad.length} endpoint(s) trust caller-supplied identity.`);
  console.log('An attacker picks that value. CORS does not stop them — it only constrains browsers.');
  process.exit(1);
}
console.log(`  ✓ ${checked} endpoints checked, none trust a body-supplied identity`);
console.log(`  · ${Object.keys(ALLOW).length} allowlisted with reasons: ${Object.keys(ALLOW).join(', ')}`);
