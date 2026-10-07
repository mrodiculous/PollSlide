#!/usr/bin/env node
/* FAQPage structured data FROM a page's visible FAQ (2026-10-07). Search engines and AI answer
 * engines quote FAQ answers directly; the markup has to match what is on the page, word for
 * word, or Google ignores it. So it is generated, never hand-written:
 *   • .faq-item with .faq-q (question) + .faq-a (answer)   — index.html style
 *   • <details><summary>Q</summary><p>A</p></details>      — the pollslide-for-* style
 * Written between <!-- seo:faq --> markers in <head>; re-running replaces it.
 *   node scripts/seo/faq-schema.js index.html [more.html …]
 *   node scripts/seo/faq-schema.js --check index.html  → exit 1 if out of date */
'use strict';
const fs = require('fs'), path = require('path');
const SITE = process.env.WEBSITE_DIR || path.join(process.env.HOME, 'Documents/GitHub/pollslide-website');
const CHECK = process.argv.includes('--check');
const text = s => s.replace(/<span class="faq-icon">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
let bad = 0;
for (const f of process.argv.slice(2).filter(a => !a.startsWith('--'))) {
  const file = path.join(SITE, f); const html = fs.readFileSync(file, 'utf8');
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const qa = [];
  for (const m of body.matchAll(/<div class="faq-item[^"]*">[\s\S]*?class="faq-q"[^>]*>([\s\S]*?)<\/button>[\s\S]*?class="faq-a"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)) qa.push([text(m[1]), text(m[2])]);
  for (const m of body.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)) qa.push([text(m[1]), text(m[2])]);
  if (!qa.length) { console.error(`✗ ${f}: no visible FAQ found`); bad++; continue; }
  if (/"@type"\s*:\s*"FAQPage"/.test(html.replace(/<!-- seo:faq -->[\s\S]*?<!-- \/seo:faq -->/, ''))) { console.log(`· ${f}: already has its own FAQPage — left alone`); continue; }
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };
  const block = `<!-- seo:faq --><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script><!-- /seo:faq -->`;
  let out = html.replace(/\n?<!-- seo:faq -->[\s\S]*?<!-- \/seo:faq -->/, '');
  out = out.replace('</head>', block + '\n</head>');
  if (CHECK) { if (out !== html) { console.error(`✗ ${f}: FAQPage out of date — run node scripts/seo/faq-schema.js ${f}`); bad++; } else console.log(`✓ ${f}: FAQPage matches the visible FAQ (${qa.length})`); continue; }
  fs.writeFileSync(file, out); console.log(`✓ ${f}: FAQPage with ${qa.length} questions`);
}
process.exit(bad ? 1 : 0);
