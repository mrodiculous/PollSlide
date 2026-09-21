# Resubmitting PollSlide for PowerPoint — every step

**Product ID:** `6f857b46-01a4-494a-ba1f-8a2cff15d9a1`
**Rejected:** 09/17/2026 · **This guide written:** 09/21/2026
**Offer already exists** — you are editing and resubmitting it, NOT creating a new one.

> **If you read nothing else:** do PART 0 first. Microsoft reviews the code that is *live*
> at the moment they look, not what is in git. Submitting before deploying is the single
> most likely way to get rejected a third time for something you already fixed.

---
---

# PART 0 — Before you open Partner Center

## 0.1 Push the code (5 min)

The add-in fix from this week is committed but **not deployed**. Until it is, the live pane
still has the bug where answers do not register.

```bash
cd ~/Documents/GitHub/PollSlide
git status
git add powerpoint.html powerpoint-manifest.xml scripts/tests/powerpoint-live-cutoff.test.js
git commit -m "PowerPoint add-in: publish live question, fix response cutoff"
git push
```

Then push the website repo too if it shows changes:

```bash
cd ~/Documents/GitHub/pollslide-website
git status
git push
```

Wait for Vercel to finish. Usually 1–2 minutes.

## 0.2 Prove it is actually live (2 min)

Run this. **Every line must print `1` or more.** If any prints `0`, the deploy has not landed
— wait and run it again.

```bash
curl -s https://app.pollslide.com/powerpoint > /tmp/p.html
grep -c "Live audience results" /tmp/p.html
grep -c "No account yet" /tmp/p.html
grep -c "help@pollslide.com" /tmp/p.html
grep -c "publishLive" /tmp/p.html
```

Line 3 matters most: it is the contact address policy 1100.5.7.3 asked for, and Cloudflare
used to mangle it into `[email protected]`.

## 0.3 Sign in as the reviewer, yourself (5 min) ⚠️

**This is the #1 cause of a second rejection.** The reviewer will not debug your login.

1. Open a **private/incognito** window (so you are not using your own session)
2. Go to `https://app.pollslide.com/presenter`
3. Sign in with **exactly** `appsource-review@pollslide.com` / `12345678`
4. Confirm a presentation named **"Reviewer Demo"** exists and has at least one question

If any of that fails, fix it now. The deck and the notes both tell the reviewer to use that
account and pick that deck **by name**.

## 0.4 Run the reviewer's own test (10 min) ⚠️

Do literally what slide 11 tells them to do. PowerPoint **on the web** is easiest — Mac
desktop sideloading is flaky and not worth fighting.

1. Go to `office.com` → **PowerPoint** → new blank presentation
2. **Home** tab → **Add-ins** → **More Add-ins** → **My Add-ins** tab → **Upload My Add-in**
3. Choose `~/Documents/GitHub/PollSlide/powerpoint-manifest.xml`
4. The **PollSlide** group appears on the Home tab → click **Live Results**
5. **Look at the panel before signing in.** You must see, without scrolling:
   - the headline "Live audience results, right on your slides"
   - three ticked benefit lines
   - "No account yet? Create one free"
   - a readable `help@pollslide.com` (NOT `[email protected]`)
6. Sign in with the reviewer account
7. Pick **Reviewer Demo** → a question → **▶ View live**
8. Scan the QR with your phone (or open the link shown under it)
9. Answer on the phone
10. **The task pane must show `1 response` and keep showing it after the reveal countdown**
11. Go back to Polls, pick a **different** question, scan its QR — it must load *that*
    question, not say "you've already answered this"

If step 10 or 11 fails, stop and tell me. Do not submit.

## 0.5 Export the deck to PDF (2 min)

1. Open `~/Documents/GitHub/PollSlide/PollSlide-PowerPoint-AppSource-Submission.pptx`
2. Check slide 10 (Appsource Listing) — the long description is dense; confirm it is not
   awkwardly shrunk
3. **File → Export To → PDF**, overwrite
   `~/Documents/GitHub/PollSlide/PollSlide-PowerPoint-AppSource-Submission.pdf`
4. Commit both files

---
---

# PART 1 — Get into Partner Center

1. Go to **https://partner.microsoft.com/dashboard**
2. Sign in with the Microsoft account that owns the PollSlide.com publisher profile
3. Left sidebar → **Marketplace offers**
4. You will see a list of offers. Click **PollSlide for Powerpoint**

If you land somewhere unfamiliar, this direct link goes straight to the offer:
`https://partner.microsoft.com/dashboard/v2/marketplace-offers/office/products/6f857b46-01a4-494a-ba1f-8a2cff15d9a1/overview`

**You should see a banner saying the last submission needs attention.** That is expected.

---

# PART 2 — Start the new submission

Partner Center keeps your previous answers. You are editing a draft, not starting over.

1. On the offer **Overview** page, look for **Update** / **Edit** / **New submission**
   (Microsoft renames this button periodically — it is the one that reopens the offer for
   editing)
2. The left-hand checklist appears: Offer setup, Properties, Offer listing, Availability,
   Technical configuration, Test drive (if shown), Review and publish

> ⚠️ **Do NOT create a new offer.** A second offer means a second listing, a different
> Product ID, and anyone who already has the add-in never gets the update.

---

# PART 3 — Technical configuration (the manifest)

**Do this before the listing text** — if the package fails validation you will want to know
early.

1. Left checklist → **Technical configuration** (may be called **Packages**)
2. Remove/replace the existing package
3. Upload: `~/Documents/GitHub/PollSlide/powerpoint-manifest.xml`

   ⚠️ **Use the repo copy.** There is an older copy under
   `~/Downloads/PollSlide/AppSource-Assets/` that older notes point at. I have just synced it,
   but the repo is the source of truth — if they ever disagree again, the repo wins.

4. Wait for it to validate. It should pass — the XML, all 8 URLs, and both icon sizes
   (32×32 and 64×64) were verified on 09/21.
5. **Save draft**

**What changed in this manifest since the rejection:**

| Field | Now | Why |
|---|---|---|
| `Version` | `1.0.1.0` | bumped from 1.0.0.0 so the new package is unambiguous |
| `Id` | **unchanged** | changing it would create a second listing |
| `Description` | states free individual accounts | answers 1100.5.7.3 |
| `SupportUrl` | `/pollslide-for-powerpoint` | was `/setup`, the Mac companion guide |
| `GetStarted.LearnMoreUrl` | `/pollslide-for-powerpoint` | same reason |

---

# PART 4 — Offer listing (the text)

Left checklist → **Offer listing**. Change these four fields; leave everything else.

### 4.1 Name  ⚠️
```
PollSlide for PowerPoint
```
This must match the manifest `<DisplayName>` **character for character**, including the
capital **P** in PowerPoint. A mismatch fails certification on its own.

### 4.2 Summary / short description
```
Run live polls, quizzes and surveys inside PowerPoint. Your audience answers on any phone by scanning a QR code — no app, no account. Results update on your slide as they come in. Free individual accounts — no enterprise purchase or admin setup required.
```

### 4.3 Description (long)
```
PollSlide turns a PowerPoint deck into a two-way conversation. Insert a poll, quiz or survey into your slides. Your audience scans a QR code or types a short code at pollslide.com/join — nothing to install, no account to create, works on any phone. Answers arrive live and the results update on your slide while you present.

What you can do
• Live polls, multiple-choice quizzes, open text, word clouds and rating scales
• Show live results as they arrive, or only who has responded, so answers stay independent until your reveal
• Score quizzes automatically, with a leaderboard and a reveal
• Insert a QR code straight onto any slide
• Works in PowerPoint on Windows, Mac and the web

Getting an account
PollSlide is available to individuals as well as organisations. Anyone can create a free account at app.pollslide.com/presenter in about a minute — no enterprise purchase, license key or administrator provisioning, and no credit card for the free plan. This is not an enterprise-only add-in.

Who it is for
Teachers checking a class has understood, trainers keeping a room awake, and anyone who has ever asked "any questions?" to silence.
```

The **Getting an account** paragraph is the literal thing policy 1100.5.7.3 asked for. Do not
drop it.

### 4.4 Help / Support URL  ⚠️
```
https://pollslide.com/pollslide-for-powerpoint
```
Change from `https://pollslide.com/setup`. A reviewer clicks this. `/setup` is the **Mac
companion** guide and mentions the add-in as not yet available — which reads as "the product
you are reviewing does not exist."

Leave privacy URL as `https://pollslide.com/privacy` and support contact as
`help@pollslide.com`.

**Save draft.**

---

# PART 5 — Notes for certification  ⚠️ THE MOST IMPORTANT BOX

Find the free-text field for the certification/validation team. Depending on the page it is
called **Notes for certification**, **Supplemental content**, or **How to test your add-in**.
It is usually on **Availability** or the last page before Review.

**Paste this verbatim:**

```
Re: certification report of 09/17/2026 for Product ID 6f857b46-01a4-494a-ba1f-8a2cff15d9a1.

Both cited items are addressed. No functional changes were made — this submission adds
first-run explanatory content, account-acquisition guidance and support contact details.
The manifest Id is unchanged; Version is bumped to 1.0.1.0.

1100.1.5 — First run experience
The task pane now opens on a value panel before any credentials are requested: a one-line
statement of what the add-in does, three concrete benefit lines, and the value proposition
visible without scrolling at the default task-pane width. Sign-in sits below it.

1100.5.7.3 — Enterprise account information
PollSlide is NOT an enterprise-only add-in. Any individual can self-serve a free account in
about a minute — no enterprise purchase, license key or administrator provisioning, and no
credit card for the free plan. The first-run screen states this explicitly and links directly
to account creation. The manifest description and the store listing description say the same.
Support contact (help@pollslide.com) and a setup guide are both shown on the first-run screen.

TEST ACCOUNT
  Email:    appsource-review@pollslide.com
  Password: 12345678
This account already contains a presentation named "Reviewer Demo" with questions, so
"View live" and "Insert QR" can both be exercised immediately.

HOW TO TEST (about 60 seconds)
1. PowerPoint (Windows, Mac or web) → Home tab → Live Results (PollSlide)
2. Observe the first-run panel BEFORE signing in — value proposition, benefits,
   "No account yet? Create one free", and help@pollslide.com are all visible
3. Sign in with the test account above
4. Choose "Reviewer Demo" → any question → Insert QR
5. Scan the QR with a phone, or open the link shown beneath it, and submit an answer
6. The result appears live in the task pane

Support: help@pollslide.com · https://pollslide.com/pollslide-for-powerpoint
```

---

# PART 6 — Review and publish

1. Left checklist → **Review and publish**
2. Every section must show **Complete**. Anything showing **Incomplete** blocks submission —
   click into it and look for the red field.
3. Read the summary once. Specifically re-check:
   - Name reads `PollSlide for PowerPoint`
   - Support URL reads `pollslide.com/pollslide-for-powerpoint`
   - Package version reads `1.0.1.0`
4. Confirm the certification notes box actually saved your text (it is easy to lose if you
   navigated away without saving)
5. Click **Publish**

You will get a confirmation email. The status becomes **In review**.

---

# PART 7 — What happens next

| Stage | Typical time | What it means |
|---|---|---|
| Automated validation | minutes – 1 hour | manifest, URLs, icons |
| Certification review | 2–5 business days | a human runs your test steps |
| Publisher sign-off | you | sometimes there is a final "go live" button — **watch for it** |
| Live in AppSource | a few hours after sign-off | |

**Do not change the deployed add-in while it is in review.** The reviewer loads
`app.pollslide.com/powerpoint` live. If you push a change mid-review they may see something
different from what you described.

---

# PART 8 — If it is rejected again

1. Download the certification report ZIP — it usually contains **screenshots** of exactly what
   the reviewer saw, which is the fastest way to understand the complaint
2. Note the policy numbers cited
3. Send me the report text and I will work through it

If a policy you already fixed is cited again, the near-certain cause is that the fix was not
live when they looked. Re-run PART 0.2.

---

# PART 9 — The day it is approved

- [ ] Flip the **"Coming soon"** amber pill on `pollslide.com/integrations` to **Available**
      and add the AppSource link (it currently says the add-in is coming soon — true today,
      wrong the moment it ships)
- [ ] Update the FAQ on `pollslide.com/pollslide-for-powerpoint` — it currently says
      "Not yet. A PollSlide add-in built on Office.js has been submitted and is currently in
      review with Microsoft"
- [ ] Add the AppSource badge/link to the download and pricing pages
- [ ] Tell existing users

---

# Appendix A — Quick checklist

```
[ ] 0.1  code pushed
[ ] 0.2  live check — all four greps return ≥1
[ ] 0.3  reviewer account signs in (incognito)
[ ] 0.4  full add-in test passes, incl. second question
[ ] 0.5  deck exported to PDF and committed
[ ] 3    manifest uploaded from the REPO, validates, version 1.0.1.0
[ ] 4.1  name = PollSlide for PowerPoint (capital P)
[ ] 4.2  short description includes the free-accounts line
[ ] 4.3  long description includes "Getting an account"
[ ] 4.4  support URL = /pollslide-for-powerpoint
[ ] 5    certification notes pasted AND saved
[ ] 6    all sections Complete → Publish
```

# Appendix B — Troubleshooting the manifest upload

| Error | Fix |
|---|---|
| "Icon incorrectly sized" | IconUrl must be exactly 32×32, HighResolutionIconUrl exactly 64×64. Both verified 09/21 — if it still complains, send me the exact text. |
| "URL not reachable" | A page is down. Re-run PART 0.2, then re-upload. |
| "Version must be greater" | Bump `<Version>` again (1.0.2.0). Never touch `<Id>`. |
| "AppDomains" | Already lists app.pollslide.com and pollslide.com. |
| Anything else | Send me the exact error text. |

# Appendix C — Files

| File | What it is |
|---|---|
| `~/Documents/GitHub/PollSlide/powerpoint-manifest.xml` | **the** manifest — upload this one |
| `~/Documents/GitHub/PollSlide/PollSlide-PowerPoint-AppSource-Submission.pptx` | current deck (12 slides) |
| `~/Downloads/PollSlide/APPSOURCE-RESUBMIT-2026-09.md` | shorter summary of what was fixed |
| `~/Downloads/PollSlide/AppSource-Assets/screenshots/` | listing screenshots + logos, if re-uploading media |
| `~/Downloads/PollSlide/AppSource-Assets/THE-GO-BY-…md` | the original FIRST-submission guide. Parts are stale (old name, old support URL) — this document supersedes it. |
