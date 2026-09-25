# ⭐ Microsoft AppSource — the ONE submission guide

**Written 2026-09-25. Start here. This replaces every older guide.** The older files
(`APPSOURCE-SUBMISSION.md`, `RESUBMIT-STEP-BY-STEP.md`, and the ones in
`~/Downloads/PollSlide/`) are history. If they disagree with this file, this file wins.

**Company on the listing:** PollSlide Technologies LLC — a US company, registered in Wyoming.
**Reviewer test account (both add-ins):** `appsource-review@pollslide.com` / `12345678`
**Support email:** `help@pollslide.com`

---

## 0. What you are submitting — two separate products

Microsoft does not let one add-in be both a sidebar and an object on a slide. So PollSlide
has **two add-ins, two offers, two manifests.** Never mix them up.

| | **A. PollSlide for PowerPoint** (task pane) | **B. PollSlide LIVE** (content add-in) |
|---|---|---|
| What it is | Sidebar: pick a question, insert a QR, watch results | Object **on the slide**: live results while presenting |
| Manifest to upload | `powerpoint-manifest.xml` (this folder) | `powerpoint-content/manifest.xml` |
| Page it loads | `https://app.pollslide.com/powerpoint` | `https://app.pollslide.com/powerpoint-content` |
| Add-in Id (never change) | `7b3f9a14-2c5e-4d8a-9f1b-6a2e4c0d8e10` | `6a2cf181-7fbf-4d5e-8dfc-690b55082599` |
| Version in manifest | `1.0.1.0` | `1.0.0.0` |
| Partner Center | **Existing offer** — Product ID `6f857b46-01a4-494a-ba1f-8a2cff15d9a1` (rejected 09/17, fixes are live) | **Brand-new offer** |
| Listing name (must match manifest exactly) | `PollSlide for PowerPoint` | `PollSlide LIVE — results on your slide` |

**Recommended order:** submit **A** now. Read the test report (section 9) before
submitting **B** — there is one issue there that a reviewer on Windows could hit.

---

## 1. Checks already done for you (2026-09-25)

| Check | Result |
|---|---|
| Both manifests are valid XML | ✅ |
| Every URL in both manifests loads (pages, icons, support, privacy, terms) | ✅ all 200 |
| Icons are the exact sizes Microsoft requires (16, 32, 64, 80 px) | ✅ |
| Names and descriptions are within the limits | ✅ 24/38 chars · descriptions 235/250 and 245/250 |
| What is live matches what is in git | ✅ content add-in identical; task pane identical except Cloudflare removing its own hidden marker (the email stays readable) |
| First screen shows what it does, how to get a free account, and support email before sign-in | ✅ task pane · ⚠️ content add-in has no support email on it (see section 9) |
| No console errors on load | ✅ both |
| Results display on the slide: full size, narrow column, reveal state | ✅ |
| Add-in files are unchanged from v253 | ✅ nothing in them was changed this session |

**What I could not do:** sign in as the reviewer. I am not allowed to type passwords, so
**you** must do steps 2.3 and 2.4. They take 10 minutes and they are what the reviewer does.

---

## 2. Before you open Partner Center (20 minutes, do not skip)

### 2.1 Push what you want live, then wait
Microsoft tests the **live** site, not git. Push, wait for Vercel to finish (1–2 minutes).

> ⚠️ **Nothing from today's LoopSlide / sandbox work touches either add-in.** You can push it
> or not. But **do not push anything while a submission is in review** — the reviewer loads
> the live pages and must see what you described.

### 2.2 Prove it is live
Run each line. Every one must print `200` or a number of 1 or more.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://app.pollslide.com/powerpoint
```
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://app.pollslide.com/powerpoint-content
```
```bash
curl -s https://app.pollslide.com/powerpoint | grep -c "help@pollslide.com"
```
```bash
curl -s https://app.pollslide.com/powerpoint-content | grep -c "PollSlide LIVE"
```

### 2.3 Sign in as the reviewer ⚠️ #1 cause of rejection
1. Open a **private/incognito** browser window
2. Go to `https://app.pollslide.com/presenter`
3. Sign in with `appsource-review@pollslide.com` / `12345678`
4. Check a presentation named exactly **Reviewer Demo** exists, has a session code, and has
   at least **one multiple-choice question and one other question type**
5. Open it once in PollSlide (this makes sure it has a session code)
6. Sign out

### 2.4 Do the reviewer's test yourself — PowerPoint on the web
Use **office.com**, not the Mac app (Mac sideloading is unreliable).

**Add-in A (task pane)**
1. office.com → PowerPoint → new blank presentation
2. **Home → Add-ins → More Add-ins → My Add-ins → Upload My Add-in** → `powerpoint-manifest.xml`
3. **Home → Live Results**. Before signing in, check you can see: the headline, three ticks,
   "No account yet? Create one free", and `help@pollslide.com`
4. Sign in → **Reviewer Demo** → a question → **Insert QR** → **View live**
5. Answer on your phone → the pane shows `1 response`
6. Pick a **different** question, scan its QR → the phone must load *that* question

**Add-in B (content add-in)**
1. New blank presentation → **Insert → Add-ins → Upload My Add-in** → `powerpoint-content/manifest.xml`
2. **Insert → Add-ins → My Add-ins → PollSlide LIVE** → it lands **on the slide** as a box
3. Click it → sign in → **Reviewer Demo** → a question
4. Answer on your phone → the bars on the slide move
5. **Slide Show** → the box is still there and still updates → reveal turns the answer green
6. Second slide, second box, different question → present both → each shows its own

**If any step fails, stop and send me the step number.** Do not submit.

---

## 3. Partner Center — get in

1. Go to **https://partner.microsoft.com/dashboard**
2. Sign in with the account that owns the PollSlide publisher profile
3. Left menu → **Marketplace offers**

Publisher details must read: **PollSlide Technologies LLC**, United States, Wyoming address.
Leave it as a US company.

---

## 4. Offer A — resubmit "PollSlide for PowerPoint" (existing offer)

> ⚠️ **Edit the existing offer. Do NOT create a new one.** Direct link:
> `https://partner.microsoft.com/dashboard/v2/marketplace-offers/office/products/6f857b46-01a4-494a-ba1f-8a2cff15d9a1/overview`

### 4.1 Technical configuration (do this first — it validates the package)
1. Remove the old package → upload `~/Documents/GitHub/PollSlide/powerpoint-manifest.xml`
2. Wait for it to validate → check it says version **1.0.1.0** → **Save draft**

### 4.2 Properties
- **Category:** Productivity (primary), Education (secondary)
- **Legal:** your terms — `https://pollslide.com/terms`
- **Privacy policy:** `https://pollslide.com/privacy`
- **Pricing / purchases:** tick **"My product requires the purchase of a service"** /
  **"Additional purchase may be required"** (wording varies). PollSlide has paid plans; not
  declaring that is its own rejection reason (policy 1100.4). The free plan still works, so
  keep the "free individual accounts" wording.
- **Save draft**

### 4.3 Offer listing — copy and paste exactly
**Name**
```
PollSlide for PowerPoint
```
**Summary**
```
Run live polls, quizzes and surveys inside PowerPoint. Your audience answers on any phone by scanning a QR code — no app, no account. Results update on your slide as they come in. Free individual accounts — no enterprise purchase or admin setup required.
```
**Description**
```
PollSlide turns a PowerPoint deck into a two-way conversation. Insert a poll, quiz or survey into your slides. Your audience scans a QR code or types a short code at pollslide.com/join — nothing to install, no account to create, works on any phone. Answers arrive live and the results update while you present.

What you can do
• Live polls, multiple-choice quizzes, open text, word clouds and rating scales
• Show live results as they arrive, or only who has responded, so answers stay independent until your reveal
• Score quizzes automatically, with a leaderboard and a reveal
• Insert a QR code straight onto any slide
• Works in PowerPoint on Windows, Mac and the web

Getting an account
PollSlide is available to individuals as well as organisations. Anyone can create a free account at app.pollslide.com/presenter in about a minute — no enterprise purchase, license key or administrator provisioning, and no credit card for the free plan. Paid plans are optional and add higher limits. This is not an enterprise-only add-in.

Who it is for
Teachers checking a class has understood, trainers keeping a room awake, and anyone who has ever asked "any questions?" to silence.
```
**Search keywords:** `live poll` · `quiz` · `audience response`
**Support URL:** `https://pollslide.com/pollslide-for-powerpoint`
**Privacy URL:** `https://pollslide.com/privacy`
**Support contact:** `help@pollslide.com`

**Media**
- Logo: `~/Downloads/PollSlide/AppSource-Assets/screenshots/listing-logo-300.png` (300×300 PNG)
- Screenshots (1366×768, 1–5): `~/Downloads/PollSlide/AppSource-Assets/screenshots/01…05`
- **Save draft**

### 4.4 Availability
- Markets: **All** (or at least United States) · Visibility: **Public**
- **iPad / iOS / Android: leave OFF.** Microsoft forbids anything on iOS/Android that leads to
  buying (policy 1100.5.3 area), and the first screen links to sign-up, where paid plans
  exist. Switching mobile on invites a rejection for no gain.
- **Save draft**

### 4.5 Notes for certification — paste verbatim ⚠️ most important box
```
Re: certification report of 09/17/2026 for Product ID 6f857b46-01a4-494a-ba1f-8a2cff15d9a1.

Both cited items are addressed. The manifest Id is unchanged; Version is 1.0.1.0.

1100.1.5 — First run experience
The task pane opens on a value panel before any credentials are requested: what the add-in
does, three concrete benefits, sign-up guidance and support contact, visible without
scrolling at the default task-pane width. Sign-in sits below it.

1100.5.7.3 — Account information
PollSlide is NOT an enterprise-only add-in. Any individual can self-serve a free account in
about a minute at app.pollslide.com/presenter — no enterprise purchase, license key or
administrator provisioning, and no credit card for the free plan. Optional paid plans raise
limits. The first-run screen states this and links to sign-up. Support: help@pollslide.com.

TEST ACCOUNT
  Email:    appsource-review@pollslide.com
  Password: 12345678
Contains a presentation named "Reviewer Demo" with questions.

HOW TO TEST (about 60 seconds)
1. PowerPoint (Windows, Mac or web) → Home tab → Live Results (PollSlide group)
2. Before signing in, note the first-run panel: value proposition, benefits,
   "No account yet? Create one free", and help@pollslide.com
3. Sign in with the test account above
4. Choose "Reviewer Demo" → any question → Insert QR, then View live
5. Scan the QR with a phone (or open the link shown under it) and answer
6. The answer appears live in the task pane

Support: help@pollslide.com · https://pollslide.com/pollslide-for-powerpoint
```

### 4.6 Review and publish
1. Every section says **Complete**
2. Re-check: name `PollSlide for PowerPoint` (capital P twice) · support URL
   `/pollslide-for-powerpoint` · package `1.0.1.0` · notes saved
3. **Publish** → status becomes **In review**
4. In `APPSOURCE-SUBMISSION.md`, change `SUBMISSION-STATUS: not-submitted` to `submitted`
   (the QA gate reads it)

---

## 5. Offer B — new offer "PollSlide LIVE" (content add-in)

**Read section 9, issue 1 first.**

1. **Marketplace offers → + New offer → Office Add-in**
2. **Offer ID:** `pollslide-live-powerpoint` (permanent, lowercase) · **Alias:** `PollSlide LIVE — content add-in`
3. **Technical configuration:** upload `~/Documents/GitHub/PollSlide/powerpoint-content/manifest.xml` → validates → Save
4. **Properties:** same as 4.2 (Productivity / Education, terms, privacy, **declare paid plans**)
5. **Listing:**

**Name** — copy it; the long dash must be the real "—", not a hyphen:
```
PollSlide LIVE — results on your slide
```
**Summary**
```
Live poll, quiz and survey results rendered directly on your PowerPoint slide, updating as your audience answers. They respond by QR code from any phone — no app, no account. Free individual accounts, no enterprise purchase or admin setup required.
```
**Description**
```
PollSlide LIVE puts your audience's answers on the slide itself.

Drop the PollSlide LIVE object onto any slide, choose one of your questions, and present. As people answer on their phones, the bars on your slide move in real time. When you reveal, the correct answer turns green and the rest fade back.

It stays on screen while you present. This is a PowerPoint content add-in, so unlike a sidebar it is part of the slide and keeps running in Slide Show.

What you can do
• Put live results on any slide, sized and positioned however you like — full width, or a narrow column beside your content
• Use a different question on every slide
• Live polls, multiple-choice quizzes, word clouds and rating scales
• Automatic scoring and a reveal, with the correct answer highlighted
• Your audience answers by scanning a QR code — nothing to install, no account to create

Getting an account
PollSlide is available to individuals as well as organisations. Anyone can create a free account at app.pollslide.com/presenter in about a minute — no enterprise purchase, license key or administrator provisioning, and no credit card for the free plan. Paid plans are optional and add higher limits. This is not an enterprise-only add-in.

Who it is for
Teachers who want the class to see the room's answer, trainers running a quiz, and anyone presenting to people holding phones.
```
Support / privacy / contact: same as offer A.

6. **Media:** logo as in 4.3. **Screenshots must show the box ON A SLIDE**, not the
   sidebar — the old ones show the wrong product. Take two in step 2.4 (mid-vote and
   revealed) at 1366×768, or ask me to generate them.
7. **Availability:** as 4.4 — **iPad/iOS/Android OFF**
8. **Notes for certification — paste verbatim:**
```
PollSlide LIVE is a PowerPoint CONTENT add-in: it is inserted onto a slide and renders live
audience results there, including during Slide Show. It is a separate product from our
task-pane add-in "PollSlide for PowerPoint" (Id 7b3f9a14-2c5e-4d8a-9f1b-6a2e4c0d8e10).

GETTING AN ACCOUNT
Not enterprise-only. Any individual can self-serve a free account at
app.pollslide.com/presenter in about a minute — no enterprise purchase, license key or
administrator provisioning, no credit card for the free plan. Optional paid plans raise
limits. Support: help@pollslide.com

FIRST RUN
In editing view the object explains what it does and offers sign-in. During Slide Show it
shows results only, with no sign-in prompt — results are readable without an account, and a
login box on a slide in front of an audience would not be usable.

TEST ACCOUNT
  Email:    appsource-review@pollslide.com
  Password: 12345678
Contains a presentation named "Reviewer Demo" with questions.

HOW TO TEST (about 90 seconds) — PowerPoint on the web recommended
1. Insert → Add-ins → My Add-ins → PollSlide LIVE (it is inserted ONTO the slide)
2. Click the object and sign in with the test account
3. Choose "Reviewer Demo", then any question
4. Open the answer link or scan the QR and answer from a phone or a second browser tab
5. The tally and bars on the slide update live
6. Start Slide Show — the object keeps rendering and updating

Support: help@pollslide.com · https://pollslide.com/pollslide-for-powerpoint
```
9. **Review and publish** → all Complete → **Publish**

---

## 6. Microsoft's rules, and where each one is covered

| Microsoft rule (commercial marketplace policy) | How PollSlide meets it |
|---|---|
| 1100.1.5 Clear first-run value before sign-in | Both add-ins explain themselves before sign-in |
| 1100.5.7.3 Say how to get an account; enterprise-only must say so | "Free individual accounts…" in manifest, listing, first screen and notes |
| Working test account for the reviewer | Section 2.3 — you must verify it yourself |
| Listing name = manifest DisplayName, exactly | Sections 4.3 / 5 — copy-paste |
| Support URL, privacy and terms must work and be about this product | All 200; support URL is the PowerPoint page, not the Mac guide |
| Icons: exactly 32×32 and 64×64 | Verified |
| Must work as described, no crashes, on the platforms offered | Test in section 2.4; mobile left off |
| Declare that paid plans exist | Section 4.2 — tick the purchase box |
| No purchase or upsell paths on iOS / Android | Mobile availability left off |
| Id must not change between versions | Ids above — never edit `<Id>`; bump `<Version>` instead |
| Don't change the live product during review | Section 2.1 |
| Honest listing: no features that don't exist, no "beta", no competitor names | Listing text above makes no such claims |

---

## 7. After you press Publish

| Stage | Typical time |
|---|---|
| Automated checks (manifest, links, icons) | minutes to 1 hour |
| Human review | 2–5 business days |
| Your final "Go live" button — **watch your email for it** | you |
| Live in AppSource | a few hours after |

**If rejected:** download the report ZIP (it has screenshots of what the reviewer saw), then
send me the text. If it cites something already fixed, the fix was almost certainly not live
when they looked — rerun 2.2.

**The day it is approved:** change the "Coming soon" label on `pollslide.com/integrations`
to Available with the AppSource link, update the FAQ on `pollslide.com/pollslide-for-powerpoint`,
and add the AppSource badge to the download page.

---

## 8. Troubleshooting the package upload

| Error | Fix |
|---|---|
| "Icon incorrectly sized" | Should not happen — verified. Send me the exact text. |
| "URL not reachable" | A page is down — rerun 2.2, then upload again |
| "Version must be greater" | Change `<Version>` to `1.0.2.0`. **Never touch `<Id>`.** |
| Name mismatch | Copy the name from this guide again; for B, the dash must be "—" |

---

## 9. Add-in test report — 2026-09-25 (nothing was changed)

Tested live with no code changes: both manifests, every URL, icon sizes, the first screen
of each add-in, console errors, and the content add-in's on-slide results (full size,
narrow column, before and after reveal). Its code was also read line by line.

**Issue 1 — content add-in (B), PowerPoint on Windows and Mac only. Medium; could cause a rejection.**
If a slide already has a question chosen, then when the file is opened and Slide Show is
started *in the same window*, the object never switches to presenting mode. On the wall it
keeps the edit buttons (A−, A+, 🖼, 🌙, "Change question") and it doesn't publish the live
question, so **phones may not follow that slide.** Cause: `powerpoint-content/index.html`
line 1087 returns before the "view changed" listener is attached at line 1091. PowerPoint on
the **web** is not affected — Slide Show there reloads the object, which is why it works in
your tests. Fixing it is small (attach the listener before that early return, and remove the
edit buttons when switching to presenting). **I have not changed it**, as you asked. Your
choice: let me fix it before you submit B, or submit B saying it was tested on the web.
Offer A is not affected.

**Issue 2 — content add-in (B). Low.** Its first screen has no support email, and "create one
free at app.pollslide.com" is plain text, not a link. That's enough for the account policy,
but the 09/17 reviewer specifically asked for a support contact. The certification notes
above include it, which should cover it.

**Issue 3 — content add-in (B). Low.** `powerpoint-content/README.md` says the add-in turns
off the saved snapshot, but the manifest has no `<AllowSnapshot>false</AllowSnapshot>`. So
someone opening the file without the add-in sees a frozen picture of old results. That's
cosmetic, but the README and the add-in disagree.

**Issue 4 — content add-in (B), web only. Known Office limitation.** On the web, while
presenting, Office can hide which question each box was linked to (office-js#3406). The add-in
falls back to the slide notes, then to the last question chosen. On a deck with several boxes
presented on the web, a box with no notes marker can show the wrong question. The workaround
is to click each box once in editing view before presenting, or to insert the QR with the
task pane.

**Issue 5 — task pane (A). Low.** At a 350 × 640 pane, the `help@pollslide.com` line sits just
below the bottom edge (646 px), so on a short window it needs a small scroll. Everything else
the reviewer asked for is visible without scrolling.

**Cosmetic (B):** the status line shows a double space around the response count
("10  responses · reveals in  22s").

**Everything else passed:** the bars match the counts, the right answer turns green and the others fade, the
narrow layout doesn't overflow, the edit controls are hidden on web presenting, reduced
motion is respected, and user text is escaped.

---

## 10. Files

| Path | What |
|---|---|
| `MICROSOFT-APPSOURCE-GUIDE.md` | **this guide** |
| `powerpoint-manifest.xml` | offer A manifest — upload this |
| `powerpoint.html` | offer A page |
| `powerpoint-content/manifest.xml` | offer B manifest — upload this |
| `powerpoint-content/index.html` | offer B page |
| `powerpoint-content/README.md` | how offer B works |
| `~/Downloads/PollSlide/AppSource-Assets/screenshots/` | logo + offer A screenshots |
| `APPSOURCE-SUBMISSION.md` | older guide; only its status line is still used (by QA) |
