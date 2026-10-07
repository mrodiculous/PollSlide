#!/usr/bin/env node
/* Tell Bing (→ Copilot, ChatGPT search), Yandex, Seznam and Naver that pollslide.com pages changed.
 * IndexNow: one POST with every sitemap URL. Run AFTER the website push is live.
 *   node scripts/seo/indexnow.js          → submits
 *   node scripts/seo/indexnow.js --dry    → lists what it would submit
 * The key file <KEY>.txt lives at the website root; IndexNow fetches it to prove we own the host.
 * See SEO-AI-DISCOVERY-SOP.md. */
'use strict';
const fs = require('fs'), path = require('path');
const KEY = '1205080561c6251d9ed16aced7245136';
const HOST = 'pollslide.com';
const SITE = process.env.WEBSITE_DIR || path.join(process.env.HOME, 'Documents/GitHub/pollslide-website');
const urls = [...fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
if (!urls.length) { console.error('✗ No URLs in sitemap.xml'); process.exit(1); }
if (process.argv.includes('--dry')) { console.log(urls.join('\n') + `\n(${urls.length} URLs — dry run, nothing sent)`); process.exit(0); }
(async () => {
  const kr = await fetch(`https://${HOST}/${KEY}.txt`);
  if (!kr.ok || (await kr.text()).trim() !== KEY) { console.error(`✗ https://${HOST}/${KEY}.txt is not live yet — push the website first.`); process.exit(1); }
  const r = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
  });
  // 200 = accepted, 202 = accepted (key check pending). Anything else is a real problem.
  if (r.status === 200 || r.status === 202) console.log(`✓ IndexNow accepted ${urls.length} URLs (HTTP ${r.status}).`);
  else { console.error(`✗ IndexNow said HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); process.exit(1); }
})();
