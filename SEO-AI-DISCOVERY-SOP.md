# PollSlide — Search & AI Discovery SOP

**Goal:** when someone searches Google or Bing, or asks ChatGPT, Claude, Perplexity, Copilot or Gemini, for a
way to run live polls, quizzes or Q&A over their slides, **PollSlide is found, and recommended.**

Written 2026-10-07. Owner: Rod. Review this SOP every quarter. Lives in the APP repo (never served — `*.md` is in `.vercelignore`); the website repo is public static files.

**Part 1 (§1–6) is the SOP. Part 2 (§7) is Claude's fix-it runbook — follow it in order, one step per session if needed, and tick it here.**

---

## 1. How people find a product like ours (and what each needs)

| Where they ask | What decides if we show up | What we control |
|---|---|---|
| **Google / Bing search** | Pages crawlable + indexed · page answers the query · other sites link to us | Pages, sitemap, links |
| **ChatGPT search, Copilot** | Mostly the **Bing** index + what's written about us elsewhere | Bing Webmaster, IndexNow |
| **Perplexity, Claude search** | Their own search crawlers + Bing/Google | robots/Cloudflare allow them |
| **ChatGPT / Claude "from memory"** | Whether training crawlers could read us, and how often others mention us | Cloudflare AI-bot setting, mentions |
| **Google AI Overviews / Gemini** | Google index + clear, quotable answers on the page | FAQ blocks, structured data |

**The one rule that matters most:** AI tools repeat what *other* sites say about a product — review sites, comparison
articles, Reddit, directories, app stores. Our own pages get us *eligible*. **Other people's pages get us *recommended*.**

**What we target:** specific phrases that show buying intent, not head words. We will not win "poll" or "slides". We can
win phrases like *"live poll in Keynote"*, *"Mentimeter alternative for PowerPoint"*, *"audience Q&A for Google Slides"*,
*"pub quiz software"*, *"classroom quiz with QR codes"*.

---

## 2. Where we stand (measured 2026-10-07)

**Working:**
- **Site pages:** 39 pages in the sitemap, with dates. Each has one H1, a unique title and description, a canonical tag,
  Open Graph tags and structured data (SoftwareApplication, FAQPage, Article).
- **Search consoles:** the sitemap has been submitted to both Google Search Console and Bing Webmaster.
- **Crawler access:** Googlebot, Bingbot, Applebot, OAI-SearchBot, ChatGPT-User, Claude-SearchBot and PerplexityBot all
  get the full page.

**Not working:**
- **Search visibility:** a web search for "PollSlide" did not return pollslide.com. We have almost no authority yet
  (few or no outside links).
- **AI training crawlers:** Cloudflare returns **403 to GPTBot, ClaudeBot and CCBot**. Models trained on the web
  therefore never read our site.
- **Comparison pages:** `vs-*` pages are thin (450–800 words, no FAQ). These are the pages AI answers quote for
  "X alternative".
- **Entity links:** `sameAs` is empty, so nothing ties pollslide.com to our App Store, Microsoft AppSource or social
  profiles.
- **Missing files and setup:** no `llms.txt`, and no IndexNow (instant Bing/Copilot/ChatGPT-search updates).

---

## 3. The routine

### Every time a page is added or changed (Claude does this; part of the push)
1. Run the page checklist (§4).
2. Update `sitemap.xml` (`<lastmod>` = today) and `llms.txt` if the page is a main page.
3. Stamp the cache-busting asset versions: `node scripts/qa-site-assets.js --write` (app repo).
4. **After Rod pushes:** run `node scripts/seo/indexnow.js` (app repo) to tell Bing/Copilot/Yandex the URLs changed.

### Weekly (10 min, Rod — or ask Claude "run the weekly SEO check")
- **Admin → SEO → Run scan:** fix anything red.
- **Google Search Console → Pages:** note the number of indexed pages and why any are "not indexed".
- **Search Console → Performance:** note the top queries and any new query that gets impressions. Each one is a page or
  FAQ idea.
- **AI check:** ask ChatGPT, Perplexity and Claude these three questions, and note if PollSlide is named:
  *"What's the best way to add live polls to a Keynote presentation?"*,
  *"Best Mentimeter alternative for PowerPoint?"*, *"Software to run a pub quiz with phones?"*.
  Record the answers in the log (§6).

### Monthly
- **New page:** publish one new intent page or article from the backlog (§5, Phase 2).
- **Outside listings:** add or refresh one outside listing (§5, Phase 3).
- **Facts:** re-check the comparison pages' facts against competitors' current pricing pages. Never state a competitor
  fact we haven't checked that month.

---

## 4. Page checklist (every indexable page)
- **Title:** ≤ 60 characters and contains the target phrase. **Description:** 120–160 characters. **H1:** exactly one.
- **Opening answer:** the first 2–3 sentences answer the query directly, in a way someone could quote. AI answers lift
  these sentences.
- **FAQ:** 4–6 questions people really ask, as an **FAQ block + FAQPage structured data**.
- **Links:** at least 3 internal links to related pages, and links pointing *in* from at least 2 existing pages.
- **Images:** alt text on every image. An OG image is set.
- **Facts:** stated plainly, with **no unverifiable claims** ("#1", "best") and nothing about competitors we haven't
  checked.
- **Language:** English is the indexed version. Translations are client-side, so Google sees English. This is fine
  for now.

---

## 5. Implementation plan

### Phase A — Let the machines in *(this week)*
| # | Task | Who |
|---|---|---|
| A1 | `llms.txt`: a plain summary of PollSlide and its key pages, for AI agents | Claude ✅ |
| A2 | `robots.txt`: name the search and AI crawlers explicitly, keep `/presenter` out | Claude ✅ |
| A3 | IndexNow key file + `scripts/seo/indexnow.js` (Bing → Copilot / ChatGPT search) | Claude ✅ build · Rod runs it after push |
| A4 | **Cloudflare → AI Crawl Control / "Block AI bots": allow GPTBot, ClaudeBot, CCBot** on pollslide.com | ✅ Rod 2026-10-07 — live check: all crawlers 200 |
| A5 | Search Console + Bing: **inspect and request indexing** for index, the 3 `pollslide-for-*` pages and the `vs-*` pages | **Rod** |

### Phase B — Be the quotable answer *(weeks 1–3)*
| # | Task | Who |
|---|---|---|
| B1 | Rebuild the 6 `vs-*` pages: an honest comparison table, "when to choose them / when to choose us", 5-question FAQ + FAQPage. Competitor facts checked against their live pages that day | Claude drafts · Rod approves |
| B2 | Organization `sameAs`: Mac App Store/download page, Microsoft AppSource (after approval), LinkedIn, X, YouTube — **only profiles that exist** | Rod supplies links · Claude adds |
| B3 | Add FAQ blocks to the pages that lack them: pricing, integrations, download, index | Claude |
| B4 | "Use cases" hub: classrooms, team meetings, conferences, pub quiz, training/onboarding — one page each, linked from the home page | Claude drafts |

### Phase C — Get talked about *(ongoing; the step that actually moves AI answers)*
| # | Task | Who |
|---|---|---|
| C1 | Listings: **G2, Capterra / GetApp, AlternativeTo, SaaSHub, Product Hunt launch, Slant** — same name, description and URL everywhere | **Rod** (accounts are his) · Claude writes the copy |
| C2 | Microsoft AppSource listing live (on approval) → link it from the site and `sameAs` | Rod / Claude |
| C3 | Ask 5–10 happy customers for a G2/Capterra review (a review link in the post-session email) | Rod |
| C4 | Answer real questions on Reddit / Quora / Apple and Microsoft community forums: helpful first, disclosed as the maker | Rod |
| C5 | "Billboard loop": every session shows pollslide.com/join → branded searches. Make sure /join and the brand search land on us | built ✅ — monitor |
| C6 | 2 guest posts / podcast mentions per quarter (teacher, trainer, event-planner audiences) | Rod |

### Phase D — Measure and compound *(monthly)*
- **Track:** indexed pages, impressions, clicks, the top 20 queries, and the AI-answer check results.
- **Double down:** queries with impressions but a low position get their own page or FAQ.

---

## 6. Log
| Date | Indexed (Google) | Impressions / clicks (28d) | AI check: named by? | Notes |
|---|---|---|---|---|
| 2026-10-07 | 14 indexed / 39 not (23 discovered-not-crawled, 6 alternate-canonical, 4×404, 3 crawled-not-indexed, 2 redirect, 1 duplicate); ~5 impressions/day since July | | none checked yet | Baseline. GPTBot/ClaudeBot/CCBot were blocked at Cloudflare → unblocked same day. IndexNow: 38 URLs accepted (202). |

---

## Rules
- **No tricks:** no keyword stuffing, hidden text, bought links, fake reviews or AI-spun filler pages. Google and the
  AI vendors penalise them, and they are the opposite of "works well, consistently".
- **Competitor claims:** competitor facts are checked and dated. Comparisons stay fair: say where they are better.
- **Legal pages:** stay English-authoritative and carry no product schema.
- **The app:** app pages (`app.pollslide.com`) are not marketing pages. Don't index the presenter.

---

# Part 2 — Claude's fix-it runbook

Follow this in order. Each step has the exact commands and a **done when**. Tick it off here when it's done. Don't
start a step whose "needs Rod" is still open; skip to the next step Claude can do alone.

**Before every step:**
- Only change the **website repo** (`~/Documents/GitHub/pollslide-website`), plus the scripts in `scripts/seo/` of
  this repo.
- **Never touch:**
  - the app pages;
  - the frozen PowerPoint add-in (`powerpoint-content/`, REVIEW-FREEZE);
  - the text of the legal pages.

**After every step:**
1. Run these:
   ```
   node scripts/seo/check.js
   node scripts/qa-site-assets.js --write
   node scripts/qa.js
   ```
   All must pass.
2. Tell Rod what to push.
3. After he pushes, run `node scripts/seo/indexnow.js`, but only once he says yes.

### R1 — Let the machines in (Phase A) — ✅ 2026-10-07
- [x] `llms.txt` at the site root: what PollSlide is, the 4 products, and its main pages with one line each.
- [x] `robots.txt`: names Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, GPTBot, Claude-SearchBot, ClaudeBot,
  PerplexityBot, Google-Extended, Applebot and CCBot; keeps `Disallow: /presenter`; keeps the Sitemap line.
- [x] IndexNow: a key file at the site root and `scripts/seo/indexnow.js`, which sends every sitemap URL in one request.
- [x] `scripts/seo/check.js`: the page checklist (§4) as a test, plus the crawler-access check against live pollslide.com.
- **Done when:** `check.js` passes on the repo, and the live 403 check reports which bots are still blocked.
- **Needs Rod (A4, A5):**
  - Cloudflare → pollslide.com → **AI Crawl Control** (or Security → Bots → "Block AI bots") → allow GPTBot,
    ClaudeBot and CCBot. If there is a "Manage robots.txt" option, turn it OFF (we manage our own).
  - Search Console → URL inspection → "Request indexing" for `/`, `/pollslide-for-keynote`,
    `/pollslide-for-powerpoint`, `/pollslide-for-google-slides` and `/vs-mentimeter`. Do the same in Bing
    Webmaster → URL Submission.
  - **Re-test:** `node scripts/seo/check.js --live`. All bots should show 200.

### R2 — Comparison pages become the quotable answer (B1)
Do one page per pass, in this order: `vs-mentimeter`, `vs-slido`, `vs-poll-everywhere`, `vs-kahoot`, `vs-ahaslides`,
`vs-wooclap`.
1. **Fetch the competitor's current pricing and features pages** with WebFetch. Record the date and URL in a comment
   in the page `<head>`: `<!-- facts checked YYYY-MM-DD: url -->`.
2. **Write the page:**
   - **Opening:** a 2-sentence direct answer, e.g. "PollSlide is a Mentimeter alternative that runs inside the slides
     you already have…".
   - **Comparison table:** only verifiable rows.
   - **When to pick them / when to pick us:** be honest about where they're better.
   - **FAQ + FAQPage:** 5 questions.
   - **Links:** 3+ internal links.
   - **Length:** 900–1,400 words.
3. **Translations:** add the new visible strings to `compare-translations.js`. Check `scripts/qa-i18n.js` still passes.
- **Done when:**
  - `check.js` passes for the page;
  - the facts comment is dated in the last 30 days;
  - Rod has approved the claims about the competitor. Show him the table before he pushes.

### R3 — FAQ on the money pages (B3)
- **Pages:** pricing, integrations, download, index.
- **FAQ:** 4–6 questions from real support tickets / Slidekick logs where possible.
- **Structured data:** one FAQPage per page. Don't duplicate one that's already there.
- **Done when:** `check.js` shows FAQPage on all four.

### R4 — Entity links (B2) — **needs Rod: the list of real profile URLs**
- **Where:** fill `sameAs` on the Organization in `index.html` and the blog pages.
- **What:** only URLs Rod has given. Never invent a profile.
- **Done when:** `check.js` reports `sameAs` is non-empty.

### R5 — Use-case hub (B4)
- **Pages:** `/for-teachers`, `/for-team-meetings`, `/for-conferences`, `/for-training`. Pub quiz already exists:
  `/how-to-run-a-pub-quiz`.
- **Each page:** follows §4, gets linked from the home page footer, and is added to the sitemap, `llms.txt` and the
  i18n dictionary.

### R6 — Listings copy pack (C1) — Claude writes, Rod posts
- **The pack:** one canonical name, a 1-line, 3-line and 150-word description, the category, 5 screenshots (from the
  existing marketing assets), pricing summary and logo URL.
- **Copy-ready file:** `marketing/listings-pack.md` in this repo, so it stays private.
- **Rod posts it on:** G2, Capterra, AlternativeTo, SaaSHub, Product Hunt and Slant.

### R7 — Weekly check (D) — every week, on Rod's "run the weekly SEO check"
- **Run:**
  1. `node scripts/seo/check.js --live`;
  2. Admin → SEO scan;
  3. the 3 AI questions in §3, via WebSearch.
- **Record:** add a row to the log in §6.
- **Act:** turn any new query that's getting impressions into a backlog item.

**Progress (2026-10-07):** R1 ✅ (+A4 Cloudflare ✅) · R2 ✅ all six vs-* pages rebuilt with dated facts (2026-10-07), FAQPage, fully translated; Kahoot row corrected (it now imports Keynote/PPT/PDF), Poll Everywhere free-tier claim corrected (40 people, stated exactly) · R3 ✅ (index, pricing, download, integrations all carry FAQPage) · R4 ☐ (needs Rod's profile URLs) · R5 ☐ · R6 ✅ `marketing/listings-pack.md` — Rod posts · R7 starts week of 2026-10-12

### R1b — Content AI crawlers can read without JavaScript — ✅ 2026-10-07
GPTBot/ClaudeBot/PerplexityBot read raw HTML; they don't run scripts. `/pricing` was 164 words to them (no plans, no prices, no FAQ).
`scripts/seo/prerender-pricing.js` and `prerender-download.js` write the page's own JS-built content into the HTML between
`<!-- prerender:… -->` markers (the page script still rebuilds it identically); `faq-schema.js` generates FAQPage from visible FAQs.
`check.js` fails if any of these is stale or a key page shows < 400 words without JS. **Re-run them after editing PLANS/FAQS/faqs.**
