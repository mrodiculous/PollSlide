// PollSlide — Legal / compliance watcher
// Vercel Serverless Function, run on a weekly Cron (see vercel.json "crons").
//
// What it does: fetches your own legal pages AND key vendors' policy pages, hashes
// each, and compares to the last run. When something changes it (a) logs an alert to
// Firebase admin/legal_alerts and (b) emails you. It NEVER edits legal text itself —
// you stay the approver. Pair it with a re-consent banner when you bump a version.
//
// Vercel env:
//   CRON_SECRET         — set this; Vercel sends it as the Authorization header on cron
//   LEGAL_ALERT_EMAIL   — where alerts go (default help@pollslide.com)
//   FIREBASE_* + NEXT_PUBLIC_APP_URL + RESEND_API_KEY (already set for other functions)
const admin = require('firebase-admin');
const crypto = require('crypto');

function getApp() {
  if (admin.apps.length) return admin.apps[0];
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

// key → { label, url, kind }. Add/remove freely.
//   kind 'ours'       — our own legal pages (a change should match a version bump we made)
//   kind 'vendor'     — subprocessor/vendor policies (review whether our Privacy needs updating)
//   kind 'tracker'    — high-churn trackers that list NEW laws as they are passed/take effect.
//                       These move constantly, so they deliberately do NOT trigger the urgent
//                       email — a source that fires every week trains you to ignore the alert.
//                       They are logged and surface in the monthly /api/compliance-digest.
//   kind 'regulation' — laws & regulator guidance worldwide (EAA, GDPR, DSA, COPPA, consumer
//                       law…). A change here means: review our docs AND our product practices.
//                       Sources are stable reference/consolidated-text pages, not news feeds,
//                       so a hash change usually means the rule or guidance itself moved.
const WATCH = {
  ours_terms:   { kind: 'ours', label: 'PollSlide — Terms',   url: 'https://pollslide.com/terms' },
  ours_privacy: { kind: 'ours', label: 'PollSlide — Privacy', url: 'https://pollslide.com/privacy' },
  ours_cookies: { kind: 'ours', label: 'PollSlide — Cookies', url: 'https://pollslide.com/cookies' },
  ours_trust:   { kind: 'ours', label: 'PollSlide — Trust & Safety', url: 'https://pollslide.com/trust-safety' },
  ours_a11y:    { kind: 'ours', label: 'PollSlide — Accessibility Statement', url: 'https://pollslide.com/accessibility' },
  ours_vpat:    { kind: 'ours', label: 'PollSlide — VPAT / Accessibility Conformance Report', url: 'https://pollslide.com/vpat' },
  ours_dpa:     { kind: 'ours', label: 'PollSlide — Data Processing Agreement', url: 'https://pollslide.com/dpa' },
  ours_subprocessors: { kind: 'ours', label: 'PollSlide — Subprocessor list', url: 'https://pollslide.com/subprocessors' },
  firebase:     { kind: 'vendor', label: 'Firebase (Google) privacy', url: 'https://firebase.google.com/support/privacy' },
  stripe:       { kind: 'vendor', label: 'Stripe privacy',     url: 'https://stripe.com/privacy' },
  vercel:       { kind: 'vendor', label: 'Vercel privacy',     url: 'https://vercel.com/legal/privacy-policy' },
  fal:          { kind: 'vendor', label: 'fal.ai terms',       url: 'https://fal.ai/terms' },
  anthropic:    { kind: 'vendor', label: 'Anthropic privacy',  url: 'https://www.anthropic.com/legal/privacy' },
  openai:       { kind: 'vendor', label: 'OpenAI privacy',     url: 'https://openai.com/policies/privacy-policy/' },
  resend:       { kind: 'vendor', label: 'Resend privacy',     url: 'https://resend.com/legal/privacy-policy' },
  // ── Worldwide rules that govern how PollSlide is marketed & sold ──
  reg_eaa:      { kind: 'regulation', label: 'European Accessibility Act (Directive 2019/882)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32019L0882' },
  reg_eaa_ec:   { kind: 'regulation', label: 'EC — European Accessibility Act policy page', url: 'https://ec.europa.eu/social/main.jsp?catId=1202' },
  reg_wcag:     { kind: 'regulation', label: 'WCAG 2.1 (W3C Recommendation)', url: 'https://www.w3.org/TR/WCAG21/' },
  reg_gdpr:     { kind: 'regulation', label: 'GDPR (Regulation 2016/679)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679' },
  reg_dsa:      { kind: 'regulation', label: 'EU Digital Services Act (Regulation 2022/2065)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32022R2065' },
  reg_ai_act:   { kind: 'regulation', label: 'EU Artificial Intelligence Act (Regulation 2024/1689)', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689' },
  reg_crd:      { kind: 'regulation', label: 'EU Consumer Rights Directive (2011/83) — 14-day withdrawal', url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32011L0083' },
  reg_coppa:    { kind: 'regulation', label: 'US FTC COPPA rule (children under 13)', url: 'https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa' },
  reg_ico_kids: { kind: 'regulation', label: "UK ICO Children's Code (Age Appropriate Design)", url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/' },
  reg_ccpa:     { kind: 'regulation', label: 'California CPPA regulations (CCPA/CPRA)', url: 'https://cppa.ca.gov/regulations/' },

  /* Added 2026-09-19. PollSlide is sold into classrooms (rosters, gradebook, student
     surveys) and to public schools/universities, and the watcher had no US education
     or US accessibility sources at all — the two bodies of law most likely to be cited
     by an institutional buyer's procurement or legal team. Colorado's AI Act was left
     out deliberately: leg.colorado.gov returns 406 to automated fetches, and a source
     that can only ever error trains you to ignore the alert mail. */
  reg_ferpa:    { kind: 'regulation', label: 'US FERPA — student education records (ED Student Privacy)', url: 'https://studentprivacy.ed.gov/ferpa' },
  reg_ppra:     { kind: 'regulation', label: 'US PPRA — surveys of students (ED Student Privacy)', url: 'https://studentprivacy.ed.gov/content/ppra' },
  reg_sopipa:   { kind: 'regulation', label: 'California SOPIPA — student online personal information (BPC 22584)', url: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22584' },
  reg_ada_web:  { kind: 'regulation', label: 'US DOJ ADA Title II web accessibility rule (public schools & universities)', url: 'https://www.ada.gov/resources/2024-03-08-web-rule/' },
  reg_508:      { kind: 'regulation', label: 'US Section 508 — laws & policies (cited in our VPAT)', url: 'https://www.section508.gov/manage/laws-and-policies/' },
  reg_wcag22:   { kind: 'regulation', label: 'WCAG 2.2 (W3C Recommendation — supersedes the 2.1 we cite)', url: 'https://www.w3.org/TR/WCAG22/' },
  reg_uk_gdpr:  { kind: 'regulation', label: 'UK ICO — UK GDPR guidance (UK diverging from EU)', url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/' },

  /* US state comprehensive privacy laws, added 2026-09-19. Roughly twenty states now have
     one in force and they bind us by where the USER sits, not where the LLC sits — so
     "we're a small US company" is not a defence. Only the states whose official statute
     pages actually answer an automated fetch are listed: Delaware, Nebraska, New Hampshire
     and Indiana all block bots or serve stubs, and a permanently-failing source is worse
     than no source. Those four ride on the tracker below and the manual review instead. */
  us_va:        { kind: 'regulation', label: 'Virginia CDPA (Code of Virginia 59.1-575)', url: 'https://law.lis.virginia.gov/vacodefull/title59.1/chapter53/' },
  us_co:        { kind: 'regulation', label: 'Colorado Privacy Act (AG resource page)', url: 'https://coag.gov/resources/colorado-privacy-act/' },
  us_ct:        { kind: 'regulation', label: 'Connecticut Data Privacy Act (CT AG)', url: 'https://portal.ct.gov/ag/sections/privacy/the-connecticut-data-privacy-act' },
  us_ut:        { kind: 'regulation', label: 'Utah Consumer Privacy Act (Utah Code 13-61)', url: 'https://le.utah.gov/xcode/Title13/Chapter61/13-61.html' },
  us_tx:        { kind: 'regulation', label: 'Texas Data Privacy & Security Act (Bus. & Com. Code 541)', url: 'https://statutes.capitol.texas.gov/Docs/BC/htm/BC.541.htm' },
  us_mn:        { kind: 'regulation', label: 'Minnesota Consumer Data Privacy Act (Minn. Stat. 325M)', url: 'https://www.revisor.mn.gov/statutes/cite/325M/' },
  us_fl:        { kind: 'regulation', label: 'Florida Digital Bill of Rights (Fla. Stat. 501.702)', url: 'https://www.flsenate.gov/Laws/Statutes/2023/501.702' },

  /* The sentinel for "a new law just went into effect somewhere" — the question individual
     statute pages cannot answer, because a statute that does not exist yet has no page. */
  track_us_states: { kind: 'tracker', label: 'IAPP — US State Privacy Legislation Tracker (new laws & effective dates)', url: 'https://iapp.org/resources/article/us-state-privacy-legislation-tracker/' },

  /* Non-EU/non-US privacy regimes, added 2026-09-19 after Rod pointed out the watcher had
     drifted US-heavy. These bind us by where the PARTICIPANT sits: an audience member
     scanning a QR in Sao Paulo, Toronto, Sydney or Zurich brings their own country's law
     with them, whatever the LLC's address says. Switzerland, Brazil and Canada-Quebec are
     doubly relevant because the marketing site already ships in de/fr/it/pt. */
  intl_br:      { kind: 'regulation', label: 'Brazil LGPD — ANPD (national data protection authority)', url: 'https://www.gov.br/anpd/pt-br' },
  intl_ca:      { kind: 'regulation', label: 'Canada PIPEDA (consolidated Act text)', url: 'https://laws-lois.justice.gc.ca/eng/acts/P-8.6/' },
  intl_ca_qc:   { kind: 'regulation', label: 'Quebec Law 25 — CAI (stricter than PIPEDA; consent + profiling)', url: 'https://www.cai.gouv.qc.ca/protection-renseignements-personnels/' },
  intl_au:      { kind: 'regulation', label: 'Australia Privacy Act 1988 — OAIC', url: 'https://www.oaic.gov.au/privacy/privacy-legislation/the-privacy-act' },
  intl_ch:      { kind: 'regulation', label: 'Switzerland revFADP — FDPIC/EDOEB', url: 'https://www.edoeb.admin.ch/en' },
  intl_jp:      { kind: 'regulation', label: 'Japan APPI — Personal Information Protection Commission', url: 'https://www.ppc.go.jp/en/' },
  intl_kr:      { kind: 'regulation', label: 'South Korea PIPA — PIPC', url: 'https://www.pipc.go.kr/eng/' },
  intl_nz:      { kind: 'regulation', label: 'New Zealand Privacy Act 2020 — Privacy Commissioner', url: 'https://www.privacy.org.nz/privacy-act-2020/' },
  intl_sg:      { kind: 'regulation', label: 'Singapore PDPA — PDPC', url: 'https://www.pdpc.gov.sg/overview-of-pdpa/the-legislation/personal-data-protection-act' },
  intl_za:      { kind: 'regulation', label: 'South Africa POPIA — Information Regulator', url: 'https://inforegulator.org.za/' },
  /* India DPDP: MeitY serves the Act only from a content-hash upload path, so this URL is
     the fragile one in the list. If it starts 404ing it shows up in the digest's error
     section rather than failing silently — replace it then, do not just delete it. */
  intl_in:      { kind: 'regulation', label: 'India DPDP Act 2023 — MeitY (fragile URL, see note)', url: 'https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf' },
};

// Normalize so trivial differences (whitespace, scripts) don't trigger false alerts.
function normalize(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function hashOf(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

async function checkOne(key, label, url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'PollSlide-LegalWatch/1.0' }, redirect: 'follow' });
    if (!r.ok) return { key, label, url, ok: false, note: 'HTTP ' + r.status };
    const text = normalize(await r.text());
    return { key, label, url, ok: true, hash: hashOf(text), len: text.length };
  } catch (e) {
    return { key, label, url, ok: false, note: e.message };
  }
}

module.exports = async function handler(req, res) {
  // Cron auth: Vercel sends Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let db;
  try { db = admin.database(getApp()); }
  catch (e) { return res.status(500).json({ error: 'Firebase admin not configured', detail: e.message }); }

  const results = await Promise.all(Object.entries(WATCH).map(([k, v]) => checkOne(k, v.label, v.url)));

  const changes = [], errors = [];
  for (const r of results) {
    if (!r.ok) { errors.push(r); continue; }
    const prevSnap = await db.ref('admin/legal_watch/' + r.key).get();
    const prev = prevSnap.exists() ? prevSnap.val() : null;
    const kind = (WATCH[r.key] && WATCH[r.key].kind) || 'vendor';
    if (prev && prev.hash && prev.hash !== r.hash) {
      changes.push({ key: r.key, label: r.label, url: r.url, kind });
    }
    await db.ref('admin/legal_watch/' + r.key).set({ hash: r.hash, url: r.url, label: r.label, kind, checkedAt: Date.now() });
  }

  // Trackers are informational: they move constantly and belong in the monthly digest,
  // not in an email that is supposed to mean "a law you rely on moved".
  const urgent = changes.filter(c => c.kind !== 'tracker');
  const informational = changes.filter(c => c.kind === 'tracker');

  if (changes.length) {
    const ts = Date.now();
    await db.ref('admin/legal_alerts/' + ts).set({ createdAt: ts, changes, urgentCount: urgent.length, status: 'open' });
    // Email the founder (best-effort) via the existing Resend endpoint.
    try {
      if (!urgent.length) throw new Error('tracker-only change — digest handles it');
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
      const kindTag = { ours: 'our page', vendor: 'vendor policy', regulation: '⚖️ LAW / REGULATION' };
      const list = urgent.map(c => `<li><a href="${c.url}">${c.label}</a> — <em>${kindTag[c.kind] || c.kind}</em></li>`).join('');
      await fetch(APP_URL + '/api/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
        body: JSON.stringify({
          type: 'notify',
          to: process.env.LEGAL_ALERT_EMAIL || 'help@pollslide.com',
          data: {
            subject: `⚖️ ${urgent.length} legal/policy page${urgent.length>1?'s':''} changed`,
            heading: 'Policy change detected',
            body: `These watched pages changed since the last check:<ul>${list}</ul>Vendor changes: review whether your Privacy Policy needs updating. Law/regulation changes: review whether your <strong>product practices AND legal docs</strong> need updating, then push a policy update from Admin → Legal if users must be re-notified.`,
          },
        }),
      });
    } catch (e) { /* alert is already logged to Firebase regardless */ }
  }

  return res.status(200).json({ checked: results.length, changed: changes.length, urgent: urgent.length, informational: informational.length, changes, errors });
};
