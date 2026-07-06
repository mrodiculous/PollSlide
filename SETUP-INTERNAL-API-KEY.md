# Set up INTERNAL_API_KEY — step by step

**What this is:** a secret password that PollSlide's own servers use to talk to
each other. Without it, the system emails (receipts, team invites, payment
warnings, status alerts) are silently skipped. It takes about 3 minutes.

**Do this BEFORE (or right when) you deploy the latest code.**

---

## Step 1 — Create the secret key

1. Open the **Terminal** app on your Mac (press `Cmd + Space`, type
   `Terminal`, press Enter).
2. Copy this line, paste it into Terminal, and press Enter:

   ```
   openssl rand -hex 32
   ```

3. Terminal prints a long random string of letters and numbers, something
   like `f3a91c...` (64 characters). **That's your key.**
4. Select the whole string with your mouse and copy it (`Cmd + C`).
   Keep this Terminal window open until Step 2 is done.

> Don't share this string, don't put it in the code, and don't reuse a
> password. If it ever leaks, just repeat these steps to make a new one.

## Step 2 — Add the key to Vercel

1. Go to **https://vercel.com** and log in.
2. Click your **PollSlide app project** (the one that deploys
   `app.pollslide.com` — not the marketing site).
3. Click **Settings** (top menu).
4. Click **Environment Variables** (left sidebar).
5. Click **Add New** (or the "Create new" form at the top) and fill in:
   - **Key** (the name): `INTERNAL_API_KEY`
     (exactly like that — all caps, underscores, no spaces)
   - **Value:** paste the long string you copied in Step 1 (`Cmd + V`)
   - **Environments:** leave all three checked (Production, Preview,
     Development)
6. Click **Save**.

## Step 3 — Redeploy so the key takes effect

Environment variables only apply to NEW deployments, so:

1. Still in Vercel, click the **Deployments** tab.
2. On the top (most recent) deployment, click the **⋯** menu on the right.
3. Click **Redeploy**, then confirm **Redeploy** in the dialog.
4. Wait until it says **Ready** (usually under a minute).

*(If you're about to `git push` the latest code anyway, that push IS the
redeploy — you can skip this step.)*

## Step 4 — Check that it worked

1. Open **https://app.pollslide.com/admin** and sign in.
2. Click **Security** in the left sidebar (under "Ops").
3. The scan runs automatically. You want to see:
   - ✅ **No high-severity issue about INTERNAL_API_KEY** — it's working.
   - ❌ If you still see "INTERNAL_API_KEY is not set", the redeploy in
     Step 3 hasn't finished or the variable name has a typo — check
     Step 2 line by line.

## What uses this key (for reference)

| Caller | What it sends |
|---|---|
| `api/stripe-webhook.js` | upgrade confirmations, receipts, payment-failed, downgrade notices |
| `api/team.js` | team invite emails |
| `api/legal-watch.js` | weekly legal/policy-change alerts to you |
| `api/status.js` | "component went down" alerts to you |

They all call `/api/send-email` with the key in an `x-internal-key` header;
`api/send-email.js` refuses anything without the key or a signed-in user's
token. All of these are best-effort: if the key is missing nothing crashes —
the emails just quietly don't send, which is why Step 4 matters.
