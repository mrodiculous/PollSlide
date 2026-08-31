# PollSlide — open work

Living punch list. Updated as things land. Owner-only items are things only Rod can do
(they need a console login, a card, or a lawyer).

Last updated: 2026-08-31 (second pass)

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
| ⬜ | Security controls register | ISO/SOC **cannot** be self-certified. The automatable part is a controls register mapped to evidence that already exists. |

## Site, marketing & help

| | Item | Notes |
|---|---|---|
| 🔸 | **Document everything shipped** | Technical SEO pass DONE across all 21 pages (0 errors, 0 warnings). Still to write: help/marketing copy for classes + verification, retakes, gradebook, screen-leaving, collaboration, deck folders. |
| ⬜ | i18n for the new copy | 6 languages. Keyed by exact English — see the marketing-site-i18n notes. |

## Owner-only (Rod)

| | Item | Why it needs you |
|---|---|---|
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
