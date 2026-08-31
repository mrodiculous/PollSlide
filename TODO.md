# PollSlide — open work

Living punch list. Updated as things land. Owner-only items are things only Rod can do
(they need a console login, a card, or a lawyer).

Last updated: 2026-08-31 (third pass)

---

## In flight — classroom / teacher

| | Item | Notes |
|---|---|---|
| ✅ | Class rosters + stable student identity | `roster.js`, `api/student-claim.js`. One student = one record across devices, cleared browsers and differently-typed names. |
| ✅ | Three verification modes | PIN they choose / codes you issue / emailed codes. Teacher picks per class; email mode gated behind a recorded attestation. |
| ✅ | Screen-leaving report | Per-deck teacher checkbox. Records leave count + time away; the student is told it was noticed. |
| ✅ | Leaderboards score people, not devices | `psStandings` folds a student's two devices; a second device is not a free retry. |
| ✅ | Attempts / retakes | `retakes.js`. Off by default. Teacher picks tries (2/3/5) and which attempt is graded (best/last/first). Every attempt kept at `sessions/$code/attempts`. |
| ✅ | Gradebook CSV export | `gradebook.js`. One row per student. A blank is not a zero; ungraded questions excluded; formula-injection neutralised (this also fixed the existing answers export). |

## Admin

| | Item | Notes |
|---|---|---|
| ✅ | SEO / Marketing section | Admin → Growth. `api/seo-status.js` reads the LIVE site (not the repo) via `lib/seo.js`; shows findings, a search-result preview per page, and the owner-only checklist. Logs each run to `admin/seo_log`. |
| ⬜ | **Full admin sweep** | Walk every Admin page as an admin would: does each one load, is the language consistent, does every control do what it says, do the pages agree with each other and with the product. Cohesion, not just "no errors". |
| ⬜ | Security controls register | ISO/SOC **cannot** be self-certified. The automatable part is a controls register mapped to evidence that already exists. |

## Site, marketing & help

| | Item | Notes |
|---|---|---|
| ✅ | Document everything shipped | New /help sections + a "For teachers" group: class lists, verification, second attempts, gradebook export. Screen-leaving, folders, sharing and collaboration were already documented. Technical SEO clean across all 21 pages. |
| 🔸 | i18n for the new copy | 30 strings × 5 languages hand-authored in `help-translations-teachers.js` (headings, TOC, card titles and bodies). Step lists, leads and callouts stay English — inline `<b>` tags fragment them, same as the rest of the help centre. Fixing that is a `data-i18n-html` refactor. |

## Owner-only (Rod)

| | Item | Why it needs you |
|---|---|---|
| ⬜ | **Two lines in `consent.js`** | The cookie banner is unreadable on a phone — text squeezed into a narrow column, banner 344px tall covering half the screen, on every page. I could not edit the file (sandboxed), but the fix is verified in the browser: it halves to 168px. See below. |
| ⬜ | Publish `database-rules.json` | Collaboration + any new node stays default-denied until this is published in the Firebase console. |
| ⬜ | Submit sitemap to Search Console | Needs the Google account. |
| ⬜ | Counsel review of legal docs | Terms/privacy wording. |
| ⬜ | Stripe go-live | Follow `STRIPE-GO-LIVE.md`. Business verification is not instant — start it first. |

---

## Before every push

```
node scripts/qa.js
```

Syntax → undefined names → reachability → escaping → cross-product parity → all tests.
`--fast` skips the parity sweep.


---

## The `consent.js` patch

Not applied — that file was not writable from my sandbox. Verified working in the
browser: banner height on a 375px screen goes from **344px to 168px**, and the text
gets the full width instead of a ~120px column.

In `consent.js`, in the injected `<style>` block, change:

```css
#ps-consent-text { flex: 1; line-height: 1.5; }
```

to:

```css
#ps-consent-text { flex: 1 1 320px; line-height: 1.5; }
```

and add, after the other `#ps-consent-*` rules:

```css
@media (max-width: 640px) {
  #ps-consent-banner { padding: 14px 16px; }
  #ps-consent-btns { width: 100%; justify-content: flex-end; }
}
```

**Why:** `flex: 1` means `flex-basis: 0`, so the text column could shrink to nothing
while the 216px button group (`flex-shrink: 0`) kept its width. Giving the text a real
basis makes it take the first line and pushes the buttons onto their own.

Same story for **`legal-shared.css`**, which was also unwritable: its rules now live in
`legal-mobile.css`, linked from the seven legal pages. Worth merging back into
`legal-shared.css` and deleting the extra file plus its `<link>` tags.
