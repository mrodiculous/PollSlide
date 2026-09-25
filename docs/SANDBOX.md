# PollSlide Sandbox — test changes without touching live users

**The rule:** nothing goes to `main` (= app.pollslide.com) until it has been tried on the
sandbox. The sandbox is a full copy of the app running against a *separate* database,
Stripe **test** mode, and no scheduled jobs.

## How it works

| | Production | Sandbox |
|---|---|---|
| URL | app.pollslide.com | staging.pollslide.com (and every Vercel preview URL) |
| Git branch | `main` | `staging` (or any branch → its own preview URL) |
| Database | `echonest-live-survey` | your sandbox Firebase project |
| Payments | Stripe live keys | Stripe **test** keys (card 4242 4242 4242 4242) |
| Cron jobs (watchdog, backups, sweeps) | run | **never run** (Vercel only runs crons on production) |
| Look | normal | yellow **SANDBOX** tag bottom-left |

`ps-env.js` decides this from the hostname. On app.pollslide.com it does nothing at all —
production is byte-for-byte what it was. Anywhere else it points every page at the sandbox
project. **If the sandbox isn't configured, sandbox pages refuse to start** instead of
falling back to live data.

## One-time setup (≈20 minutes, only you can do this)

1. **Create the sandbox Firebase project** — console.firebase.google.com → *Add project* →
   name it `pollslide-sandbox`.
   - Build → **Realtime Database** → Create (same region as live).
   - Build → **Authentication** → Sign-in method → enable **Email/Password** and **Anonymous**.
   - Build → **Storage** → Get started.
   - Realtime Database → Rules → paste the contents of `database-rules.json` → Publish.
2. **Give the web pages its config** — Project settings → *Your apps* → add a Web app →
   copy the config object into the `SANDBOX = { … }` block in **`ps-env.js`**, then run
   `node scripts/qa-assets.js --write` (updates the `?v=` on every page) and commit.
3. **Give the server its keys** — Project settings → Service accounts → *Generate new
   private key*. In **Vercel → Settings → Environment Variables**, add these with **only
   "Preview" ticked** (not Production):
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_URL` → from the sandbox service account
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` → Stripe **test mode** values
   - `INTERNAL_API_KEY` → a *different* random string from production
4. **Give it a stable address** — `git checkout -b staging && git push -u origin staging`,
   then Vercel → Settings → Domains → add `staging.pollslide.com` → assign it to the
   **staging** branch. (Every other branch also gets its own throwaway preview URL.)
5. Create a test account on staging.pollslide.com and add yourself to `ADMIN_EMAILS` if you
   want admin there (sandbox accounts are separate from live ones).

## Everyday workflow

1. Make the change on the `staging` branch (or a feature branch) and push.
2. Try it on staging.pollslide.com — phones can scan sandbox QR codes; they open the
   sandbox answer page, not the live one.
3. Run `node scripts/qa.js` — all gates must pass.
4. Only then merge into `main`. That is the only thing that changes app.pollslide.com.

## Testing locally

`localhost` behaves as production by default (so existing habits don't change). Add
`?sandbox=1` to any local page URL to run it against the sandbox project instead.

## Known limits

- Sandbox and live accounts are separate — sign up again on the sandbox.
- The Mac companion app and the PowerPoint add-in manifest point at app.pollslide.com, so
  they test against production. To test web changes to `companion.html` in the sandbox,
  open `https://staging.pollslide.com/companion#<uid>/<code>/<q>` in a browser.
- **The PowerPoint add-in pages (`powerpoint.html`, `powerpoint-content/index.html`) are
  frozen as submitted to Microsoft and do not load the sandbox switch.** Opened on a staging
  address they still read and write the LIVE database, so don't use them for sandbox tests.
  If the add-in ever needs changes, add `<script src="/ps-env.js?v=…">` after
  `firebase-app-compat.js` in both pages as part of that (re-reviewed) update.
- Emails sent from sandbox code go through the same email provider — only ever to test
  accounts, because the sandbox database only contains test accounts.
