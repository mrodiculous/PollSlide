/* Tests for the SEO checker (lib/seo.js).
 *
 * The point of this checker is to catch quiet regressions, so the tests that matter
 * most are the ones proving it does not cry wolf: attribute order must not change the
 * answer, and a page that is genuinely fine must produce zero findings. A checker
 * that reports a missing description on a page that has one sends someone to "fix"
 * working code, and after that nobody reads its output again.
 *
 * Run: node scripts/tests/seo.test.js
 */
const path = require('path');
const S = require(path.resolve(__dirname, '../../lib/seo.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const has = (r, re) => r.issues.some(i => re.test(i.msg));
const sev = (r, s) => r.issues.filter(i => i.severity === s).length;

// A page with nothing wrong with it.
const GOOD = `<!doctype html><html lang="en"><head>
  <title>Live polls for classrooms and conferences — PollSlide</title>
  <meta name="description" content="Run live polls, quizzes and surveys over any slide deck. Your audience answers on their phones and results appear on screen instantly.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://pollslide.com/">
  <meta property="og:title" content="PollSlide">
  <meta property="og:description" content="Live polls over any slide deck.">
  <meta property="og:image" content="https://pollslide.com/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"PollSlide"}</script>
</head><body><h1>Live polls</h1><img src="a.png" alt="A poll on screen"></body></html>`;

console.log('\nA page with nothing wrong produces nothing');
let g = S.analyzePage(GOOD, '/');
ok('no findings at all', g.issues.length === 0, g.issues);
ok('title read',       g.title === 'Live polls for classrooms and conferences — PollSlide');
ok('description read', /Run live polls/.test(g.description));
ok('canonical read',   g.canonical === 'https://pollslide.com/');
ok('og read',          g.og.image === 'https://pollslide.com/og.png');
ok('lang read',        g.lang === 'en');
ok('one h1 counted',   g.h1s === 1);
ok('valid JSON-LD counted, none broken', g.jsonLd === 1 && g.jsonLdBroken === 0);

console.log('\nAttribute order must not change the answer');
ok('content before name',
   S.analyzePage('<meta content="Hello there" name="description">', '/').description === 'Hello there');
ok('single quotes',
   S.analyzePage("<meta name='description' content='Hello there'>", '/').description === 'Hello there');
ok('extra attributes in between',
   S.analyzePage('<meta data-x="1" name="description" id="d" content="Hello">', '/').description === 'Hello');
ok('uppercase tag and attribute',
   S.analyzePage('<META NAME="DESCRIPTION" CONTENT="Hello">', '/').description === 'Hello');
ok('og:title via name= as well as property=',
   S.analyzePage('<meta name="og:title" content="X">', '/').og.title === 'X');
ok('a description-like string in the body is NOT picked up',
   S.analyzePage('<body>name="description" content="nope"</body>', '/').description === '');
ok('entities are decoded',
   S.analyzePage('<title>Polls &amp; quizzes</title>', '/').title === 'Polls & quizzes');
ok('whitespace in a title is collapsed',
   S.analyzePage('<title>\n  Polls\n  and quizzes\n</title>', '/').title === 'Polls and quizzes');

console.log('\nThe findings that cost traffic');
ok('noindex is an error', has(S.analyzePage('<meta name="robots" content="noindex,follow">', '/'), /not to index/));
ok('missing title is an error',
   S.analyzePage('<html></html>', '/').issues.some(i => i.severity === 'error' && /No <title>/.test(i.msg)));
ok('missing description is an error',
   S.analyzePage('<title>x</title>', '/').issues.some(i => i.severity === 'error' && /No meta description/.test(i.msg)));
ok('missing canonical is a warning, not an error',
   S.analyzePage('<title>x</title>', '/').issues.some(i => i.severity === 'warn' && /canonical/.test(i.msg)));
ok('broken JSON-LD is an error',
   has(S.analyzePage('<script type="application/ld+json">{oops}</script>', '/'), /not valid JSON/));
ok('…and is counted', S.analyzePage('<script type="application/ld+json">{oops}</script>', '/').jsonLdBroken === 1);

console.log('\nLength guidance is guidance — warnings, never errors');
const longTitle = S.analyzePage('<title>' + 'x'.repeat(90) + '</title>', '/');
ok('an over-long title warns',  has(longTitle, /will be cut off/));
ok('…and is not an error',      !longTitle.issues.some(i => i.severity === 'error' && /cut off/.test(i.msg)));
/* Short is a NOTE, not a warning. "Privacy Policy — PollSlide" is the right title at
 * 26 characters, and a checker that calls that a problem on every run gets muted. */
ok('a short title is only a note',
   S.analyzePage('<title>Hi</title>', '/').issues.some(i => i.severity === 'info' && /room to say more/.test(i.msg)));
ok('a short description is only a note',
   S.analyzePage('<meta name="description" content="Short.">', '/').issues.some(i => i.severity === 'info' && /room to say more/.test(i.msg)));
ok('…while a truncated one is a warning, because that copy is being thrown away',
   S.analyzePage('<meta name="description" content="' + 'x'.repeat(200) + '">', '/')
     .issues.some(i => i.severity === 'warn' && /cut off/.test(i.msg)));

console.log('\nStructure');
ok('no h1 warns',        has(S.analyzePage('<title>x</title>', '/'), /No <h1>/));
ok('two h1s is a note',  S.analyzePage('<h1>a</h1><h1>b</h1>', '/').issues.some(i => i.severity === 'info' && /2 <h1>/.test(i.msg)));
ok('missing lang warns', has(S.analyzePage('<html>', '/'), /lang attribute/));
ok('missing viewport warns', has(S.analyzePage('<title>x</title>', '/'), /viewport/));
ok('images without alt are counted',
   S.analyzePage('<img src="a"><img src="b" alt="ok"><img src="c">', '/').imagesNoAlt === 2);

console.log('\nrobots.txt');
let r = S.analyzeRobots('User-agent: *\nAllow: /\nSitemap: https://pollslide.com/sitemap.xml');
ok('a good one is clean',   r.issues.length === 0, r.issues);
ok('its sitemap is found',  r.sitemaps[0] === 'https://pollslide.com/sitemap.xml');
ok('missing robots.txt warns',    S.analyzeRobots('').issues.some(i => /No robots.txt/.test(i.msg)));
ok('Disallow: / is an ERROR — this is the one that hides the whole site',
   S.analyzeRobots('User-agent: *\nDisallow: /').issues.some(i => i.severity === 'error'));
ok('…but a bare "Disallow:" blocks nothing and is fine',
   !S.analyzeRobots('User-agent: *\nDisallow:\nSitemap: https://x.test/s.xml').issues.some(i => i.severity === 'error'));
ok('no sitemap line warns', S.analyzeRobots('User-agent: *\nAllow: /').issues.some(i => /does not point at a sitemap/.test(i.msg)));

console.log('\nsitemap.xml');
let sm = S.analyzeSitemap('<urlset><url><loc>https://pollslide.com/</loc></url><url><loc>https://pollslide.com/pricing</loc></url></urlset>');
ok('URLs are read',      sm.count === 2 && sm.urls[1] === 'https://pollslide.com/pricing');
ok('a good one is clean', sm.issues.length === 0, sm.issues);
ok('missing sitemap is an error', S.analyzeSitemap('').issues.some(i => i.severity === 'error'));
ok('an empty one is an error',    S.analyzeSitemap('<urlset></urlset>').issues.some(i => /no URLs/.test(i.msg)));
ok('duplicates warn',
   S.analyzeSitemap('<urlset><url><loc>https://a.test/</loc></url><url><loc>https://a.test/</loc></url></urlset>')
     .issues.some(i => /duplicate/i.test(i.msg)));
ok('http URLs warn',
   S.analyzeSitemap('<urlset><url><loc>http://a.test/</loc></url></urlset>').issues.some(i => /http, not https/.test(i.msg)));

console.log('\nCross-page checks — the ones a single page cannot see');
const a = S.analyzePage(GOOD, '/');
const b = S.analyzePage(GOOD.replace('href="https://pollslide.com/"', 'href="https://pollslide.com/pricing"'), '/pricing');
let sum = S.summarize([a, b], S.analyzeSitemap('<urlset><url><loc>https://pollslide.com/</loc></url></urlset>'),
                      S.analyzeRobots('User-agent: *\nSitemap: https://pollslide.com/sitemap.xml'),
                      { origin: 'https://pollslide.com' });
ok('two pages sharing a title is caught',       sum.issues.some(i => /Duplicate <title>/.test(i.msg)));
ok('two pages sharing a description is caught', sum.issues.some(i => /Duplicate meta description/.test(i.msg)));
ok('a page missing from the sitemap is caught', sum.issues.some(i => /Not in the sitemap: \/pricing/.test(i.msg)), sum.issues.map(i=>i.msg));
ok('a trailing slash does not count as missing',
   !S.summarize([a], S.analyzeSitemap('<urlset><url><loc>https://pollslide.com</loc></url></urlset>'), null,
                { origin: 'https://pollslide.com' }).issues.some(i => /Not in the sitemap/.test(i.msg)));
ok('every issue carries the page it is on', sum.issues.every(i => !!i.path));
ok('errors sort above warnings',
   S.summarize([S.analyzePage('<html></html>', '/x')], null, null, {}).issues[0].severity === 'error');

console.log('\nThe summary counts, and refuses to invent a score');
const clean = S.summarize([a], S.analyzeSitemap('<urlset><url><loc>https://pollslide.com/</loc></url></urlset>'),
                          S.analyzeRobots('User-agent: *\nSitemap: https://x.test/s.xml'), { origin: 'https://pollslide.com' });
ok('a clean site reports clean', clean.clean === true, clean.issues);
ok('and counts zero of everything', clean.errors === 0 && clean.warnings === 0);
ok('a broken site is not clean',   S.summarize([S.analyzePage('<html></html>', '/')], null, null, {}).clean === false);
ok('there is no made-up 0-100 score', !('score' in clean));

console.log('\nDegenerate input');
ok('empty html',    S.analyzePage('', '/').issues.length > 0);
ok('null html',     typeof S.analyzePage(null, '/').title === 'string');
ok('no pages',      S.summarize([], null, null, {}).pages === 0);
ok('null sitemap and robots', S.summarize([a], null, null, {}).errors >= 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
