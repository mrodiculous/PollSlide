# Interaction Modes — Desktop Participants & Personal Growth (Solo)

Design doc, July 2026. PollSlide today is built around one interaction: a
presenter on stage, an audience on phones. This doc designs the two contexts
the product doesn't frame yet — without new backend.

## The three interaction contexts

| | Who answers | Device | Pace | Exists today? |
|---|---|---|---|---|
| **1. Live audience** | audience | phone (QR) | presenter-driven | ✅ the core product |
| **2. Desktop participant** | audience / respondent | laptop or desktop | live OR self-paced | ⚠️ works, but renders as a 480px phone card floating in a big screen |
| **3. Solo / personal growth** | the creator themselves | any | self-paced | ⚠️ the machinery exists (share links, async form mode, SM-2 flashcards, study mastery) but there is no framing, entry point, or personal results loop |

Key insight: **nothing new needs to be invented server-side.** `answer.html`
already has an async whole-form mode (no live question index → answer the whole
set), a full spaced-repetition flashcard engine, and study progress writes
(`sessions/<code>/study/...`). Modes 2 and 3 are presentation + framing work.

## Mode 2 — Desktop participant

Problem: `answer.html` pins `#app` to a fixed, centered card with
`max-width: 480px !important`. On a 27" display that's a lonely phone column.
Desktop respondents are real: emailed surveys opened at work, take-home
quizzes, students studying at a desk, workshop attendees on laptops.

Design (see mockup A):
- **≥900px: two-pane layout.** Question text + image on the left, answer
  options on the right as full-height buttons. Below 900px nothing changes —
  the current card IS the phone experience, zero risk to the live flow.
- **Keyboard first-class:** `1–9`/`A–D` select an option, `Enter` submits,
  `←/→` move between flashcards, `Space` flips. A quiet hint line under the
  options ("1–4 to choose · Enter to submit").
- **Persistent progress:** slim top bar with session name, "Question 3 of 8",
  and the timer — replaces scroll-to-see context on the phone card.
- Same URLs, same session codes, same Firebase paths. Purely additive CSS +
  a keydown handler.

## Mode 3 — Solo / personal growth

Problem: an educator drafting a quiz has no sanctioned way to *take* it; a
professional who wants Polly to build a study set for their own growth has to
pretend to be their own audience (open their share link in another tab, enter
their name). It works — which proves demand — but nothing frames it.

Design (see mockup B):
- **Entry point:** a "Practice on my own" row in the existing share modal
  (`openShareModal`) for Quiz and Study (Survey gets "Preview as respondent").
  It opens the creator's own share link with `&solo=1`, pre-filling their
  account name — no name prompt, no fake audience.
- **Solo run:** identical answer experience (mode 2 layout on desktop). For
  quizzes, self-paced grading at the end: score, per-question review of
  misses. For study, the SM-2 flashcard engine as-is — it was already built
  for exactly this.
- **Personal results loop:** score + best score + practice streak, "Practice
  again" and "Review misses" (retake only the wrong ones — a filtered rerun,
  client-side). Solo responses are tagged (`solo:true`) so they're excluded
  from audience dashboards, leaderboards, and reports.
- **Why it matters commercially:** it converts PollSlide from an
  event tool (used when presenting) into a habit tool (used between
  presentations), and it's the natural home for Polly — "ask Polly for a study
  set about anything" is a personal-growth pitch, not a presenter pitch.

## Build sequence (all client-side, poll-safe)

1. **P1 — Desktop layout** (`answer.html`, CSS + small JS): responsive
   two-pane ≥900px, keyboard shortcuts, progress bar. No data changes.
2. **P2 — Solo entry** (`presenter.html` share modal + `answer.html`):
   `solo=1` param → skip name prompt, tag responses `solo:true`, filter solo
   rows out of `attachQuizLeaderboard` / survey dashboards / reports.
3. **P3 — Personal results** (`answer.html` + small `users/<uid>/practice/`
   or localStorage first): score history, best, streak, review-misses rerun.

Per QA discipline: P2 touches response paths — smoke-test a live poll +
companion after, and confirm dashboards ignore `solo:true` rows.
