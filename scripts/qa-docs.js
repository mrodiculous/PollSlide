#!/usr/bin/env node
/* PollSlide QA — the runbooks still describe the real system.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * STRIPE-GO-LIVE.md was confidently, specifically wrong in three ways at once, and
 * every one of them was caught by the owner rather than by us:
 *
 *   1. It told you to create ten prices and then said "copy the amounts from your
 *      pricing page" — punting on the only numbers in the document that take money.
 *   2. `STRIPE_AUTOMATIC_TAX` and `STRIPE_COLLECT_CONSENT` had been in the code for
 *      months. Neither appeared in the guide. Following it exactly took you live
 *      collecting no VAT and recording no consent.
 *   3. It described a "Test mode toggle" Stripe had replaced with sandboxes.
 *
 * A runbook is executed once, under pressure, by someone who trusts it. Wrong is worse
 * than missing: missing makes you look it up, wrong makes you act. So the checkable
 * claims are now checked on every run.
 *
 * WHAT THIS CANNOT DO: it cannot know whether Stripe renamed a menu. It checks the
 * things that are knowable from this repo — amounts, keys, events, env vars, files,
 * icon sizes — and leaves prose to review.
 *
 *   node scripts/qa-docs.js
 * --------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.resolve(ROOT, '..', 'pollslide-website');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

let fail = 0, checks = 0;
const problems = [];
/* Things that are correct today but must change at a known future moment. Reported,
   never fatal — a gate that cries wolf daily is a gate everyone learns to skip. */
const pending = [];
const ok = (cond, msg, detail) => {
  checks++;
  if (!cond) { fail++; problems.push(detail ? `${msg}\n      ${detail}` : msg); }
};

console.log('\nRunbooks still describe the real system\n' + '─'.repeat(64));

// ── 1. Stripe prices in the runbook match the live pricing page ───────────────
const guide  = read(path.join(ROOT, 'STRIPE-GO-LIVE.md'));
const pricing = read(path.join(SITE, 'pricing.html'));

if (!guide) {
  ok(false, 'STRIPE-GO-LIVE.md is missing — TODO.md tells the owner to follow it');
} else if (!pricing) {
  console.log('  – pricing.html not reachable; skipping the amount cross-check');
} else {
  /* `mo` is the monthly price. `yr` is the price per month WHEN BILLED ANNUALLY —
     which is NOT what Stripe wants. Stripe charges once a year, so the annual price
     is yr × 12. Getting this wrong bills an annual customer the monthly rate forever
     with no commitment, and nothing in the product looks broken. */
  const plans = [...pricing.matchAll(/name:'([^']+)',[\s\S]*?mo:(\d+), yr:(\d+)/g)]
    .map(m => ({ name: m[1], mo: +m[2], yr: +m[3] }))
    .filter(p => p.mo > 0);

  ok(plans.length >= 3, `expected at least 3 paid plans on the pricing page, found ${plans.length}`);

  const money = (n) => '$' + n.toLocaleString('en-US') + '.00';
  for (const p of plans) {
    ok(guide.includes(money(p.mo)),
       `${p.name} monthly price is not in STRIPE-GO-LIVE.md`,
       `pricing page says ${money(p.mo)} — the runbook must state it so it can be pasted into Stripe`);
    ok(guide.includes(money(p.yr * 12)),
       `${p.name} ANNUAL total is not in STRIPE-GO-LIVE.md`,
       `page advertises ${money(p.yr)}/mo billed annually, so Stripe needs ${money(p.yr * 12)} per YEAR`);
    // The per-month annual figure must never be presented as the Stripe amount.
    const asStripeAmount = new RegExp('\\*\\*\\' + money(p.yr) + '\\*\\* / year');
    ok(!asStripeAmount.test(guide),
       `${p.name}: the runbook offers ${money(p.yr)} as a YEARLY Stripe amount`,
       'that is the per-month advertised figure; the yearly total is 12× that');
  }

  // Credit packs, read from the pricing page's own markup.
  const credits = [...pricing.matchAll(/>(\d+)<[\s\S]{0,80}?credits<[\s\S]{0,140}?\$(\d+)</g)]
    .map(m => ({ n: +m[1], usd: +m[2] }));
  ok(credits.length >= 4, `expected 4 credit packs on the pricing page, found ${credits.length}`);
  for (const c of credits) {
    ok(guide.includes('$' + c.usd + '.00'),
       `the ${c.n}-credit pack price is not in STRIPE-GO-LIVE.md`,
       `pricing page says $${c.usd}`);
  }
}

// ── 2. Every lookup key and webhook event in the guide exists in the code ─────
const checkout = read(path.join(ROOT, 'api', 'create-checkout.js')) || '';
const webhook  = read(path.join(ROOT, 'api', 'stripe-webhook.js')) || '';
const apiAll   = checkout + webhook;

if (guide) {
  const keysInGuide = [...new Set([...guide.matchAll(/`(pollslide_[a-z0-9_]+)`/g)].map(m => m[1]))];
  ok(keysInGuide.length >= 10, `expected 10 lookup keys in the runbook, found ${keysInGuide.length}`);
  for (const k of keysInGuide) {
    ok(apiAll.includes(k.replace(/^pollslide_/, '')) || apiAll.includes(k),
       `lookup key \`${k}\` is in the runbook but nothing in api/ refers to it`);
  }

  const eventsInCode = [...new Set([...webhook.matchAll(/case '([a-z_]+\.[a-z_.]+)'/g)].map(m => m[1]))];
  for (const e of eventsInCode) {
    ok(guide.includes(e),
       `webhook event \`${e}\` is handled in code but not listed in the runbook`,
       'the owner will not subscribe to it in Stripe, so that path silently never fires');
  }
  const eventsInGuide = [...new Set([...guide.matchAll(/^(customer\.[a-z.]+|checkout\.[a-z.]+|invoice\.[a-z._]+)$/gm)].map(m => m[1]))];
  for (const e of eventsInGuide) {
    ok(eventsInCode.includes(e),
       `the runbook says to subscribe to \`${e}\`, but no handler exists for it`);
  }

  /* THE ONE THAT WAS ACTUALLY MISSED. Any STRIPE_* variable the code reads must be
     explained somewhere in the runbook, or it silently defaults to off in production. */
  const envInCode = [...new Set([...apiAll.matchAll(/process\.env\.(STRIPE_[A-Z_]+)/g)].map(m => m[1]))];
  for (const v of envInCode) {
    ok(guide.includes(v),
       `\`${v}\` is read by api/ but never mentioned in STRIPE-GO-LIVE.md`,
       'an unmentioned env var is an unset env var: the feature is off in production and nobody knows');
  }
}

// ── 3. Documents that other documents promise ────────────────────────────────
const todo = read(path.join(ROOT, 'TODO.md')) || '';
for (const m of todo.matchAll(/`([A-Z][A-Z0-9-]+\.md)`/g)) {
  ok(fs.existsSync(path.join(ROOT, m[1])),
     `TODO.md tells the owner to follow \`${m[1]}\`, which does not exist`);
}

// ── 4. The Office add-in manifest matches reality ────────────────────────────
const manifest = read(path.join(ROOT, 'powerpoint-manifest.xml'));
if (manifest) {
  const attr = (tag) => (new RegExp(`<${tag}[^>]*DefaultValue="([^"]+)"`).exec(manifest) || [])[1];
  const iconSizes = { IconUrl: 32, HighResolutionIconUrl: 64 };
  for (const [tag, size] of Object.entries(iconSizes)) {
    const url = attr(tag);
    ok(!!url, `manifest has no ${tag}`);
    if (!url) continue;
    const file = path.join(SITE, url.replace(/^https?:\/\/[^/]+\//, ''));
    ok(fs.existsSync(file), `${tag} points at ${url}, which is not in the website repo`,
       'AppSource fetches this during review; a 404 fails the submission');
  }
  // AppSource requires a 300x300 store logo, which lives only in the website repo.
  ok(fs.existsSync(path.join(SITE, 'icon-300.png')),
     'icon-300.png is missing — AppSource requires a 300×300 store logo');

  /* A support URL that says the product is "coming soon" reads, to a reviewer, as
     "the thing you are reviewing does not exist" — and fails the submission.

     But it is also TRUE until the day you submit, so failing the build on it every day
     until then would just train everyone to ignore this gate. The check is therefore
     gated on the submission status recorded in APPSOURCE-SUBMISSION.md: informational
     while `not-submitted`, hard failure once it says `submitted`. */
  const submission = read(path.join(ROOT, 'APPSOURCE-SUBMISSION.md')) || '';
  const statusLine = /SUBMISSION-STATUS:\s*(\S+)/.exec(submission);
  const submitted = statusLine && statusLine[1] === 'submitted';

  const support = attr('SupportUrl') || '';
  const supportFile = path.join(SITE, (support.split('#')[0] || '').replace(/^https?:\/\/[^/]+\//, '') || 'x');
  const supportHtml = read(supportFile) || read(supportFile + '.html') || '';
  if (supportHtml) {
    const saysComingSoon = /add-in is coming soon|add-in.{0,40}coming soon/i.test(supportHtml);
    if (submitted) {
      ok(!saysComingSoon,
         `SUBMITTED, but the SupportUrl (${support}) still says the add-in is "coming soon"`,
         'a reviewer reads that as "this product does not exist" — see step 10 of APPSOURCE-SUBMISSION.md');
    } else if (saysComingSoon) {
      pending.push(`the SupportUrl (${support}) says "coming soon" — correct for now, but it must` +
                   '\n      change before you submit. Set SUBMISSION-STATUS: submitted and this becomes a hard check.');
    }
  }
  ok(/<Version>\d+\.\d+\.\d+\.\d+<\/Version>/.test(manifest),
     'manifest Version must be four numbers, e.g. 1.0.0.0');

  /* Partner Center compares the listing name against <DisplayName> and fails
     certification when they differ — by a word, a dash, or a trailing space. They live in
     two files that are edited months apart, which is exactly how they drift. */
  const display = attr('DisplayName');
  const doc = read(path.join(ROOT, 'APPSOURCE-SUBMISSION.md')) || '';
  const listed = (/\|\s*Name\s*\|\s*50\s*\|\s*`([^`]+)`/.exec(doc) || [])[1];
  if (display && listed) {
    ok(display === listed,
       'the AppSource listing name and the manifest DisplayName must be identical' +
       `\n      manifest: ${JSON.stringify(display)}` +
       `\n      doc:      ${JSON.stringify(listed)}` +
       '\n      Microsoft fails certification on any difference between them.');
    ok(display.length <= 50, `the listing name is ${display.length} chars; AppSource caps it at 50`);
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (!fail) console.log(`  ✓ ${checks} checks — prices, keys, events, env vars, docs and manifest all agree`);
else problems.forEach(p => console.log('  ✗ ' + p));
if (pending.length) {
  console.log('');
  pending.forEach(p => console.log('  ⏳ ' + p));
}
console.log('─'.repeat(64));

if (fail) {
  console.log(`\n${fail} of ${checks} checks failed.\n\n` +
    'A runbook is executed once, under pressure, by someone who trusts it.\n' +
    'Wrong is worse than missing: missing makes them look it up, wrong makes them act.\n');
  process.exit(1);
}
console.log('\nEvery checkable claim in the runbooks matches the code.\n');
process.exit(0);
