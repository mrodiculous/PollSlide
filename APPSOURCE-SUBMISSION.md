# Publishing the PowerPoint add-in to Microsoft AppSource

Everything needed to get **PollSlide for PowerPoint** listed publicly, in order, with
the exact values to paste and the traps that cause rejection.

- **Time:** ~2 hours of work, then **3–10 business days** of Microsoft review
- **Cost:** free. There is no listing fee for Office add-ins
- **You need:** a Microsoft account, the manifest in this repo, and a working test login
- **Where the add-in lives:** `powerpoint.html` in this repo, served at
  `https://app.pollslide.com/powerpoint`. The manifest is `powerpoint-manifest.xml`.

> Microsoft renames things in Partner Center regularly. The *sequence* below is stable;
> if a button has a different label, look for the nearest equivalent rather than
> assuming something is missing.

---

## The two things that get add-ins rejected

Read these before you start. Almost every first-time rejection is one of them.

1. **No test account.** Your add-in shows a sign-in screen. A reviewer in Hyderabad
   cannot get past it, so they fail the submission as "unable to validate
   functionality". You must hand them a working email and password in the notes field.
   This is step 7 and it is not optional.
2. **A changed manifest `Id`.** The GUID in `powerpoint-manifest.xml` identifies the
   add-in forever. Generate a new one for version 1.1 and Microsoft treats it as a
   different product: a second listing, and nobody on 1.0 is ever updated. Change
   `<Version>`, never `<Id>`.

---

## Step 1 — Confirm the add-in is actually live

The manifest points at production URLs. Microsoft loads them during review, so they
must work *before* you submit — a validator will not wait for you to deploy.

Open each of these in a normal browser. All four must load, over HTTPS, no warnings:

```
https://app.pollslide.com/powerpoint          ← the add-in itself
https://pollslide.com/icon-32.png             ← 32×32 exactly
https://pollslide.com/icon-64.png             ← 64×64 exactly
https://pollslide.com/integrations#powerpoint ← the support page
```

**Done when:** all four load and the first one shows the PollSlide sign-in pane.

---

## Step 2 — Sideload it and use it yourself, once

Do not submit something you have not run. Ten minutes here saves a rejection cycle.

- **Windows:** PowerPoint → Home → Add-ins → More Add-ins → My Add-ins →
  **Upload My Add-in** → choose `powerpoint-manifest.xml`
- **Mac:** copy the manifest to
  `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/`
  then PowerPoint → Insert → My Add-ins
- **Web:** Insert → Office Add-ins → **Upload My Add-in**

Then actually run a poll through it:

- [ ] The **PollSlide** group appears on the Home tab with a **Live Results** button
- [ ] The pane opens and you can sign in
- [ ] Picking a session shows the question and live responses
- [ ] **Live results / Respondents only** both work, and the choice sticks after reopening
- [ ] Inserting the QR puts a real image on the slide
- [ ] Answering on your phone moves the numbers in the pane

---

## Step 3 — Create the Partner Center account

Go to **partner.microsoft.com** → *Become a partner* → sign in with the Microsoft
account you want to own this listing forever. Use a company address you will keep
(`help@pollslide.com`), not a personal one.

Enrol in the **Marketplace** programme. You will be asked for legal business name,
address and a contact. Microsoft verifies this — like Stripe, it is not instant, so
start it before you need it.

**Done when:** Partner Center shows a **Marketplace offers** section you can enter.

---

## Step 4 — Create the offer

**Partner Center → Marketplace offers → + New offer → Office add-in**

- **Offer ID:** `pollslide-powerpoint` — permanent, lowercase, appears in the URL
- **Offer alias:** `PollSlide for PowerPoint` — internal only, nobody else sees it

---

## Step 5 — Offer setup and properties

**Offer setup**

| Field | Value |
|---|---|
| How do customers get support? | `https://pollslide.com/integrations#powerpoint` |
| Connect a CRM | Skip it. You do not need leads piped anywhere |

**Properties**

| Field | Value |
|---|---|
| Primary category | Productivity |
| Secondary category | Education |
| Industries | Education, Professional services |
| App version | `1.0.0.0` — must match `<Version>` in the manifest |
| Terms of use | `https://pollslide.com/terms` |
| Privacy policy | `https://pollslide.com/privacy` |

Both of those URLs must resolve. A privacy policy is **mandatory** — a missing or
404ing one is an automatic fail.

---

## Step 6 — The store listing

This is what customers read. Write it properly; it is also your search ranking.

| Field | Limit | Use |
|---|---|---|
| Name | 50 | `PollSlide — Live Polls, Quizzes & Surveys` |
| Summary | 100 | `Live audience polls, quizzes and surveys inside your PowerPoint slides.` |
| Short description | 256 | See below |
| Description | 3000 | See below |

**Short description**

> Run live polls, quizzes and surveys inside PowerPoint. Your audience answers on any
> phone by scanning a QR code — no app, no account. Results update on your slide as
> they come in.

**Description** — plain sentences, real benefits, no keyword stuffing (Microsoft
rejects for that):

> PollSlide turns a PowerPoint deck into a two-way conversation.
>
> Insert a poll, quiz or survey into your slides. Your audience scans a QR code or
> types a short code at pollslide.com/join — nothing to install, no account to create,
> works on any phone. Answers arrive live and the results update on your slide while
> you present.
>
> **What you can do**
> - Live polls, multiple-choice quizzes, open text, word clouds and rating scales
> - Show live results as they arrive, or show only who has responded so answers stay
>   independent until you reveal
> - Score quizzes automatically, with a leaderboard and a reveal
> - Insert a QR code straight onto any slide
> - Works in PowerPoint on Windows, Mac and the web
>
> **Who it is for**
> Teachers checking a class has understood, trainers keeping a room awake, and anyone
> who has ever asked "any questions?" to silence.
>
> A free PollSlide account is required. Paid plans lift limits on audience size and
> saved decks — see pollslide.com/pricing.

**Search terms** (up to 7): `poll`, `quiz`, `survey`, `audience response`, `live poll`,
`classroom`, `interactive presentation`

### Screenshots — the part people rush

**1–5 images, exactly 1366×768 PNG.** Wrong dimensions are rejected automatically.

Take them from a real session, not mockups:

1. The pane open beside a slide, live results filling in
2. **Respondents only** view — the differentiator, worth showing
3. A QR code inserted on a slide, phone answering beside it
4. A revealed quiz question with the correct answer highlighted
5. The leaderboard

No personal data in any of them: use made-up participant names.

### Logo

**300×300 PNG.** Already made: `icon-300.png` in the website repo, downscaled from the
existing 512px master so it is the same mark, not a redraw. Upload that file.

---

## Step 7 — Availability, and the test account ⚠️

**Markets:** select all, unless you have a reason not to. Restricting markets is a
common accidental self-limitation.

**Then the field that decides your submission — "Notes for certification":**

```
PollSlide requires a free account to use.

TEST ACCOUNT
  URL:      https://app.pollslide.com
  Email:    appsource-review@pollslide.com
  Password: <create this and paste the real password here>

HOW TO TEST
1. In PowerPoint, Home tab → PollSlide → Live Results. The pane opens.
2. Sign in with the account above.
3. The account already contains a demo deck, "Animal quiz — a 2-minute demo".
   Select it in the pane.
4. Click "Insert QR" to place a join code on the slide.
5. On a phone or a second browser, open the URL shown under the QR and answer a
   question. The pane updates live within a second or two.
6. Toggle "Live results" / "Respondents only" to switch between the vote
   distribution and a list of who has responded.

NOTES
- No data is written to the presentation except an inserted QR image.
- The add-in reads and writes only the user's own PollSlide data.
- Audience members do not need an account.
```

**Before you paste that: actually create `appsource-review@pollslide.com`**, sign into
it once, confirm the demo deck is there, and confirm the password works. A reviewer
finding a dead login fails the submission and you wait another week.

---

## Step 8 — Upload the manifest and submit

**Technical configuration → upload `powerpoint-manifest.xml`.**

Partner Center validates it immediately. If it complains:

| Complaint | Cause |
|---|---|
| Icon dimensions invalid | `IconUrl` must be 32×32 and `HighResolutionIconUrl` 64×64, exactly |
| SourceLocation not reachable | `https://app.pollslide.com/powerpoint` was down when it checked |
| AppDomains missing | Every domain the pane navigates to must be listed |
| Id already in use | This add-in is already submitted under another account |

Then **Review and publish**.

---

## Step 9 — While it is in review

Status moves through *Publisher signoff → Certification → Publish*. Expect **3–10
business days**. Microsoft emails the contact on the account, so watch that inbox.

**Do not change the production add-in during review.** They are testing the live URL.
Shipping a breaking change mid-review fails it.

If it comes back rejected, the email cites a specific policy number and is usually
precise. Fix, resubmit — resubmission is faster than the first pass.

---

## Step 10 — The day it is approved

Three things go stale the moment you are live. Do them the same day:

- [ ] **`/integrations`** — the PowerPoint card's status pill still reads
      **"Coming soon"** (amber). Change to "Available now" and link the AppSource
      listing. The page lead paragraph says "coming soon" too.
- [ ] **`/setup`** — the FAQ answer *"Does PowerPoint work too?"* says
      **"the PowerPoint add-in is coming soon"**. It will be wrong.
- [ ] Both of those strings are translated in five languages — update
      `translations.js` / `help-teachers-blocks.js` to match, or the English says
      "available" while the Spanish still says "próximamente".

---

## Updating it later

1. Change `<Version>` in the manifest (`1.0.0.0` → `1.0.1.0`). **Never `<Id>`.**
2. Partner Center → the offer → Update → upload the new manifest → resubmit.
3. Review is faster for updates, but still not instant.

Because the pane itself is served from `app.pollslide.com`, **most changes need no
resubmission at all** — you deploy and every user has it immediately. You only
resubmit when the *manifest* changes: new ribbon buttons, new permissions, new domains,
a new name or icon.
