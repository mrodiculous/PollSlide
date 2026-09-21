# Submission deck — what to change before resubmitting
**Source of truth:** `PollSlide-PowerPoint-AppSource-Submission.key` (Keynote) → export to
the PDF in the app repo. **Ignore** `~/Downloads/PollSlide/…-Submission.pptx` — it is a stale
earlier version (still says "test@test.com"); I left it untouched rather than create a second
divergent deck.

Your Keynote deck is 11 slides and already ahead of the pptx. Four edits and one new slide.

---

## ⚠️ 1. Slide 9 — APP NAME must match the manifest character-for-character

The slide currently shows **two** names:
> `PollSlide for Powerpoint`  ·  `PollSlide — Live Polls, Quizzes & Surveys`

Delete the second one, and fix the capital **P** in PowerPoint. The manifest says:

```
PollSlide for PowerPoint
```

A listing name that does not match the manifest `DisplayName` exactly is its own
certification failure — independent of anything in the rejection report.

## 2. Slide 9 — SUPPORT / PRIVACY

The support URL changed when I repointed the manifest (`/setup` is the **Mac companion**
guide, and a reviewer clicking it landed on a page about a different product).

- Current: `pollslide.com/setup · pollslide.com/privacy`
- **Change to:** `pollslide.com/pollslide-for-powerpoint · pollslide.com/privacy`

## 3. Slide 9 — SHORT DESCRIPTION, add the account line

Append this sentence. It answers policy **1100.5.7.3** directly, in the place the reviewer
looks first:

> Free individual accounts — no enterprise purchase or admin setup required.

## 4. Slide 9 — LONG DESCRIPTION, add a "Getting an account" paragraph

Paste after the "Who it is for" block:

> **Getting an account.** PollSlide is available to individuals as well as organisations.
> Anyone can create a free account at app.pollslide.com/presenter in about a minute. There is
> no enterprise purchase, license key or administrator provisioning required, and no credit
> card for the free plan. This is not an enterprise-only add-in.

## ⚠️ 5. Slide 10 — confirm the test-account password is real

The slide shows `appsource-review@pollslide.com` / `12345678`. The email looks right; **I
cannot verify the password**. Sign in with those exact credentials in the add-in before you
submit. A reviewer who cannot sign in fails the submission on the spot, and it is one of the
two most common causes of a second rejection.

While you are there, confirm that account has a presentation named **"Reviewer Demo"** with at
least one question — step 3 on that slide tells the reviewer to pick it by name.

---

## 6. NEW SLIDE — insert as slide 2, right after the title

A re-reviewer's job is to check the two cited policies. Put that first so they do not hunt.
Use the same four-card layout as "BUILT RIGHT".

**Section label:** `CERTIFICATION FEEDBACK ADDRESSED`
**Subtitle:** `Every point from the 09/17/2026 report, and where to see it`

**Card 1 — 1100.1.5 · First run experience**
> The task pane now opens on a value panel: one line on what the add-in does, plus three
> concrete benefits. All of it is visible before any credentials are requested, with no
> scrolling, at the default task-pane width.

**Card 2 — 1100.5.7.3 · Getting an account**
> This is not an enterprise-only add-in. Any individual can self-serve a free account in about
> a minute. The first-run screen states that explicitly and links straight to sign-up.

**Card 3 — Contacting the provider**
> help@pollslide.com and the PowerPoint setup guide are both shown on the first-run screen.
> The manifest SupportUrl now points at the add-in's own support page.

**Card 4 — No functional change**
> This submission adds first-run explanatory content, account-acquisition guidance and support
> contact details. The manifest Id is unchanged; only Version was bumped.

---

## 7. Title slide (optional)

`Microsoft AppSource — Office Add-in submission · 2026`
→ `Microsoft AppSource — Office Add-in resubmission · September 2026`

---

## After editing
1. Keynote → File → Export To → PDF, overwrite
   `~/Documents/GitHub/PollSlide/PollSlide-PowerPoint-AppSource-Submission.pdf`
2. Commit both the `.key` and the `.pdf`
3. The paste-ready Partner Center listing text and the certification-notes box are in
   `APPSOURCE-RESUBMIT-2026-09.md` — they now match this deck.
