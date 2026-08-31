/* PollSlide — SEO & marketing health, read off the LIVE site.
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SERVER ENDPOINT
 * Two reasons, and the second is the important one:
 *   1. The marketing site is a different origin, so the browser cannot fetch it.
 *   2. It reads what is ACTUALLY DEPLOYED, not what is in the repo. The failure this
 *      exists to catch — a meta description lost in an edit, a stray noindex, a page
 *      the sitemap forgot — is a failure of what shipped. Checking source files would
 *      pass happily while the live site was broken.
 *
 * WHAT IT IS NOT: a ranking tool. It reports facts (this tag is missing, these two
 * pages share a title) and never guesses at keywords or invents a score. The analysis
 * lives in lib/seo.js and is tested against fixed HTML; this file is the network.
 *
 * GET (admin token) → { origin, pages[], sitemap, robots, summary, checklist }
 * Env: SEO_SITE_ORIGIN (defaults to https://pollslide.com), FIREBASE_*.
 * --------------------------------------------------------------------------- */
const admin = require('firebase-admin');
const { getApp, verifyToken, ADMIN_EMAILS } = require('../lib/quota');
const seo = require('../lib/seo');

// The public marketing pages. Not the app — app.pollslide.com is behind a login and
// has nothing to rank.
const PAGES = ['/', '/pricing', '/help', '/download', '/integrations', '/setup', '/status', '/join',
               '/privacy', '/terms', '/trust-safety'];

const TIMEOUT_MS = 8000;

async function get(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow',
                                 headers: { 'user-agent': 'PollSlideSEOCheck/1.0' } });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body, finalUrl: r.url || url };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET only' });

  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: 'No auth token' });
  let who;
  try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }
  if (!ADMIN_EMAILS.includes(who.email)) return res.status(403).json({ error: 'Admins only' });

  const origin = (process.env.SEO_SITE_ORIGIN || 'https://pollslide.com').replace(/\/+$/, '');

  try {
    // All at once — eleven pages one after another would sit near the function's
    // time limit for no reason.
    const [robotsRes, sitemapRes, ...pageRes] = await Promise.all([
      get(origin + '/robots.txt'),
      get(origin + '/sitemap.xml'),
      ...PAGES.map(p => get(origin + p)),
    ]);

    const robots  = seo.analyzeRobots(robotsRes.ok ? robotsRes.body : '');
    const sitemap = seo.analyzeSitemap(sitemapRes.ok ? sitemapRes.body : '');

    const pages = [];
    pageRes.forEach((r, i) => {
      const path = PAGES[i];
      if (!r.ok) {
        // A page that does not load is not an SEO finding, it is an outage. Say so
        // in those words rather than reporting eleven missing meta tags.
        pages.push({ path, unreachable: true, status: r.status, title: '', description: '',
                     og: {}, issues: [{ severity: 'error',
                       msg: `Page did not load (${r.status || 'no response'}).`,
                       fix: r.error ? 'Fetch failed: ' + r.error : 'Check the page is deployed and reachable.' }] });
        return;
      }
      pages.push(seo.analyzePage(r.body, path));
    });

    const summary = seo.summarize(pages, sitemap, robots, { origin });

    /* The things a machine cannot do, kept beside the things it can — so the one
     * place someone looks for "is our SEO OK" also tells them what is waiting on
     * them. Search Console verification in particular can only be done by the owner
     * of the Google account, and it is the step most often forgotten. */
    const checklist = [
      { id: 'sitemap_submitted', label: 'Submit sitemap.xml in Google Search Console',
        detail: 'One-off, and nothing indexes reliably until it is done.',
        link: 'https://search.google.com/search-console', owner: true },
      { id: 'bing_submitted', label: 'Submit the same sitemap to Bing Webmaster Tools',
        detail: 'Bing also feeds DuckDuckGo and Copilot.',
        link: 'https://www.bing.com/webmasters', owner: true },
      { id: 'ga_or_plausible', label: 'Confirm analytics is recording',
        detail: 'You cannot tell whether any of this worked without it.', owner: true },
      { id: 'og_preview', label: 'Paste the homepage link into Slack and LinkedIn',
        detail: 'The only real test of the Open Graph tags is what the card looks like.',
        link: 'https://www.linkedin.com/post-inspector/', owner: true },
    ];

    // Record each run so drift is visible over time rather than only at the moment
    // someone happens to look.
    try {
      await admin.database(getApp()).ref('admin/seo_log').push({
        at: Date.now(), by: who.email, origin,
        errors: summary.errors, warnings: summary.warnings, pages: summary.pages,
      });
    } catch (e) { /* logging must never fail the report */ }

    return res.status(200).json({ ok: true, origin, checkedAt: Date.now(),
                                  pages, sitemap, robots, summary, checklist });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
