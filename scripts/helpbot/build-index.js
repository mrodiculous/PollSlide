#!/usr/bin/env node
/* Slidekick's map of the help centre (2026-10-01).
 *
 *   node scripts/helpbot/build-index.js          → writes lib/help-index.json
 *   node scripts/helpbot/build-index.js --check  → exits 1 if the file is out of date
 *
 * Built from the REAL help pages in ../pollslide-website, never written by hand, so
 * Slidekick can only ever point at help that exists:
 *   • every <section id> of help.html, and every <h3 id> sub-section inside one
 *   • every FAQ / troubleshooting <details> question, with its exact answer text
 *   • the stand-alone guide pages (getting started, account settings, team setup…)
 * Run it after changing help copy; the QA gate (scripts/tests/helpbot.test.js) fails
 * while the index is stale, the same way the asset stamps work. */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.resolve(ROOT, '..', 'pollslide-website');
const OUT = path.join(ROOT, 'lib', 'help-index.json');
const BASE = 'https://pollslide.com';

const ent = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘', '&ldquo;': '“', '&rdquo;': '”', '&hellip;': '…', '&rarr;': '→', '&times;': '×', '&middot;': '·' };
const text = h => String(h)
  .replace(/<(script|style|svg|video|figure)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z#0-9]+;/gi, m => ent[m] || (m.startsWith('&#') ? String.fromCodePoint(parseInt(m.slice(2).replace(/^x/i, '0x'))) : ' '))
  .replace(/\s+/g, ' ').trim();
const cut = (s, n) => s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…';

function helpTopics() {
  const html = fs.readFileSync(path.join(SITE, 'help.html'), 'utf8');
  const out = [];
  const secRe = /<section id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g;
  let m;
  while ((m = secRe.exec(html))) {
    const [, id, body] = m;
    const h2 = (body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
    const title = text(h2 || id);
    // FAQ / troubleshooting questions: one entry each, with the exact answer.
    const dets = [...body.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)];
    dets.forEach((d, i) => out.push({ id: `${id}.q${i + 1}`, url: `${BASE}/help#${id}`, kind: 'faq',
      title: text(d[1]), section: title, text: cut(text(d[2]), 900) }));
    // Sub-sections with their own anchor.
    const parts = body.split(/(?=<h3 id=")/);
    const intro = parts.shift();
    out.push({ id, url: `${BASE}/help#${id}`, kind: 'section', title,
      text: cut(text(intro.replace(/<details[\s\S]*?<\/details>/g, ' ').replace(/<h2[\s\S]*?<\/h2>/, ' ')), 1200) });
    for (const p of parts) {
      const sid = (p.match(/^<h3 id="([^"]+)"/) || [])[1];
      const h3 = text((p.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || sid);
      out.push({ id: sid, url: `${BASE}/help#${sid}`, kind: 'section', title: h3, section: title,
        text: cut(text(p.replace(/<details[\s\S]*?<\/details>/g, ' ').replace(/<h3[\s\S]*?<\/h3>/, ' ')), 1200) });
    }
  }
  return out;
}

/* Stand-alone guide pages: the page's own heading, lead and main text. */
const GUIDES = ['getting-started', 'account-help', 'team-setup', 'powerpoint-live', 'setup', 'integrations',
  'game-modes', 'study-games', 'loopslide', 'pollslide-for-keynote', 'pollslide-for-google-slides',
  'pollslide-for-powerpoint', 'pricing', 'download', 'join', 'mac-update', 'reorder-questions'];
function guideTopics() {
  return GUIDES.filter(g => fs.existsSync(path.join(SITE, g + '.html'))).map(g => {
    const html = fs.readFileSync(path.join(SITE, g + '.html'), 'utf8');
    const main = (html.match(/<main[\s\S]*?<\/main>/) || html.match(/<body[\s\S]*?<\/body>/) || [html])[0]
      .replace(/<nav[\s\S]*?<\/nav>/g, ' ').replace(/<footer[\s\S]*?<\/footer>/g, ' ');
    const h1 = text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || g);
    const lead = text((html.match(/<p class="lead"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '');
    return { id: 'page:' + g, url: `${BASE}/${g}`, kind: 'page', title: h1, text: cut((lead ? lead + ' ' : '') + text(main), 1400) };
  });
}

/* Topic titles in the user's language, taken from the site's own dictionary (translations.js,
   keyed by the exact English text — the same strings the help page shows when translated).
   Only exact matches: a title with no entry stays English rather than being guessed. */
function siteDict() {
  try {
    const vm = require('vm'); const ctx = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(SITE, 'translations.js'), 'utf8'), ctx);
    return ctx.window.PS_I18N || {};
  } catch (e) { return {}; }
}
function build() {
  const topics = [...helpTopics(), ...guideTopics()];
  const D = siteDict();
  topics.forEach(t => {
    const tr = {};
    for (const l of ['es', 'de', 'fr', 'pt', 'it']) { const v = D[l] && D[l][t.title]; if (v && v !== t.title) tr[l] = v; }
    if (Object.keys(tr).length) t.titles = tr;
  });
  const ids = new Set();
  topics.forEach(t => { if (ids.has(t.id)) throw new Error('duplicate topic id ' + t.id); ids.add(t.id); });
  return JSON.stringify({ _note: 'GENERATED by scripts/helpbot/build-index.js from pollslide-website — do not edit by hand.', topics }, null, 1) + '\n';
}

if (require.main === module) {
  if (!fs.existsSync(path.join(SITE, 'help.html'))) { console.error('pollslide-website not found next to this repo'); process.exit(1); }
  const fresh = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== fresh) { console.error('lib/help-index.json is out of date — run: node scripts/helpbot/build-index.js'); process.exit(1); }
    console.log('help index up to date'); process.exit(0);
  }
  fs.writeFileSync(OUT, fresh);
  const t = JSON.parse(fresh).topics;
  console.log(`wrote lib/help-index.json — ${t.length} topics (${t.filter(x => x.kind === 'section').length} sections, ${t.filter(x => x.kind === 'faq').length} FAQ, ${t.filter(x => x.kind === 'page').length} guide pages), ${Math.round(fresh.length / 1024)} KB`);
}
module.exports = { build };
