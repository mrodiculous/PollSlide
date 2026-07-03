# PollSlide Presenter — Architecture & Forward-Thinking Roadmap

**Last updated:** 2026-06-28
**Owner:** Rod
**Source file today:** `presenter.html` (~540 KB single file, app served at `app.pollslide.com/presenter`)

This is the blueprint for turning PollSlide Present into the **best interactive presenter on the market** — and keeping it sane to support. It covers the product strategy, the current state, the architecture changes that make it maintainable, and a phased feature roadmap (slides, media, sound, video, charts, macros, interactivity, AI).

---

## 1. Product strategy — why "Present from PollSlide" matters

We have three ways to go live (now reflected on the marketing site):

1. **Mac companion** — overlays live results on *any* app (Keynote, PowerPoint, Google Slides, PDF). *In review, Mac App Store.*
2. **PowerPoint add-in** — live results inside the PowerPoint slideshow (Win/Mac/Web). *In review, AppSource.*
3. **Present from PollSlide** — import your deck; we give you a ready-built interactive presenter. **Available now, and the one surface we 100% control.**

Because Google locks add-ons and Microsoft/Apple gate the others behind review, **Present-from-PollSlide is our strategic center of gravity**: no platform can limit it, it works on any OS/single screen, and it's where every forward-thinking feature (sound, video, charts, macros) can live without asking another vendor's permission. The other two paths feed users into the same engine.

---

## 2. Current state — what `presenter.html` already does

Confirmed in-code today (reuse, don't rebuild):

- **Builder** for four products: Poll / Survey / Quiz / Study (`PRODUCTS`, `activeProduct`).
- **Polly AI** drafting (topic or pasted material; lazy-loads `pdf.js` to read source PDFs for question generation).
- **Present mode** (`openPresentMode`): full-screen overlay, dark/light projector themes, keyboard nav (←/→/space/R/Q), live Firebase response subscription, reveal + countdown, **projected audience Q&A** with scan-to-ask QR.
- **Live results** rendering, **reveal** logic, **leaderboards**, multi-language (`LANGUAGES`, publishes language to `quiz_builder`).
- **Copy helpers**: `copyQuestionSlide` (flat PNG of a question), `copyQRBox` (QR + caption PNG) for pasting into external decks.
- Firebase RTDB backend (`sessions/`, `quiz_builder/`, `users/$uid/presentations`).

**Gap:** Present mode only shows *poll* slides — it can't yet play the user's own content slides. Closing that gap is P0.

---

## 3. Architecture — how to keep this supportable

The #1 support risk is the **540 KB single file**. Before piling features in, split it so each subsystem is testable in isolation. Target structure (served the same, just authored modularly and bundled, or loaded as ES modules):

```
/app/presenter/
  index.html               # shell + mount points only
  core/
    firebase.js            # config, auth, db refs (single source)
    store.js               # presentation/session state (no DOM)
    bus.js                 # tiny event bus (decouples features)
  builder/                 # question/slide authoring UI
  present/
    engine.js              # slide timeline, navigation, transitions
    deck.js                # imported content slides (P0)
    live.js                # live results binding (reuses /live logic)
    media.js               # image/video/audio playback
    charts.js              # result + data chart renderers
    interact.js            # timers, reveal, wheel, reactions, Q&A
    macros.js              # triggers/automation engine
  ai/polly.js              # generation + insights
  shared/                  # design tokens, i18n, qr, utils
```

Supportability principles (apply to every feature below):

- **One data model, many renderers.** A "slide" is JSON (`{type, content, media, interaction, triggers}`). Builder writes it; Present renders it; `/live`, companion and add-ins read the same questions. Never fork the schema per surface.
- **Feature flags** (`flags.js`) so half-built features ship dark and support can toggle.
- **Graceful degradation** everywhere (same discipline as the add-ins: if an API/codec/network is missing, fall back, never hard-fail).
- **Test harnesses** (we already use mock-Firebase / mock-Office / Chrome-headless). Every renderer must run in a harness with fixture JSON — no "open it in prod to test."
- **Telemetry + error boundary**: capture render errors per slide so one bad slide can't kill the show.
- **Version the slide schema** (`schemaVersion`) and migrate forward.

---

## 4. P0 — Deck import → unified Present (the must-build)

Goal: present your **content slides and your live polls in one show**, from PollSlide.

- **Import formats** (start with what's cheapest given `pdf.js` is already loaded):
  - **PDF** → render each page to an image (pdf.js canvas) → one content slide per page. *(P0)*
  - **Images** (PNG/JPG drag-drop). *(P0)*
  - **PPTX** → render via a converter (server-side LibreOffice/`unoconv` or a JS lib) → images. *(P1)*
  - **Google Slides** → "Publish to web"/export to PDF, or Slides API export. *(P1)*
- **Timeline model**: deck = ordered list of slides; a slide is either `content` (imported image) or `interactive` (poll/quiz/survey/Q&A). Drag to reorder; insert a poll between content slides.
- **Present engine**: arrow-key/remote navigation across the whole timeline; content slides render full-bleed; interactive slides use the existing live/reveal renderer; the active interactive slide auto-launches in Firebase so the companion/answer pages follow.
- **Storage**: imported images to Firebase Storage (or base64 for small decks); deck JSON under the presentation.

**Acceptance:** import a 10-page PDF, drop two poll slides in, present full-screen, advance with arrows, audience answers, results animate inline, reveal works, Esc exits. Verified in the headless harness with a fixture deck.

---

## 5. Feature roadmap by category

### 5.0a Core principle — the QR is the trigger (built + tested)
**Not every slide is a poll.** A presenter's deck is mostly normal content; only some slides carry a Poll/Survey/Quiz/Study question. So the rule across *every* surface is: **live results appear only when a QR is present on the slide; plain slides stay plain.**

In `present.html` we can honor this automatically because we hold the imported slide images:
- On import, each slide is scanned for a PollSlide QR (`detectPollQR` via jsQR → parses the `app.pollslide.com/answer#CODE/idx` URL).
- **QR found** → the slide auto-becomes a live-results slide: its image still shows, and a live-results overlay (response count, animated bars, reveal) appears on it; it's flagged "● Live poll" in the deck list.
- **No QR** → it's just a content slide; no overlay, no reveal control.
- Question metadata (options/correct answer) is loaded from the public `quiz_builder/<code>/questions`.

This is the same mental model as the **Mac companion** (follows the on-screen QR) and the **PowerPoint add-in** (jsQR on the slide image) — one consistent behavior everywhere. *(Tested headless: detection hit/miss, overlay-only-on-QR, reveal, badge, no regression to explicit polls.)*

### 5.0b Deck import — formats (status)
Why import at all: presenters' decks carry their **images, layout, branding** and they want to keep them — we meet them where they are. Status of `present.html` import:
- **PDF** — ✅ built. Rendered to faithful page images via pdf.js (`renderPdfArrayBuffer`).
- **Images** (PNG/JPG/GIF/WebP) — ✅ built. Drag-drop or browse.
- **PowerPoint (.pptx/.ppt)** — ✅ wired via `/api/convert-deck` → PDF → render. Faithful **once a converter is configured** (`CONVERT_API_URL`, e.g. a LibreOffice/unoconv microservice or CloudConvert wrapper). Until then, the UI cleanly guides export-to-PDF.
- **Keynote (.key)** — ⚠️ can't be parsed in-browser (proprietary IWA), and most converters can't either. Routed through `/api/convert-deck` (works if the provider supports .key), else guided export-to-PDF (one tap in Keynote). 
- **Google Slides** — *(P1)* "Publish to web"/export to PDF, or Slides API export.
- **Animations / builds — NOT preserved by import** (PDF/images are static). This is by design and surfaced in the UI: to keep live animations, present from Keynote/PowerPoint with the **Mac companion** or **PowerPoint add-in** (the native-app paths that run during the real slideshow). Import = faithful *static* visuals + live polls; native paths = animations. Consistent with the 3-paths strategy. *(Future P2: render PPTX builds as stepped slides via the converter.)*

**To make .pptx/.key auto-convert in production:** stand up a converter and set `CONVERT_API_URL` (+ optional `CONVERT_API_KEY`). Contract: POST raw bytes + `x-filename`/`x-target:pdf` → return `application/pdf`. See `api/convert-deck.js`.

### 5.1 Slides & content
- Native slide editor (text, shapes, columns) in addition to imports. *(P2)*
- Themes/templates (brand colors, fonts, logo) shared with the QR card + answer page. *(P1)*
- Per-slide background (color/gradient/image/video). *(P1)*
- Speaker notes + **Presenter View** (next slide, notes, timer, clock) on a second screen. *(P1)*

### 5.2 Media — images, video, sound
- **Images**: full-bleed, inline, galleries; GIF support (we already have a GIF picker). *(P0/P1)*
- **Video**: MP4/WebM and YouTube/Vimeo embeds; autoplay/loop/trigger-on-enter; mute control. *(P1)*
- **Audio / sound**:
  - **Sound FX** for events (answer received, reveal, countdown, winner) — small sprite, user-toggle. *(P1)*
  - **Background music** per slide/section with fade in/out and volume ducking during narration. *(P2)*
  - **Narration / voiceover** per slide (record or upload); auto-advance on audio end. *(P2)*
  - **Text-to-speech** read-aloud of questions (accessibility + auto-run kiosks). *(P2)*
- All media: preload next slide's assets; codec fallback; "reduce motion / mute all" master switch.

### 5.3 Charts & data visualization
- **Result charts** (live, bound to responses): animated bars, **donut/pie**, **horizontal/stacked**, **word cloud** (have one), **rating/NPS gauge**, **ranking**, **scatter/2x2**, **open-text wall**, **leaderboard**. *(P0 for bars/wordcloud; P1 for the rest)*
- **Static data charts** (presenter-supplied data, not audience): bar/line/area/pie from pasted table or CSV — for data-driven talks. *(P2)*
- **Comparisons**: show this poll vs. a previous run; pre/post deltas. *(P2)*
- One charting core (e.g., lightweight custom SVG, or a single vetted lib) — never multiple chart libs (support cost).

### 5.4 Interactivity
- Existing: live answers, reveal, countdown, Q&A. Keep.
- **Timers** per question (visible countdown, auto-reveal/auto-advance). *(P1)*
- **Reactions / emoji storm** from phones floating over the slide. *(P1)*
- **Spin-the-wheel / random picker** (named in marketing). *(P1)*
- **Click-through builds & transitions** (reveal bullets, slide transitions). *(P1)*
- **Live cursor / laser pointer**, draw/annotate on slide. *(P2)*
- **Competition modes**: teams, streaks, points multipliers, podium animation. *(P2)*

### 5.5 Macros / automation (the "macros" ask)
A **trigger → action** engine so shows can run themselves and be reused:
- Triggers: slide enter/exit, time elapsed, **response count ≥ N**, % reached, all-answered, reveal fired, keypress.
- Actions: advance/jump to slide, reveal, launch next question, play/stop media, show leaderboard, fire sound, post to Q&A, end session.
- **Templated automations** ("Quiz night", "Town hall", "Lecture") = preset trigger sets.
- **Remote control**: phone-as-clicker (advance/reveal from your phone), and a `/remote` page. *(P1)*
- Macros are JSON on the deck (`triggers[]`) — versioned, testable in the harness, no code per show.

### 5.6 AI (Polly) deepening
- Generate **full slides** (content + matching poll) from a topic/outline/PDF. *(P1)*
- **Auto-design**: turn rough text into a themed slide. *(P2)*
- **Live insights**: summarize open text into themes/sentiment on-screen; AI-grade written answers (partly exists). *(P1)*
- **Auto-translate** the whole deck + answer page at runtime. *(P2)*

### 5.7 Cross-cutting
- **Accessibility**: keyboard-complete, high-contrast, captions for media, TTS, reduced-motion.
- **i18n**: deck + audience UI localized (engine exists).
- **Resilience/offline**: cache deck + assets; queue audience answers offline; reconnect cleanly.
- **Reports**: per-session export (CSV/PDF), comparisons, attendance, engagement timeline.
- **Performance**: lazy-load media, virtualize long decks, 60fps transitions, preload next slide.

---

## 5.8 Translation & i18n — one pipeline, every surface (FIRST-CLASS, not an afterthought)

Everything we build must be translatable. Today there are three disconnected i18n surfaces (marketing dict = 6 langs; audience page via `api/translate.js` = 11 langs; **presenter UI = English only, no framework**). The forward-thinking presenter must fix this by design.

**Principle: one translator, one pattern.** Reuse `api/translate.js` (POST `{texts,target,source}` → `{translations}`, local-Ollama-first → OpenAI fallback, 11 langs) as the single engine for *generating* all dictionaries. Every surface uses keyed strings with English as the in-code fallback (never blank).

**REQUIREMENT — the presenter presents in the USER'S set language (Rod, 2026-06-28).** There is one account-level *user language* preference. It drives BOTH (a) the presenter UI chrome and (b) the **projected present output** (slides/questions/options/result labels) — so if the deck was authored in another language, the projected content is translated to the user's language (via `api/translate.js`, cached per deck+lang). This is separate from the **audience** layer: each attendee's phone still localizes to their own device language at runtime. So: user-language = what the presenter sees and projects; audience-language = per-attendee. User language defaults the deck's present language; allow a per-deck override.

- **Presenter UI (new):** add a real i18n layer from day one of the modular rebuild. Every chrome string goes through `t('key')` with an English default. A **build script extracts all keys → calls `api/translate.js` → writes `presenter-i18n.{lang}.js`** baked dictionaries (instant at runtime, offline-safe). Missing key → English. This mirrors the marketing site so support is uniform.
- **Marketing site:** keep the `translations.js` regeneration workflow; drive it from the *same* `api/translate.js` so we don't maintain two translators. Regenerate whenever English copy changes (e.g., the new `#present` section).
- **Deck CONTENT the user types** (questions/options/notes): already localizes for the audience at runtime via `api/translate.js`. Add a presenter-side **"Translate this deck"** action (P2/P3) using the same endpoint so the builder UI and content can be authored once and localized.
- **Imported slides (images/PDF):** rasterized text **cannot** be auto-translated. Document this clearly; the user imports a deck in their target language. (Far-future: OCR + overlay — out of scope.)
- **String hygiene:** no concatenated sentences (breaks grammar in other languages); use placeholders (`{n} responses`), pluralization rules, and locale-aware number/date formatting.
- **DECIDED (Rod, 2026-06-28): ship 6 languages — en/es/de/fr/pt/it** (the marketing site's current set). All Latin-script → no RTL, no CJK fonts, smallest QA surface. Expand only when users request other languages. The presenter UI i18n, user-language selector, and present-output translation all target these 6.
- **Note:** the audience answer page's runtime translator (`api/translate.js`) already handles 11 automatically per-attendee — that's free reach with no extra QA, so leave it as-is unless we deliberately cap it. The "6" applies to the *curated/selectable* set (marketing, presenter UI, user language).
- **RTL:** not needed now (no Arabic in the 6). Revisit `dir="rtl"` only if `ar` is ever added.

**Supportability win:** because all three surfaces share `api/translate.js` and the keyed-dict pattern, adding a language = run one generation script; adding a feature = its new `t('key')` strings get picked up by the same script. No manual translation, ever.

---

## 6. Phasing (suggested)

| Phase | Theme | Headline items |
|---|---|---|
| **P0** | Unified present | PDF/image import, deck timeline, present content+polls inline, live bars/wordcloud, reveal |
| **P1** | Show polish | PPTX/Google import, themes, presenter view, video + sound FX, timers, reactions, wheel, remote, more chart types, Polly slide-gen |
| **P2** | Pro & automation | Native slide editor, background music/narration/TTS, macros/triggers engine, data charts, annotate, teams |
| **P3** | Scale & intelligence | Auto-design, deck auto-translate, advanced analytics/comparisons, offline kiosk mode |

Before P1 work begins, do the **modular split (§3)** — every new feature lands as its own module with a harness test, or the 540 KB file becomes unsupportable.

---

## 7. Immediate next steps

1. **P0 build** starts with deck import (PDF + images, using the already-loaded `pdf.js`) and the present timeline. Build behind a `flags.deckImport`.
2. Add a harness fixture deck + headless render test (reuse the Chrome-headless approach).
3. Propagate the "three ways to present" messaging to the other site pages (`download.html`, `integrations.html`, `setup.html`, `help.html`, `pricing.html`) and **regenerate `translations.js`** for the new copy.
4. QA pass: confirm existing builder/present/Polly flows still work (no regressions).

---

## 8. PresentSlide editor — the 4-stage feature ladder (vs Keynote/Canva)

Everything a presenting user expects, staged. **Stage 1 = shipped 2026-07-03.**

### Stage 1 — Basic (SHIPPED ✅)
Text boxes (add/drag/resize/dblclick-edit/delete) · bold/italic/underline · text color · per-element font (Display/Sans/Serif/Mono) · size controls + resize-scales-type · alignment (L/C/R) + center-H/V + drag snapping · shapes (rectangle/circle, color) · emoji/symbol elements · images (add/drag/resize/layer) · layer forward/back · undo/redo (⌘Z/⇧⌘Z) · **History panel with labeled changes + revert-to-point** · 8 rich built-in themes (layered, on-character) · **custom theme editor** (bg style/colors/text/accent/font, live preview, persisted, editable/deletable) · per-slide theme override or deck-wide · deck title · speaker notes · autosave/restore · keyboard-complete editing · click/keys to advance in present · Q&A slides live (ask+upvote page).

### Stage 2 — Middle grade (next)
Text style presets (H1/H2/body) · bullet lists in body text · copy/paste elements (⌘C/⌘V) + multi-select · drag-reorder slide navigator · element opacity + rotation · image crop/fit modes · per-slide background image · line/arrow shape · lock element · hyperlinks in text · grid & guides toggle · basic tables.

### Stage 3 — High grade
Per-element build animations (fade/slide-in, ordered) · transition library (push/wipe/zoom) · true Presenter View (notes + next slide + timer on second display) · video/audio on slides · icon/sticker library · group/ungroup · smart alignment guides (spacing hints) · master slides/layouts · export to PDF/PNG · cloud deck storage + share links.

### Stage 4 — Advanced
Real-time co-editing + comments · named cloud versions · template gallery/marketplace · brand kits (org colors/fonts/logo tokens) · Polly design assistant (restyle slide/deck, image editing) · charts bound to live data · interactive web embeds · video/GIF export · rehearsal mode with AI coaching · one-click deck localization · accessibility checker.

