/* PollSlide — what a search engine and a shared link actually see.
 * ---------------------------------------------------------------------------
 * SEO work fails quietly. A page loses its meta description in a copy-paste, two
 * pages end up with the same <title>, a `noindex` left over from staging ships to
 * production — and nothing breaks, nothing errors, no test fails. You find out
 * months later from a traffic graph.
 *
 * So this is a checker, not an optimiser. It reports what is measurable and true:
 * what tags exist, how long they are, whether they are unique, whether the sitemap
 * and the pages agree with each other. It does not guess at keywords or score
 * "quality" — that is judgement, and a number pretending to be judgement is worse
 * than no number.
 *
 * PURE ON PURPOSE: no fetch in here. The endpoint does the network, this does the
 * reading, and so the whole thing is testable against fixed HTML.
 *
 * ONE DELIBERATE NON-CHECK: hreflang. The marketing site translates in the browser
 * from one URL per page rather than serving /es/ /de/ variants, so there is nothing
 * for hreflang to point at. Flagging its absence would be reporting a bug in a
 * decision. See the marketing-site-i18n notes.
 * --------------------------------------------------------------------------- */

// Search results truncate around these. They are guidance, not rules — hence 'warn'.
const TITLE_MIN = 30, TITLE_MAX = 60;
const DESC_MIN = 120, DESC_MAX = 160;

const SEVERITY = ['error', 'warn', 'info'];

const strip = (s) => String(s == null ? '' : s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/* Attribute order is not fixed and never has been: <meta content="…" name="description">
 * is as valid as the other way round. A regex that only matches one order silently
 * reports a missing description on a page that has one — the worst kind of checker
 * output, because it sends someone to "fix" something that is not broken. */
function metaContent(html, attr, value) {
  const v = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const named = new RegExp(`\\b${attr}\\s*=\\s*["']${v}["']`, 'i').test(tag);
    if (!named) continue;
    const m = /\bcontent\s*=\s*["']([\s\S]*?)["']/i.exec(tag);
    if (m) return strip(m[1]);
  }
  return '';
}

function tagText(html, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(String(html || ''));
  return m ? strip(m[1].replace(/<[^>]+>/g, ' ')) : '';
}

function linkHref(html, rel) {
  const tags = String(html || '').match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!new RegExp(`\\brel\\s*=\\s*["']${rel}["']`, 'i').test(tag)) continue;
    const m = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (m) return strip(m[1]);
  }
  return '';
}

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try { out.push({ ok: true, data: JSON.parse(m[1]) }); }
    catch (e) { out.push({ ok: false, error: e.message }); }
  }
  return out;
}

/** Read one page. `path` is only used in messages. */
function analyzePage(html, path) {
  const h = String(html || '');
  const issue = [];
  const add = (severity, msg, fix) => issue.push({ severity, msg, fix });

  const title = tagText(h, 'title');
  const description = metaContent(h, 'name', 'description');
  const canonical = linkHref(h, 'canonical');
  const robots = metaContent(h, 'name', 'robots');
  const og = {
    title: metaContent(h, 'property', 'og:title') || metaContent(h, 'name', 'og:title'),
    description: metaContent(h, 'property', 'og:description') || metaContent(h, 'name', 'og:description'),
    image: metaContent(h, 'property', 'og:image') || metaContent(h, 'name', 'og:image'),
    url: metaContent(h, 'property', 'og:url') || metaContent(h, 'name', 'og:url'),
  };
  const twitter = metaContent(h, 'name', 'twitter:card');
  const lang = (/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(h) || [])[1] || '';
  const viewport = metaContent(h, 'name', 'viewport');
  const h1s = (h.match(/<h1\b/gi) || []).length;
  const ld = jsonLdBlocks(h);
  const imgs = h.match(/<img\b[^>]*>/gi) || [];
  const imgsNoAlt = imgs.filter(t => !/\balt\s*=/i.test(t)).length;

  // ── the ones that cost traffic ────────────────────────────────────────────
  if (/noindex/i.test(robots)) {
    add('error', 'This page tells search engines not to index it.',
        'Remove noindex from the robots meta tag — unless this page is deliberately private.');
  }
  if (!title) add('error', 'No <title>.', 'Add a <title>. It is the headline of every search result.');
  if (!description) add('error', 'No meta description.',
    'Add <meta name="description">. Without one the search engine invents a snippet from the page text.');
  if (!canonical) add('warn', 'No canonical URL.',
    'Add <link rel="canonical">. It tells search engines which URL is the real one when a page is reachable more than one way.');

  // ── length: guidance, so warn ─────────────────────────────────────────────
  /* Two different things, and they deserve different weight. TOO LONG means copy that
   * was already written is being thrown away by the search result — a real loss, and
   * one nobody chose. TOO SHORT is only an unused opportunity, and often not even
   * that: "Privacy Policy — PollSlide" is exactly the right title at 26 characters,
   * and warning about it every run teaches people to ignore the warnings. */
  if (title && title.length > TITLE_MAX) add('warn', `Title is ${title.length} characters — it will be cut off around ${TITLE_MAX}.`);
  if (title && title.length < TITLE_MIN) add('info', `Title is only ${title.length} characters — there is room to say more.`);
  if (description && description.length > DESC_MAX) add('warn', `Description is ${description.length} characters — it will be cut off around ${DESC_MAX}.`);
  if (description && description.length < DESC_MIN) add('info', `Description is only ${description.length} characters — there is room to say more.`);

  // ── how the link looks when someone shares it ─────────────────────────────
  if (!og.title || !og.description) add('warn', 'Incomplete Open Graph tags.',
    'Add og:title and og:description. These are what people see when the link is pasted into Slack, WhatsApp or LinkedIn.');
  if (!og.image) add('warn', 'No og:image.', 'Add one. A shared link with no image is a grey box.');
  if (!twitter) add('info', 'No twitter:card.', 'Add <meta name="twitter:card" content="summary_large_image">.');

  // ── structure ─────────────────────────────────────────────────────────────
  if (h1s === 0) add('warn', 'No <h1>.', 'Every page needs one main heading.');
  if (h1s > 1) add('info', `${h1s} <h1> headings.`, 'One main heading per page reads more clearly to a crawler.');
  if (!lang) add('warn', 'No lang attribute on <html>.', 'Add lang="en".');
  if (!viewport) add('warn', 'No viewport meta tag.', 'Without it the page is not mobile-friendly, which affects ranking.');
  if (imgsNoAlt) add('info', `${imgsNoAlt} image${imgsNoAlt === 1 ? '' : 's'} without alt text.`,
    'Alt text is for screen readers first and search engines second — both matter.');
  ld.filter(b => !b.ok).forEach(b => add('error', 'Structured data (JSON-LD) is not valid JSON.',
    'Fix the ld+json block — a broken one is ignored entirely: ' + b.error));

  return {
    path, title, description, canonical, robots, og, twitter, lang, h1s,
    jsonLd: ld.length, jsonLdBroken: ld.filter(b => !b.ok).length,
    images: imgs.length, imagesNoAlt: imgsNoAlt,
    titleLen: title.length, descriptionLen: description.length,
    issues: issue,
  };
}

/** robots.txt: is anything blocked, and does it point at the sitemap? */
function analyzeRobots(txt) {
  const t = String(txt || '');
  const issues = [];
  const sitemaps = [...t.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map(m => m[1]);
  // "Disallow: /" under a wildcard agent blocks the entire site. It is one character
  // away from "Disallow:" which blocks nothing, which is why it is worth a hard error.
  const blocksEverything = /user-agent\s*:\s*\*[\s\S]*?disallow\s*:\s*\/\s*(\n|$)/i.test(t);
  if (!t.trim()) issues.push({ severity: 'warn', msg: 'No robots.txt.', fix: 'Add one, even if it allows everything — crawlers ask for it either way.' });
  if (blocksEverything) issues.push({ severity: 'error', msg: 'robots.txt blocks the whole site (Disallow: /).', fix: 'Remove it unless the site is meant to be invisible.' });
  if (t.trim() && !sitemaps.length) issues.push({ severity: 'warn', msg: 'robots.txt does not point at a sitemap.', fix: 'Add a "Sitemap: https://…/sitemap.xml" line.' });
  return { exists: !!t.trim(), sitemaps, blocksEverything, issues };
}

/** sitemap.xml: which URLs it claims. */
function analyzeSitemap(xml) {
  const t = String(xml || '');
  const issues = [];
  const urls = [...t.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map(m => strip(m[1]));
  if (!t.trim()) issues.push({ severity: 'error', msg: 'No sitemap.xml.', fix: 'Add one and submit it in Google Search Console.' });
  else if (!urls.length) issues.push({ severity: 'error', msg: 'sitemap.xml has no URLs in it.' });
  const dupes = urls.filter((u, i) => urls.indexOf(u) !== i);
  if (dupes.length) issues.push({ severity: 'warn', msg: `${dupes.length} duplicate URL(s) in the sitemap.`, fix: 'Each page should appear once.' });
  const http = urls.filter(u => /^http:\/\//i.test(u));
  if (http.length) issues.push({ severity: 'warn', msg: `${http.length} sitemap URL(s) use http, not https.` });
  return { exists: !!t.trim(), urls, count: urls.length, issues };
}

/* Cross-page checks. Uniqueness cannot be judged one page at a time — two pages each
 * having a perfectly good title is exactly how you end up with two identical ones. */
function summarize(pages, sitemap, robots, opts) {
  const o = opts || {};
  const issues = [];
  const byTitle = {}, byDesc = {};
  pages.forEach(p => {
    if (p.title) (byTitle[p.title] = byTitle[p.title] || []).push(p.path);
    if (p.description) (byDesc[p.description] = byDesc[p.description] || []).push(p.path);
  });
  Object.entries(byTitle).filter(([, v]) => v.length > 1).forEach(([t, v]) =>
    issues.push({ severity: 'warn', msg: `Duplicate <title> on ${v.join(', ')}`, fix: `Give each page its own title. Both currently say "${t}".` }));
  Object.entries(byDesc).filter(([, v]) => v.length > 1).forEach(([, v]) =>
    issues.push({ severity: 'warn', msg: `Duplicate meta description on ${v.join(', ')}`, fix: 'Write a distinct description per page.' }));

  // Pages the sitemap forgot, and sitemap entries that are not real pages.
  if (sitemap && sitemap.exists && o.origin) {
    const inMap = new Set(sitemap.urls.map(u => u.replace(/\/+$/, '')));
    const missing = pages.filter(p => {
      const full = (o.origin + (p.path === '/' ? '' : p.path)).replace(/\/+$/, '');
      return !inMap.has(full) && !inMap.has(full + '/');
    }).map(p => p.path);
    if (missing.length) issues.push({ severity: 'warn', msg: `Not in the sitemap: ${missing.join(', ')}`, fix: 'Add these pages to sitemap.xml so they get crawled.' });
  }

  const all = pages.flatMap(p => p.issues.map(i => ({ ...i, path: p.path })))
                   .concat((sitemap ? sitemap.issues : []).map(i => ({ ...i, path: '/sitemap.xml' })))
                   .concat((robots ? robots.issues : []).map(i => ({ ...i, path: '/robots.txt' })))
                   .concat(issues.map(i => ({ ...i, path: 'site-wide' })));

  const count = (s) => all.filter(i => i.severity === s).length;
  return {
    pages: pages.length,
    errors: count('error'), warnings: count('warn'), notes: count('info'),
    // Deliberately not a 0–100 "SEO score". Errors are countable facts; a score would
    // be a made-up number that people then optimise instead of the actual problems.
    clean: count('error') === 0 && count('warn') === 0,
    issues: all.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity)),
  };
}

module.exports = {
  TITLE_MIN, TITLE_MAX, DESC_MIN, DESC_MAX,
  analyzePage, analyzeRobots, analyzeSitemap, summarize,
  __test: { metaContent, tagText, linkHref, jsonLdBlocks, strip },
};
