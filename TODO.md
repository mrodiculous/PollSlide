# PollSlide — open work

Living punch list. Updated as things land. Owner-only items are things only Rod can do
(they need a console login, a card, or a lawyer).

Last updated: 2026-08-31 (eleventh pass)

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

## Next up — found during the 2026-08-31 review

| | Item | Notes |
|---|---|---|
| ✅ | Presenter interface language | `ui-lang.js` — 152 strings × 5 languages, selector in the user menu, persisted. Keyed by the exact English text. Only `data-i18n`-tagged elements are touched, so a deck title or student name is untranslatable **by construction**. |
| ✅ | PresentSlide's switcher actually works now | It was a shell: all five non-English dictionaries were `{}` and the `data-i18n` attributes were never read by any code, so changing language did nothing. Dictionaries filled, `applyI18n()` written and wired. |
| ✅ | Big screen i18n | Shares `ui-lang.js` with presenter (169 strings × 5 languages). **Follows the presenter automatically** via `quiz_builder/$code/uiLang` — the projector is usually a different machine, so localStorage there is nobody's. `?lang=` overrides. Locked by `ui-lang.test.js`. |
| ✅ | Retake history in Admin | User detail → **🔁 Retakes & attempts**. Shows the policy, how many students used more than one try, and which attempt was graded. Student answers are never shown — that's a class's schoolwork, and "attempt 2 of 3, best-of" answers the dispute without it. |
| ✅ | Contextual GIFs | `gifs.js` + `api/gif-search.js`. Per-deck toggles, fetched at build time and reviewed before presenting. **Provider-pluggable** since Tenor stopped issuing keys — set `GIPHY_API_KEY` (or `TENOR_API_KEY`) and redeploy. Safety rating locked server-side either way. |

## Admin

| | Item | Notes |
|---|---|---|
| ✅ | SEO / Marketing section | Admin → Growth. `api/seo-status.js` reads the LIVE site (not the repo) via `lib/seo.js`; shows findings, a search-result preview per page, and the owner-only checklist. Logs each run to `admin/seo_log`. |
| ✅ | Full admin sweep | All 19 pages driven. Found: Billing had **never rendered** (wrote to a non-existent `#pageBody`, silent because async); 5 headers disagreed with their nav label; Admin had **zero** visibility into classes/rosters. All fixed. 142 dynamic controls checked, none dead. |
| ✅ | Compliance register | Admin → Compliance. `lib/compliance-register.js` (54 tests) + `api/compliance-register.js`. Who accepted what and when, what's outstanding, 15 controls with evidence, two CSV exports. The external-audit row is permanently red and the caveat is in the page **and** in both exported files. |

## Site, marketing & help

| | Item | Notes |
|---|---|---|
| ✅ | Document everything shipped | New /help sections + a "For teachers" group: class lists, verification, second attempts, gradebook export. Screen-leaving, folders, sharing and collaboration were already documented. Technical SEO clean across all 21 pages. |
| ✅ | i18n for the new copy | Done properly. 30 keyed strings + **18 whole blocks** (`help-teachers-blocks.js`) via `data-i18n-html`, so step lists, leads and callouts translate as units instead of fragmenting. Markup, links and `<li>` counts verified in all 5 languages. UI labels stay English — the app is English, so translating a button name sends people hunting for something that isn't there. |

## Owner-only (Rod)

| | Item | Why it needs you |
|---|---|---|
| ✅ | Cookie banner on mobile | Fixed via `consent-mobile.css`, linked from all 15 pages. Uses `body #…` specificity rather than `!important`, so it beats the runtime-injected style regardless of load order. Verified: 344px → 168px. Still worth merging into `consent.js` one day and deleting the file. |
| ⬜ | **Rotate the Giphy key, then set it in Vercel** | The key was hardcoded in `presenter.html` — public in every browser and in the GitHub history. Removed from source and both search paths now go through `api/gif-search.js`. Rotate at developers.giphy.com, set `GIPHY_API_KEY` in Vercel, redeploy. See `GIF-SETUP.md`. |
| ✅ | Publish `database-rules.json` | Done 2026-08-31. Validated on every run by `scripts/qa-rules.js`. |
| ✅ | Submit sitemap to Search Console | Done 2026-08-31 — Google **and** Bing. |
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
