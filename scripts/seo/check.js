#!/usr/bin/env node
/* PollSlide website — search & AI discovery check (SEO-AI-DISCOVERY-SOP.md §4 as code).
 *   node scripts/seo/check.js          → repo checks: FAIL = must fix before push; TODO = the runbook's open work
 *   node scripts/seo/check.js --live   → also asks live pollslide.com as each search/AI crawler
 * Exit 1 only on FAIL (or a live crawler that search depends on being blocked). */
'use strict';
const fs = require('fs'), path = require('path');
const SITE = process.env.WEBSITE_DIR || path.join(process.env.HOME, 'Documents/GitHub/pollslide-website');
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
const fails = [], todos = [];
const fail = (m) => fails.push(m), todo = (m) => todos.push(m);

// ── sitemap ↔ files
const sitemap = read('sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>https:\/\/pollslide\.com([^<]*)<\/loc>/g)].map(m => m[1] || '/');
const fileFor = u => u === '/' ? 'index.html' : (u.endsWith('/blog') ? 'blog/index.html' : u.slice(1) + '.html');
if ((sitemap.match(/<url>/g) || []).length !== (sitemap.match(/<lastmod>/g) || []).length) fail('sitemap: every <url> needs a <lastmod>');
const LEGAL = new Set(['terms', 'privacy', 'cookies', 'dpa', 'subprocessors', 'vpat', 'accessibility', 'trust-safety']);
const MONEY = ['index', 'pricing', 'integrations', 'download', 'pollslide-for-powerpoint', 'pollslide-for-google-slides', 'pollslide-for-keynote'];

const pages = {};
for (const u of locs) {
  const f = fileFor(u);
  if (!fs.existsSync(path.join(SITE, f))) { fail(`sitemap lists ${u} but ${f} does not exist`); continue; }
  const s = read(f), name = f.replace(/\.html$/, '');
  const title = ((s.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').replace(/&amp;/g, '&').trim();
  const desc = (s.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const h1 = (s.match(/<h1[\s>]/g) || []).length;
  const canon = (s.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  const words = s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  pages[name] = { s, words };
  if (!title) fail(`${f}: no <title>`); else if (title.length > 70) fail(`${f}: title ${title.length} chars (> 70 gets cut)`);
  if (!desc) fail(`${f}: no meta description`);
  else if (!LEGAL.has(name) && (desc.length < 100 || desc.length > 210)) fail(`${f}: description ${desc.length} chars (aim 120–160)`);
  if (h1 !== 1) fail(`${f}: ${h1} <h1> (needs exactly 1)`);
  if (!canon) fail(`${f}: no canonical`);
  else if (canon.replace(/\/$/, '') !== ('https://pollslide.com' + (u === '/' ? '' : u)).replace(/\/$/, '')) fail(`${f}: canonical ${canon} ≠ ${u}`);
  if (/<meta[^>]+name="robots"[^>]+noindex/i.test(s)) fail(`${f}: noindex but listed in sitemap`);
  if (LEGAL.has(name) && /"@type":\s*"SoftwareApplication"/.test(s)) fail(`${f}: legal page carries product schema`);
  if ((s.match(/<img\b(?![^>]*\balt=)[^>]*>/g) || []).length) fail(`${f}: image without alt`);
  for (const m of s.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); } catch (e) { fail(`${f}: structured data is not valid JSON`); } }
}

// ── robots / llms / IndexNow
const robots = read('robots.txt');
if (!/^Sitemap: https:\/\/pollslide\.com\/sitemap\.xml/m.test(robots)) fail('robots.txt: Sitemap line missing');
if (!/Disallow: \/presenter/.test(robots)) fail('robots.txt: must keep /presenter out');
if (/Disallow: \/\s*$/m.test(robots)) fail('robots.txt: something is disallowing the whole site');
if (!fs.existsSync(path.join(SITE, 'llms.txt'))) fail('llms.txt missing');
else for (const m of read('llms.txt').matchAll(/\]\(https:\/\/pollslide\.com([^)]*)\)/g)) { const u = m[1] || '/'; if (!locs.includes(u) && u !== '/join') fail(`llms.txt links ${u}, which is not in the sitemap`); }
const keyFile = fs.readdirSync(SITE).find(f => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile || read(keyFile).trim() !== keyFile.slice(0, 32)) fail('IndexNow key file missing or wrong content');

// ── content that AI crawlers can read without running JavaScript (GPTBot/ClaudeBot/Perplexity don't)
const { spawnSync } = require('child_process');
for (const [script, args] of [['prerender-pricing.js', ['--check']], ['prerender-download.js', ['--check']], ['faq-schema.js', ['--check', 'index.html', 'integrations.html', 'vs-mentimeter.html', 'vs-slido.html', 'vs-kahoot.html', 'vs-poll-everywhere.html', 'vs-ahaslides.html', 'vs-wooclap.html']]]) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { encoding: 'utf8', env: { ...process.env, WEBSITE_DIR: SITE } });
  if (r.status !== 0) fail((r.stderr || r.stdout).trim().split('\n').pop());
}
const noJsWords = f => fs.readFileSync(path.join(SITE, f), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--(?!\s*prerender)[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
for (const f of ['index.html', 'pricing.html', 'download.html', 'integrations.html']) if (noJsWords(f) < 400) fail(`${f}: only ${noJsWords(f)} words visible without JavaScript — AI crawlers see an empty page`);

// ── runbook TODOs (not failures — the open work in SEO-AI-DISCOVERY-SOP.md Part 2)
for (const n of Object.keys(pages).filter(n => n.startsWith('vs-'))) {
  const p = pages[n];
  if (p.words < 900) todo(`R2 ${n}: ${p.words} words (aim 900–1,400)`);
  if (!/"FAQPage"/.test(p.s)) todo(`R2 ${n}: no FAQ / FAQPage`);
  const d = (p.s.match(/<!-- facts checked (\d{4}-\d{2}-\d{2})/) || [])[1];
  if (!d || (Date.now() - Date.parse(d)) / 864e5 > 31) todo(`R2 ${n}: competitor facts not checked in the last 30 days`);
}
for (const n of MONEY.filter(n => n === 'index' || ['pricing', 'integrations', 'download'].includes(n))) if (pages[n] && !/"FAQPage"/.test(pages[n].s)) todo(`R3 ${n}: no FAQ / FAQPage`);
if (/"sameAs":\s*\[\s*\]/.test(read('index.html'))) todo('R4 index: Organization sameAs is empty (needs Rod\'s real profile links)');

async function live() {
  const BOTS = { Googlebot: 'Googlebot/2.1', Bingbot: 'bingbot/2.0', Applebot: 'Applebot/0.1', 'OAI-SearchBot': 'OAI-SearchBot/1.0', 'ChatGPT-User': 'ChatGPT-User/1.0', 'Claude-SearchBot': 'Claude-SearchBot/1.0', PerplexityBot: 'PerplexityBot/1.0', GPTBot: 'GPTBot/1.2', ClaudeBot: 'ClaudeBot/1.0', CCBot: 'CCBot/2.0' };
  const SEARCH = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'];
  console.log('\nLive pollslide.com as each crawler:');
  for (const [name, ua] of Object.entries(BOTS)) {
    let st = 0; try { st = (await fetch('https://pollslide.com/vs-mentimeter', { headers: { 'User-Agent': `Mozilla/5.0 (compatible; ${ua})` }, redirect: 'manual' })).status; } catch (e) {}
    const ok = st === 200;
    console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(17)} ${st}${ok ? '' : SEARCH.includes(name) ? '  ← SEARCH BLOCKED' : '  ← blocked at Cloudflare (Rod: AI Crawl Control)'}`);
    if (!ok && SEARCH.includes(name)) fail(`live: ${name} gets ${st}`);
    if (!ok && !SEARCH.includes(name)) todo(`A4 live: ${name} gets ${st} — Cloudflare AI-bot block`);
  }
  for (const f of ['robots.txt', 'llms.txt', 'sitemap.xml']) { const r = await fetch('https://pollslide.com/' + f); console.log(`  ${r.ok ? '✓' : '✗'} /${f} ${r.status}`); if (!r.ok) todo(`live: /${f} is ${r.status} (pushed yet?)`); }
}

(async () => {
  if (process.argv.includes('--live')) await live();
  console.log(`\nSEO check — ${locs.length} sitemap pages`);
  if (fails.length) { console.log(`\n✗ ${fails.length} must fix:`); fails.forEach(m => console.log('  ✗ ' + m)); }
  else console.log('  ✓ every page passes the checklist');
  if (todos.length) { console.log(`\n☐ ${todos.length} open runbook items:`); todos.forEach(m => console.log('  ☐ ' + m)); }
  process.exit(fails.length ? 1 : 0);
})();
