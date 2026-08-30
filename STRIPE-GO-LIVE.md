# Stripe Go-Live — PollSlide

Everything needed to take real payments, in order, with the exact values to paste.
The code is already written and deployed. This is configuration only.

- **Time:** ~10 minutes of clicking, plus Stripe's business verification (not instant — start that first)
- **You need:** Stripe dashboard access, Vercel access
- **Already confirmed working in production:** `STRIPE_SECRET_KEY` is set, `STRIPE_WEBHOOK_SECRET` is set,
  Firebase Admin is set, email delivery is up, and there are no real runtime errors.

---

## The one thing to understand first

Stripe keeps **test mode** and **live mode** completely separate. Products, prices,
API keys and webhook endpoints do **not** carry over between them. Everything below is
you rebuilding, in live mode, what already exists in test.

---

## Step 1 — Business details and bank account

**Stripe → Settings → Business**

Fill in business details, tax information, identity verification and the bank account
that receives payouts.

Do this first. Stripe's verification is not instant, and everything else here takes
ten minutes. There is no point being blocked on this at the end.

**Done when:** Stripe stops showing the "complete your profile to accept live payments" banner.

---

## Step 2 — Switch out of test mode

**Stripe Dashboard → the Test mode toggle, top right → off**

**Done when:** the orange *Test mode* banner is gone.

---

## Step 3 — Recreate all ten prices, with the same lookup keys

**Stripe → Product catalogue → Add product**

PollSlide never refers to a Stripe price ID. It asks Stripe for the price carrying a
given **lookup key**. These must match exactly — character for character.

| Product | Billing | Lookup key |
|---|---|---|
| Pro | Monthly | `pollslide_pro_monthly` |
| Pro | Annual | `pollslide_pro_annual` |
| Team Small | Monthly | `pollslide_team_small_monthly` |
| Team Small | Annual | `pollslide_team_small_annual` |
| Team Large | Monthly | `pollslide_team_large_monthly` |
| Team Large | Annual | `pollslide_team_large_annual` |
| 20 Polly credits | One-time | `pollslide_credits_20` |
| 100 Polly credits | One-time | `pollslide_credits_100` |
| 200 Polly credits | One-time | `pollslide_credits_200` |
| 500 Polly credits | One-time | `pollslide_credits_500` |

Copy the amounts from your own pricing page (https://pollslide.com/pricing) so the two
never disagree.

**Two traps:**

- The lookup key field is on the **price**, not the product. Add the price, open it,
  look for "Lookup key" — on some screens it is behind **Advanced**.
- The six plans must be **recurring**. The four credit packs must be **one-time**.
  A credit pack created as recurring will bill someone every month forever for a
  one-off purchase.

**Done when:** ten prices exist, each showing its lookup key.

---

## Step 4 — Swap in the live secret key

**Stripe → Developers → API keys** — copy the **Secret key** (starts `sk_live_`)

**Vercel → poll-slide → Settings → Environment Variables**

```
STRIPE_SECRET_KEY = sk_live_…
```

Never the publishable key (`pk_…`). Never paste a secret key anywhere but Vercel.

---

## Step 5 — Create a live webhook endpoint

**Stripe → Developers → Webhooks → Add endpoint**

```
Endpoint URL
https://app.pollslide.com/api/stripe-webhook

Events to send
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
invoice.payment_failed
invoice.payment_succeeded
```

Then click **Reveal** under Signing secret and put it in Vercel:

```
STRIPE_WEBHOOK_SECRET = whsec_…
```

**This secret is different in live mode.** Getting it wrong is the single most common
go-live failure, and it fails silently: Stripe charges the card, PollSlide rejects the
signature, and the plan never changes.

---

## Step 6 — Redeploy

**Vercel → Deployments → the top production deployment → ⋯ → Redeploy**

Environment variables do not apply to deployments that already exist. Until you
redeploy, none of the above is live.

If checkout later says "STRIPE_SECRET_KEY not set" after you have clearly set it,
this is the step that was missed.

---

## Step 7 — Buy something with a real card, then refund yourself

This is the only proof the live webhook secret is correct. It costs you nothing —
refund it from the Stripe dashboard immediately after.

Then confirm it landed in **three** places:

1. **Stripe → Developers → Events** — the event shows `200` against your endpoint.
   A `400` here means the signature was rejected: wrong secret for this mode.
2. **Admin → Billing / Stripe** — the customer and subscription appear beside
   PollSlide's own record of the plan.
3. **Admin → Users → the account → 🕵️ Account timeline** — a plan row reading
   `stripe-webhook` with the Stripe event id. This is the audit trail that answers
   "why did my plan change?" months later.

Also test **Manage billing** in the app — it opens Stripe's own portal, and a
cancellation there should come back through the webhook and drop the plan.

---

## After go-live

Nothing to configure. Once the live key is in place, Auto-pilot's `tier_drift` check
starts comparing every Stripe-linked account against PollSlide's record every fifteen
minutes.

- If someone paid and is not getting it, **it restores their plan automatically** and
  emails you what it did.
- If someone has **more** than Stripe suggests, it leaves them alone and asks you to
  look. Team members and comped accounts legitimately sit above their own
  subscription, and removing access automatically would be wrong.

Confirm it is running: **Admin → Auto-pilot** should show `tier_drift` as healthy
rather than "not run yet".

---

## If something goes wrong

**Payment succeeded, plan didn't change.**
Almost always the webhook secret. Stripe → Developers → Events → open the event →
read the response. A `400` means the signature was rejected — you are using the test
secret against live mode or the reverse.

**Checkout won't open.**
Open the browser console. `STRIPE_SECRET_KEY not set` means you added the variable but
did not redeploy. `No price found with lookup key` means that key is missing or
misspelt in the mode you are in — check for a stray capital or a hyphen where an
underscore belongs.

**Someone appears to be charged twice, or a plan flipped back.**
Stripe retries any webhook it thinks failed, so the same event can arrive more than
once. `claimStripeEvent()` rejects a repeated event id, and `setUserTier()` does
nothing when the plan already matches — which is also why a redelivery no longer sends
a second "you were upgraded" email. The Account timeline records real changes only:
if there is no row, nothing actually happened.

**You want to see everything at once.**
**Admin → Billing / Stripe** shows estimated MRR, a per-user view of Stripe against
PollSlide's own record, and recent events annotated with whether the webhook claimed
each one. It is read-only by design — refunds and cancellations stay in Stripe, where
they are logged properly.

---

## Final checklist before announcing

- [ ] Business details complete and bank account verified
- [ ] All ten live prices created, lookup keys verified character for character
- [ ] `STRIPE_SECRET_KEY` swapped to `sk_live_…`
- [ ] Live webhook endpoint created, `STRIPE_WEBHOOK_SECRET` swapped
- [ ] Redeployed after both variable changes
- [ ] Bought each of the three plans once, live, and refunded
- [ ] Bought one credit pack — a different code path from subscriptions
- [ ] Cancelled through **Manage billing** and confirmed the plan dropped
- [ ] Upgrade and receipt emails arrive, and read correctly
- [ ] Auto-pilot `tier_drift` has run at least once and is healthy

One thing this guide cannot decide for you: your Terms and refund policy should state
what happens when someone cancels mid-term. That is a business call, and worth
settling before the first customer asks.
