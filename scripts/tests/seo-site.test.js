#!/usr/bin/env node
/* Website search & AI discovery (SEO-AI-DISCOVERY-SOP.md): every sitemap page passes the page
 * checklist, robots/llms/IndexNow are in place. Runs scripts/seo/check.js without --live.
 * Run: node scripts/tests/seo-site.test.js */
const { spawnSync } = require('child_process'), path = require('path'), fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x ? '\n' + x : '')));
const SITE = process.env.WEBSITE_DIR || path.join(process.env.HOME, 'Documents/GitHub/pollslide-website');
console.log('\nWebsite: search & AI discovery');
if (!fs.existsSync(path.join(SITE, 'sitemap.xml'))) { console.log('  (website repo not found — skipped)\n\n0 passed, 0 failed'); process.exit(0); }
const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'seo', 'check.js')], { encoding: 'utf8' });
ok('every sitemap page passes the checklist; robots, llms.txt and the IndexNow key are in place', r.status === 0, r.stdout);
const robots = fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8');
ok('robots.txt names the AI answer engines and keeps /presenter out', ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'GPTBot', 'ClaudeBot'].every(b => robots.includes(b)) && (robots.match(/Disallow: \/presenter/g) || []).length >= 2);
ok('the SOP stays private (app repo, *.md never deployed)', !fs.existsSync(path.join(SITE, 'SEO-AI-DISCOVERY-SOP.md')) && /^\*\.md$/m.test(fs.readFileSync(path.join(__dirname, '..', '..', '.vercelignore'), 'utf8')));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
