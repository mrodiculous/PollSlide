# PollSlide — open work

Living punch list. Updated as things land. Owner-only items are things only Rod can do
(they need a console login, a card, or a lawyer).

Last updated: 2026-09-01 (sixteenth pass)

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
| ✅ | **Answers survive bad wifi** | `offline-queue.js`. A failed submit is queued to localStorage, retried with jittered backoff, and survives the tab closing. The student sees "saved, will send automatically". The time they TAPPED is preserved; the delay is recorded so a late answer can be judged, not guessed at. Report and CSV show "sent late". |
| ✅ | Longitudinal student progress | Reports → **Progress over time**. `progress.js` (37 tests). Refuses to overclaim: under 3 sittings says "not enough yet", a move under 8 points is "steady", and the trend compares first-half to second-half so one bad day can't invert a term. "Worth a look" is not a ranking. |
| ✅ | Starter decks on first run | `starters.js` — three real decks (poll/quiz/survey), the one matching your current tab first. Shown only on an empty library. One click to a presentable deck with real questions and real answers. |
| ✅ | Presenter interface language | `ui-lang.js` — 152 strings × 5 languages, selector in the user menu, persisted. Keyed by the exact English text. Only `data-i18n`-tagged elements are touched, so a deck title or student name is untranslatable **by construction**. |
| ✅ | PresentSlide's switcher actually works now | It was a shell: all five non-English dictionaries were `{}` and the `data-i18n` attributes were never read by any code, so changing language did nothing. Dictionaries filled, `applyI18n()` written and wired. |
| ✅ | Big screen i18n | Shares `ui-lang.js` with presenter (169 strings × 5 languages). **Follows the presenter automatically** via `quiz_builder/$code/uiLang` — the projector is usually a different machine, so localStorage there is nobody's. `?lang=` overrides. Locked by `ui-lang.test.js`. |
| ✅ | Retake history in Admin | User detail → **🔁 Retakes & attempts**. Shows the policy, how many students used more than one try, and which attempt was graded. Student answers are never shown — that's a class's schoolwork, and "attempt 2 of 3, best-of" answers the dispute without it. |
| ✅ | Contextual GIFs | `gifs.js` + `api/gif-search.js`. Per-deck toggles, fetched at build time and reviewed before presenting. **Provider-pluggable** since Tenor stopped issuing keys — set `GIPHY_API_KEY` (or `TENOR_API_KEY`) and redeploy. Safety rating locked server-side either way. |

## GIFs — reworked 2026-09-01

| | Item | Notes |
|---|---|---|
| ✅ | **GIFs fill the media boxes that already exist** | The first build stored them in parallel fields (`gifQ`/`gifA`/`gifOpts`) *beside* the boxes, so they rendered through their own code paths, never appeared in the editor's URL fields, and couldn't be hand-edited — "Done" looked like it did nothing. Now a question GIF fills `q.image` and an answer GIF fills that option's `img`. The URL in the box is the only source of truth. |
| ✅ | Your own pictures are never overwritten | A small record (`imageGif`/`imgGif`) beside an auto-filled URL holds the search term and provider. A hand-typed URL has none — that's how "leave it alone" is decided, on re-fetch **and** on Remove all. Typing in a box drops the record. |
| ✅ | Old decks migrate on open | `migrateLegacyGifs()` moves GIFs out of the retired fields into the boxes and deletes them. A question where you'd already chosen an image keeps yours. |
| ✅ | Answer GIFs actually generate | `cleanAnswer` sliced the **first** three words, so "Converting light into chemical energy" searched for `"Converting light into"` — a stub image search returns nothing for. Questions worked, answers silently didn't. Now keeps the tail (head-final English) and drops function words anywhere in it. Plus a reaction fallback so a box is never left empty. |
| ✅ | Every choice gets one, not just the right one | A picture on the correct card alone is a tell. The reveal-only GIF was **removed**: it had no box in the editor, so it couldn't be seen or changed before it went up in front of a room. |
| ✅ | Attribution follows the real provider | Three places said "Tenor" while Giphy served the images — the review panel, the projector watermark (`gifTag`), and the picker footer. All now derive from each record's `source`. Giphy's terms require their mark. |
| ⬜ | Option GIFs on phones | `answer.html` doesn't render them — big screen only. Probably right, since the give-away concern is about the shared screen, but it's a deliberate gap not an oversight. |

## Atmosphere — the wait, 2026-09-01

| | Item | Notes |
|---|---|---|
| ✅ | **Selectable atmosphere, not mandatory** | `atmosphere.js` (22 tests). Three presets in the existing pre-present dialog: 🌿 Calm / 🎓 Classroom / 🎤 Game show. Remembered **per deck** like the game mode, so the Friday quiz and the Monday board update differ. Presets, not four checkboxes — someone choosing ten seconds before presenting wants to say what kind of room they are in. |
| ✅ | Quiet is the default | An unset, unknown or malformed value lands on **Calm**. A product that starts ticking on a projector in a shared building before anyone chose anything has misjudged whose room it is. Asserted in tests. |
| ✅ | Device mute always wins | 🔇 on this device beats a preset chosen last week; the picker says so when the two disagree. |
| ✅ | The dead 30 seconds | Was a 13px grey pill reading "Starting reveal countdown…". Now optionally: an accelerating tick (rising pitch, louder in the last three), the numeral taking the middle of the slide for the last five, a soft pop per answer landing, and an 800ms held beat with a rising roll before the reveal. Measured: Calm 57ms to reveal and silent; Classroom/Game show ~820ms. |
| 📝 | Deliberately NOT done | No music files — licensing is the last thing to take on the week payments go live; everything is synthesised via the existing WebAudio engine, so no assets and no bandwidth. Audio stays presenter-side only: thirty phones ticking out of sync is chaos, not tension. |
| ✅ | Documented + marketed | `/help#atmosphere` (3 steps, 3 cards, 2 callouts) and a section on `/game-modes` with an FAQ entry answering "will it make noise I wasn't expecting?". All new help copy translated into 5 languages, markup counts verified against the English. |
| ✅ | **The whole present dialog now translates** | The game-mode names and blurbs had *never* been translated — Survival, Wager and every description stayed English while the dialog changed language around them. Found while adding Atmosphere. 28 strings (title, both section headings, 5 modes × name/blurb/bestFor, 3 presets, display options) × 5 languages. Verified in-browser: the dialog is fully French end to end. |
| ✅ | **Presenter now follows the browser language** | It was `localStorage.getItem('ps_ui_lang') \|\| 'en'` — no detection at all, so a Spanish-speaking teacher signed in to an English app until they found the picker. Every other surface already detected (`i18n.js` for the site, `answer.html` for students); the presenter was the only one that didn't. An explicit choice still wins over the browser. |
| ⬜ | **Site copy: 446 of 742 strings are English in every language** | Measured, not guessed. Best: `index` 78%, `pricing` 71%, `integrations` 75%. Worst: `vs-kahoot`/`vs-mentimeter`/`vs-slido` **0%** (acquisition pages — a Spanish search lands on English), `game-modes` 8%, `help` 49% of loose prose. help's 41 **curated** `data-i18n-html` blocks are 100% translated — those are the substantive leads/steps/cards, so the page reads far better than the raw number suggests. |
| 📝 | Legal pages are English-only **on purpose** | `terms` 2%, `privacy` 2%, `dpa`/`vpat`/`subprocessors` 0%. Machine-translating an indemnity clause creates liability rather than removing it. Standard practice is one authoritative language — but the pages should SAY so ("the English version governs"). Fold into the counsel review below rather than translating. |
| ⬜ | Presenter offers 6 languages, students' phones offer 11 | `en/es/de/fr/pt/it` vs those plus `nl/ja/zh/ar/hi`. A Japanese teacher gets an English app while their own students get Japanese. |
| ⬜ | Big screen (`live.html`) doesn't follow the atmosphere | It reads `uiLang` from the session already; the same route would carry this. Only matters when the projector is a different machine from the presenter. |

## Admin

| | Item | Notes |
|---|---|---|
| ✅ | SEO / Marketing section | Admin → Growth. `api/seo-status.js` reads the LIVE site (not the repo) via `lib/seo.js`; shows findings, a search-result preview per page, and the owner-only checklist. Logs each run to `admin/seo_log`. |
| ✅ | Full admin sweep | All 19 pages driven. Found: Billing had **never rendered** (wrote to a non-existent `#pageBody`, silent because async); 5 headers disagreed with their nav label; Admin had **zero** visibility into classes/rosters. All fixed. 142 dynamic controls checked, none dead. |
| ✅ | Compliance register | Admin → Compliance. `lib/compliance-register.js` (54 tests) + `api/compliance-register.js`. Who accepted what and when, what's outstanding, 15 controls with evidence, two CSV exports. The external-audit row is permanently red and the caveat is in the page **and** in both exported files. |

## Site, marketing & help

| | Item | Notes |
|---|---|---|
| 🔸 | **Homepage product imagery** | The earlier "no imagery at all" note was **wrong** — `#see-it` has always carried `preview_1_live_to_leaderboard.mp4`. It is from **28 June** and shows live-answers→leaderboard only: no present mode, no GIFs. Added `#big-screen`, a present-mode frame rebuilt in CSS (same technique as `/game-modes`), which reflows on a phone and can't go stale. Real captures of present mode are now possible too — see the note on html2canvas below. |
| 🔸 | **One demo deck for every new user** | Replaced the three text-only starters with a single 5-question **animal quiz** — a subject that can't land badly in any country or age group, every answer a concrete creature so it pictures well. Correct answers spread across A/B/C/D (all five sat at A in the first draft). Question pictures are searched on objects, never creatures, so the slide can't answer itself. 28 tests in `starters.test.js`. **Blocked on the 25 GIFs:** they must be fixed and eyeballed, not searched per user — see below. |
| ⬜ | **Fill + vet the demo deck's 25 GIFs** | `scripts/collect-starter-media.md`. Runs against our own `/api/gif-search` from a signed-in tab, so the key stays in Vercel. All 25 laid out in a grid and reviewed by eye, **plus 2–3 spares each** for the self-repair below. Lands in `starter-media.js`; the deck works without it, just without pictures. |
| ✅ | Dead demo pictures repair themselves | Hardcoded third-party URLs rot — an uploader deletes a post and a new user's first screen is broken images. `lib/starter-media-check.js` (28 tests) runs on the existing 15-minute watchdog: HEADs every URL and **promotes a pre-vetted spare**. Deliberately never re-searches — that would put an unreviewed image in front of every new account, which is the whole reason the list is fixed. Out of spares → the slot is blanked (deck stays a working quiz) and Rod is emailed once. Repairs are written to `app_config/starterMedia`, which the presenter prefers over the shipped file. |
| 📝 | Capturing present mode | html2canvas has no flexbox, so it re-draws the present-mode results panel at the left edge — the stray `13/4/3/2` in early attempts. The DOM is correct; only the capture was wrong. Workaround: hide that panel for the shot. `scripts/shot-server.js` receives the PNG; Bash `screencapture` on this Mac only grabs the wallpaper. |
| 🔸 | PowerPoint / Keynote import | **Removed from the UI and the site** — it needed a converter service that was never stood up, so every attempt fell back to "export to PDF". PDF import works and is client-side. `api/convert-deck.js` + `converter-service/` are still in the repo: stand the service up, set `CONVERT_API_URL`, restore the menu item from git history. |


| | Item | Notes |
|---|---|---|
| ✅ | Document everything shipped | New /help sections + a "For teachers" group: class lists, verification, second attempts, gradebook export. Screen-leaving, folders, sharing and collaboration were already documented. Technical SEO clean across all 21 pages. |
| ✅ | i18n for the new copy | Done properly. 30 keyed strings + **18 whole blocks** (`help-teachers-blocks.js`) via `data-i18n-html`, so step lists, leads and callouts translate as units instead of fragmenting. Markup, links and `<li>` counts verified in all 5 languages. UI labels stay English — the app is English, so translating a button name sends people hunting for something that isn't there. |

## Owner-only (Rod)

| | Item | Why it needs you |
|---|---|---|
| ✅ | Cookie banner on mobile | Fixed via `consent-mobile.css`, linked from all 15 pages. Uses `body #…` specificity rather than `!important`, so it beats the runtime-injected style regardless of load order. Verified: 344px → 168px. Still worth merging into `consent.js` one day and deleting the file. |
| 🔸 | **Rotate the Giphy key, then set it in Vercel** | The old key was hardcoded in `presenter.html` — public in every browser and in the GitHub history. Removed from source; both search paths go through `api/gif-search.js`. **The key pasted in chat now returns 401**, and your GIF tool works, so production is on a rotated key already — this looks done. See `GIF-SETUP.md`. |
| ⬜ | Giphy key for the sandbox | Only to build demo/marketing decks locally: `printf '%s' 'KEY' > ~/.pollslide-giphy-key && chmod 600 ~/.pollslide-giphy-key`, then `node scripts/demo-media.js`. Read, never logged or committed. Without it a demo deck can't get real GIFs and falls back to Wikimedia stills. |
| ✅ | Publish `database-rules.json` | Done 2026-08-31. Validated on every run by `scripts/qa-rules.js`. |
| ✅ | Submit sitemap to Search Console | Done 2026-08-31 — Google **and** Bing. |
| ⬜ | Counsel review of legal docs | Terms/privacy wording. |
| ⬜ | Stripe go-live | Follow `STRIPE-GO-LIVE.md`. Business verification is not instant — start it first. **Runbook re-verified 2026-09-01** against the code: all 10 lookup keys and all 5 webhook events match exactly. Added the missing **step 6** — `STRIPE_AUTOMATIC_TAX` and `STRIPE_COLLECT_CONSENT` exist in `create-checkout.js`, are **off by default**, and were undocumented, so following the old runbook took you live with no tax collection and no recorded Terms consent. |
| ⬜ | Publish the PowerPoint add-in | Follow `APPSOURCE-SUBMISSION.md`. Free, ~2h of work then 3–10 days of review. Add-in verified working; `icon-300.png` generated; manifest SupportUrl repointed from `/setup` (whose FAQ says the add-in is "coming soon") to `/integrations#powerpoint`. **You must create `appsource-review@pollslide.com` and put real credentials in the certification notes** — no test account is the single most common rejection. |

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
