#!/usr/bin/env node
/* Pricing page: write the plans, the FAQ and the FAQPage data into the HTML itself (2026-10-07).
 * pollslide.com/pricing builds its plan cards and FAQ in the browser. Google runs that script;
 * GPTBot, ClaudeBot, PerplexityBot and most AI crawlers do not — to them the page was 164 words
 * with no plan, no price and no FAQ, so "what does PollSlide cost?" had no answer.
 * This runs the page's OWN PLANS/FAQS/buildPlans/buildFAQ code (no second copy to drift) and
 * pastes the result between markers. The page's script still rebuilds both on load (it clears
 * the container first), so visitors see exactly what they saw before.
 *   node scripts/seo/prerender-pricing.js          → rewrites pricing.html
 *   node scripts/seo/prerender-pricing.js --check  → exit 1 if pricing.html is out of date
 * Re-run after any edit to PLANS or FAQS (scripts/seo/check.js reminds you). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.env.WEBSITE_DIR || path.join(process.env.HOME, 'Documents/GitHub/pollslide-website');
const FILE = path.join(SITE, 'pricing.html');
let html = fs.readFileSync(FILE, 'utf8');

const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => /var PLANS=\[/.test(s) && /function buildFAQ\(/.test(s));
if (!script) { console.error('✗ could not find the PLANS/FAQS script in pricing.html'); process.exit(1); }

function el(tag) {
  return { tag, className: '', id: '', type: '', textContent: '', _html: '', children: [],
    set innerHTML(v) { this._html = v; this.children = []; }, get innerHTML() { return this._html + this.children.map(outer).join(''); },
    appendChild(c) { this.children.push(c); return c; }, remove() {}, querySelector() { return { onclick: null, classList: { add() {}, remove() {}, contains() { return false; } } }; },
    setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {}, contains() { return false; } }, style: {} };
}
const outer = c => `<${c.tag}${c.className ? ` class="${c.className}"` : ''}>${c.innerHTML}</${c.tag}>`;
const nodes = { PG: el('div'), FG: el('div') };
const doc = { readyState: 'loading', getElementById: id => nodes[id] || null, createElement: el,
  querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, head: el('head'), body: el('body'), documentElement: el('html') };
const ctx = { document: doc, window: {}, localStorage: { getItem() { return null; }, setItem() {} }, navigator: { language: 'en' },
  location: { search: '', hash: '', href: 'https://pollslide.com/pricing' }, console, setTimeout() {}, fetch() { return new Promise(() => {}); } };
ctx.window = ctx;
vm.createContext(ctx);
try { vm.runInContext(script, ctx); } catch (e) { console.error('✗ running the pricing script failed: ' + e.message); process.exit(1); }
ctx.buildPlans(); ctx.buildFAQ();
const plansHTML = nodes.PG.innerHTML, faqHTML = nodes.FG.innerHTML;
if (!/Pro/.test(plansHTML) || !ctx.FAQS || ctx.FAQS.length < 3) { console.error('✗ unexpected render — not writing'); process.exit(1); }

const text = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: ctx.FAQS.map(([q, a]) => ({ '@type': 'Question', name: text(q), acceptedAnswer: { '@type': 'Answer', text: text(a) } })) };
const ld = `<script type="application/ld+json" id="faqSchema">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`;

const put = (h, open, close, body) => {
  const re = new RegExp(`(${open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[\\s\\S]*?(${close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`);
  if (!re.test(h)) throw new Error('marker not found: ' + open);
  return h.replace(re, (_, a, b) => a + body + b);
};
let out = html;
out = out.replace(/<div class="plans-grid" id="PG">(?:<!-- prerender:plans -->[\s\S]*?<!-- \/prerender:plans -->)?<\/div>/, `<div class="plans-grid" id="PG"><!-- prerender:plans -->${plansHTML}<!-- /prerender:plans --></div>`);
out = out.replace(/<div class="faq-grid" id="FG">(?:<!-- prerender:faq -->[\s\S]*?<!-- \/prerender:faq -->)?<\/div>/, `<div class="faq-grid" id="FG"><!-- prerender:faq -->${faqHTML}<!-- /prerender:faq --></div>`);
out = out.replace(/\n?<!-- prerender:faqschema -->[\s\S]*?<!-- \/prerender:faqschema -->/, '');
out = out.replace('</head>', `<!-- prerender:faqschema -->${ld}<!-- /prerender:faqschema -->\n</head>`);
if (!/prerender:plans -->/.test(out) || !/prerender:faq -->/.test(out)) { console.error('✗ containers not found in pricing.html'); process.exit(1); }

if (process.argv.includes('--check')) {
  if (out !== html) { console.error('✗ pricing.html is out of date — run node scripts/seo/prerender-pricing.js'); process.exit(1); }
  console.log('✓ pricing.html pre-render is current'); process.exit(0);
}
fs.writeFileSync(FILE, out);
console.log(`✓ pricing.html: ${ctx.PLANS.length} plans, ${ctx.FAQS.length} FAQs and FAQPage written into the HTML`);
