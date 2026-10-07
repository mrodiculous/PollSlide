#!/usr/bin/env node
/* Download page: write the companion-app FAQ (and its FAQPage data) into the HTML (2026-10-07).
 * Same reason as prerender-pricing.js — AI crawlers don't run the script that builds it.
 * Reads the page's own `faqs` array and item template; the script clears #faqList and rebuilds
 * it on load, so visitors see exactly what they saw before.
 *   node scripts/seo/prerender-download.js [--check] */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.env.WEBSITE_DIR || path.join(process.env.HOME, 'Documents/GitHub/pollslide-website');
const FILE = path.join(SITE, 'download.html');
const html = fs.readFileSync(FILE, 'utf8');
const m = /const faqs = (\[[\s\S]*?\n\]);/.exec(html);
if (!m) { console.error('✗ faqs array not found in download.html'); process.exit(1); }
const faqs = vm.runInNewContext(m[1]);
const item = f => `<div class="faq-item"><div class="faq-q">${f.q}<span class="chev">▾</span></div><div class="faq-a">${f.a}</div></div>`;
const text = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(f => ({ '@type': 'Question', name: text(f.q), acceptedAnswer: { '@type': 'Answer', text: text(f.a) } })) };
let out = html.replace(/<div id="faqList">(?:<!-- prerender:faq -->[\s\S]*?<!-- \/prerender:faq -->)?<\/div>/, `<div id="faqList"><!-- prerender:faq -->${faqs.map(item).join('')}<!-- /prerender:faq --></div>`);
out = out.replace(/\n?<!-- seo:faq -->[\s\S]*?<!-- \/seo:faq -->/, '').replace('</head>', `<!-- seo:faq --><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script><!-- /seo:faq -->\n</head>`);
if (!/prerender:faq -->/.test(out)) { console.error('✗ #faqList not found'); process.exit(1); }
if (!/list\.innerHTML = '';/.test(out)) { console.error('✗ the page script must clear #faqList before rebuilding, or the FAQ shows twice'); process.exit(1); }
if (process.argv.includes('--check')) { if (out !== html) { console.error('✗ download.html FAQ pre-render out of date — run node scripts/seo/prerender-download.js'); process.exit(1); } console.log('✓ download.html FAQ pre-render is current'); process.exit(0); }
fs.writeFileSync(FILE, out); console.log(`✓ download.html: ${faqs.length} FAQs + FAQPage written into the HTML`);
