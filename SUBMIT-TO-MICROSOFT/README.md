# Submit PollSlide LIVE to Microsoft — the one guide

**Everything you need is in this folder.** Follow the steps top to bottom. Every box you
fill in Partner Center has a matching file in `copy-paste/` — open it, copy all, paste.

We are submitting **only the in-slide add-in, "PollSlide LIVE"** (a PowerPoint *content*
add-in: it sits on the slide and keeps showing live results during the slide show). The
sidebar/task-pane add-in is parked and is **not** part of this submission — don't touch
its old "PollSlide for Powerpoint" offer in Partner Center.

| In this folder | What it's for |
|---|---|
| `manifest.xml` | The file you upload (Step 5). Identical to `powerpoint-content/manifest.xml` — a test keeps them the same. |
| `copy-paste/1-name.txt` … `6-notes-for-certification.txt` | Exact text for each Partner Center box |
| `screenshots/01-live.png` … `04-first.png` | The 4 listing images — 1366×768 PNG, under 1 MB each, as Microsoft requires |
| `logo-300x300.png` | The store logo (Microsoft accepts 216–350 px square PNG) |

**Company:** PollSlide Technologies LLC (US, Wyoming). **Support:** help@pollslide.com.
**Reviewer test account:** appsource-review@pollslide.com / 12345678

---

## Step 1 — Before Partner Center (15 min)

1. **Deploy.** Push the app and website repos and wait for Vercel. Microsoft tests the
   *live* pages.
2. **Run Admin → Launch checks → "Check the reviewer account".** Every line must be ✅:
   the account exists, it has a presentation named exactly **Reviewer Demo**, with a
   session code and at least two questions including a multiple-choice one. If anything is
   ❌, it tells you what to fix.
3. **Open these four links** — each must load:
   - https://app.pollslide.com/powerpoint-content (a sign-in box — correct outside PowerPoint)
   - https://pollslide.com/powerpoint-live (the help & support page for this add-in)
   - https://pollslide.com/privacy
   - https://pollslide.com/terms
4. **Try it yourself once in PowerPoint on the web** (office.com → PowerPoint → blank
   presentation):
   - **Insert → Add-ins → Upload My Add-in** → choose `manifest.xml` from this folder
   - It lands **on the slide**. Click it → sign in as the reviewer → **Reviewer Demo** →
     a multiple-choice question
   - In another tab, open app.pollslide.com/presenter (same reviewer login) → Reviewer
     Demo → that question's live view → open the answer link and vote → the bars on the
     slide move
   - Press **Slide Show** → the results are still there and still update

   If any of this fails, stop and send me what you saw.

## Step 2 — Create the offer (5 min)

1. Go to **https://partner.microsoft.com/dashboard** and sign in with the account that owns
   the PollSlide publisher profile.
2. Left menu → **Marketplace offers** → **+ New offer** → **Office add-in**.
3. **Name / reserve name:** paste `copy-paste/1-name.txt`
   → `PollSlide LIVE — Results on Your Slide`
   It must match the manifest **exactly** — copy it, don't type it (the long dash "—"
   matters).
4. Create.

## Step 3 — Properties / Product setup (3 min)

- **Categories:** Productivity (first), Education (second).
- **Legal:** Privacy policy URL `https://pollslide.com/privacy`; for terms choose
  **your own terms** → `https://pollslide.com/terms`.
- **If asked whether the product needs an account or an additional purchase:** say it
  needs a PollSlide account and that **additional purchase may be required** (there are
  optional paid plans). Leave the free-account wording in the description as it is.
- **Save draft.**

## Step 4 — Marketplace listing (10 min)

Language: **English (United States)**.

| Partner Center box | Paste from | Limit |
|---|---|---|
| Name | `copy-paste/1-name.txt` | 50 characters — ours is 38 |
| Summary (search results) | `copy-paste/2-summary.txt` | 100 characters — ours is 88 |
| Description | `copy-paste/3-description.txt` | ours is ~1,500 |
| Search keywords | `copy-paste/4-keywords.txt` (one per box) | |
| Help / support link | `https://pollslide.com/powerpoint-live` | |
| Privacy policy | `https://pollslide.com/privacy` | |
| Support email | `help@pollslide.com` | |
| Logo | `logo-300x300.png` | 216–350 px square PNG |
| Screenshots | `screenshots/01-live.png`, `02-show.png`, `03-cloud.png`, `04-first.png` | 1366×768, ≤1 MB, 1–5 images |

Video: optional — leave empty. **Save draft.**

## Step 5 — Technical configuration (2 min)

1. Upload **`manifest.xml`** from this folder.
2. Wait for it to validate. It was checked on 2026-09-26: valid XML, a unique Id
   (`6a2cf181-7fbf-4d5e-8dfc-690b55082599`, never used before), icons exactly 32×32 and
   64×64, every URL live, description 245/250 characters, size within Office's limits.
3. **Save draft.**

## Step 6 — Availability (2 min)

- **Markets:** all (or at least the United States).
- **Visibility:** public.
- **iOS / iPad / Android availability: leave it OFF.** Microsoft doesn't allow anything on
  iOS or Android that can lead to a purchase, and the sign-in screen links to account
  sign-up where paid plans exist. Keeping mobile off avoids that whole rule.
- **Save draft.**

## Step 7 — Notes for certification (2 min) — the most important box

Find the free-text box for the certification team (called **Notes for certification**,
**Supplemental content** or **How to test**). Paste **all** of
`copy-paste/6-notes-for-certification.txt`. **Save**, then reopen the page to make sure it
kept the text.

## Step 8 — Submit

1. **Review and publish** — every section must say **Complete**.
2. Re-check three things: the name matches the manifest exactly, the support link is
   `pollslide.com/powerpoint-live`, and the certification notes are there.
3. **Publish.** You'll get an email; the status becomes **In review**.

**While it's in review, don't change the add-in or its help page** — the reviewer tests
what is live.

---

## What Microsoft checks — and how we meet each rule

| Microsoft's requirement | How PollSlide LIVE meets it |
|---|---|
| The add-in explains its value before asking to sign in (policy 1100.1.5) | The first screen says "Put live results on this slide" and what it does, before the sign-in fields |
| If an account is needed, say how to get one; enterprise-only add-ins must say so (1100.5.7.3) | "No account? Create one free … no enterprise purchase or admin setup" on the first screen, in the manifest, the listing and the notes |
| A working test account for the reviewer | appsource-review@pollslide.com with "Reviewer Demo" — checked by Admin → Launch checks |
| Store name = manifest name, exactly | Both are `PollSlide LIVE — Results on Your Slide` |
| Name: no Microsoft product name, no "free", title case | ✓ |
| Summary ≤ 100 characters | 88 |
| Support link is about this add-in and works | pollslide.com/powerpoint-live — the add-in's own help page |
| Privacy policy and terms reachable | ✓ both live |
| Icons exactly 32×32 and 64×64 | ✓ checked |
| Screenshots 1366×768, ≤1 MB, show the real add-in, one message each, no unrelated Office UI | ✓ captured from the add-in's own code |
| Works as described on the platforms offered | Tested on the web; mobile left off |
| Paid plans declared | Step 3 |
| No purchase path on iOS/Android | Mobile availability off (Step 6) |

## After you press Publish

| Stage | Typical time |
|---|---|
| Automated checks (manifest, links, icons) | minutes to an hour |
| Human review | 2–5 business days |
| A final **Go live** button for you — watch your email | you |
| Live in the store | a few hours after |

**If it's rejected:** download the report (it usually includes screenshots of what the
reviewer saw) and send me the text. If a rule we already meet is cited, the likeliest cause
is that something wasn't live when they tested — re-run Step 1.

**The day it's approved:**
- Change `pollslide.com/pollslide-for-powerpoint` — it still says the add-in "isn't
  available to install yet" — and link it to the store listing and `/powerpoint-live`.
- Mark the PowerPoint add-in "Available" on `pollslide.com/integrations`.
- Add `/powerpoint-live` to the sitemap.
