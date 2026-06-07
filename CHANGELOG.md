# PollSlide Changelog
## Deployed to: app.pollslide.com (pollslide repo) + pollslide.com (pollslide-website repo)

---

## v41 — 2026-06-07

### pollslide-website repo
**pricing.html** — Critical layout fixes
- Replaced CSS class-based font sizing (.price-val.med) with bulletproof inline styles
  - "Free" label: 36px Syne 800, fits card cleanly
  - "Custom" label: 24px Syne 800, no overflow
  - "$12" and "$39": unchanged 40px
- Fixed equal-height cards: CSS grid align-items:stretch, flex-direction:column on cards
- Fixed price-block height: removed fixed 56px height, use min-height instead
- Visual result: all 4 plan cards are same height, prices are proportional

**index.html** — Homepage feature showcase
- Added "Works with your tools" integration section (Keynote, PowerPoint, Google Slides)
- Added live product feature highlights with icons
- Updated CTA sections for clarity

### pollslide repo
**presenter.html** — Multiple improvements
- Plan comparison modal: full redesign showing all 4 plans with feature comparison,
  monthly/annual toggle, current plan indicator, direct Stripe checkout integration
- Post-payment toast: fixed by using sessionStorage instead of DOMContentLoaded
  (DOMContentLoaded may already have fired when URL params are read)
- Contact support modal: already built in v40, confirmed deployed

**admin.html** — Logo consistency
- Replaced old s-dot + text logo with SVG brand mark matching all other pages

---

## v40 — Previous session
- Stripe webhook handler (api/stripe-webhook.js)
- Stripe checkout creator (api/create-checkout.js)
- Account deletion API (api/delete-account.js)
- Transactional email system (api/send-email.js)
- Admin panel: user sync, ticket improvements, legal quick actions
- Response reports modal with CSV export
- Safari auth fix (SESSION persistence + token heartbeat)
- Security trust section on homepage
- Free/Pro/Team/White Label tier limits

---

## v39 — Previous session
- Admin panel full rebuild (users, tickets, messages, flows, legal actions, AI mgmt)
- GDPR compliance pages (terms, privacy, cookies, consent banner)
- Cookie consent banner (consent.js)
- Setup guide page (/setup)
- Pricing page (/pricing) — initial build
- Download page (/download)

---

## v38 — Previous session
- Brand identity: PollSlide logo SVG + PNG icons (16/32/64/80/192/512px) + favicon
- Free-tier limits with upgrade prompts
- User dropdown menu (replaced prompt() dialogs)
- Response reveal fix: by question type, not correctAnswer presence
- Confetti on reveal
- Merged reveal/countdown control

---

## v37 and earlier
- Core presenter, answer, companion, admin pages
- Firebase auth, presentations, questions, sessions
- QR auto-detect companion (Mac)
- PowerPoint add-in (manifest.xml + powerpoint.html)
- Legal compliance foundation
