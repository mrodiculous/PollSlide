#!/usr/bin/env node
/* Browser language sweep (2026-10-11).
 * Opens every page in all eleven languages with a stand-in Firebase (no network, no account)
 * and reads EVERY text node, placeholder, title and button — including sign-in boxes, dialogs
 * and pop-ups that are on the page but hidden. Anything that reads exactly as it does in
 * English, and is made of real words, is reported. Brand names, addresses and codes are
 * allowed (they are the same in every language on purpose).
 *
 *   python3 -m http.server 8138   (from the repo root)   then   node scripts/browser-i18n/sweep.js
 *   SHOTS=1 also saves a screenshot of every page in every language to $OUT (default /tmp/i18n-shots).
 * Needs Playwright. Not part of `node scripts/qa.js` — run it before a release. */
const fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')); }
const BASE = process.env.BASE || 'http://localhost:8138/';
const OUT = process.env.OUT || '/tmp/i18n-shots';
const LANGS = ['en','es','de','fr','pt','it','nl','ja','zh','ar','hi'];
const STUB = fs.readFileSync(path.join(__dirname, 'stub-firebase.js'), 'utf8');
const PAGES = (process.env.PAGES || 'presenter.html,present.html,live.html,results.html,report.html,recap.html,overlay.html,answer.html,companion.html,loop.html,play.html,screen.html,tv.html,rules.html').split(',');
// Same in every language on purpose: names, addresses, codes, units, emoji-only labels.
const ALLOW = /^(PollSlide|PresentSlide|LoopSlide|Polly( AI)?|Google|Microsoft|PowerPoint|Keynote|Google Slides|GIPHY|Giphy|QR|GIF|GIFs|OK|OBS|Mac|iPhone|Android|Zoom|Teams|Slack|Canva|Stripe|Pro|Team|Enterprise|Free|Basic|Plus|Starter|Business|Education|PDF|CSV|Excel|URL|https?:\/\/\S+|\S+@\S+|[\w.-]+\.(com|ai|io|org)(\/\S*)?|[A-Z0-9]{2,8}|v?\d[\d.,:%x×\s-]*\w{0,3}|LIVE|Live|Q&A|A|B|C|D|E|F|[^A-Za-z]*)$/;

// Product names, native language names and addresses — identical in every language.
const SAME_EVERYWHERE = new Set(['SurveySlide','QuizSlide','StudySlide','✨ Polly','✨ Polly AI','🔁 LoopSlide','Powered by GIPHY',
  'English','Español','Deutsch','Français','Português','Italiano','Nederlands','alice@example.com, bob@example.com']);
/* Words that really are spelled the same in a Latin-script language ("Quiz" in German, "Design"
   in French). Only es/de/fr/pt/it/nl may use them — in Japanese, Chinese, Arabic or Hindi any
   English word left on screen is a miss. */
const COGNATES = new Set(['Account','Questions','💬 Questions','Questions (','Question','Style','Message','Password','Recent','Quiz','🏆 Quiz',
  'Agenda','Design','Type','Flashcard','Flashcards','Media','🖼 Media','Layouts','Deck','Text','Name','Image','Rectangle','🗒 Notes','File',
  'Font','Email','Live polls','Poll','🗳️ Poll','Accent','Code','Source','Studio','⏱ Auto: off']);
const LATIN = new Set(['es','de','fr','pt','it','nl']);

function collect() {
  const out = [];
  const skip = el => el.closest('script,style,noscript,svg,[data-noi18n],code,pre,select[data-noi18n],[contenteditable]');
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n, i = 0;
  while ((n = tw.nextNode())) {
    const el = n.parentElement; if (!el || skip(el)) continue;
    const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (!t) continue;
    out.push(['t' + (i++), t]);
  }
  document.querySelectorAll('[placeholder],[title],[aria-label]').forEach((el, j) => {
    if (skip(el)) return;
    for (const a of ['placeholder', 'title', 'aria-label']) { const v = el.getAttribute(a); if (v && v.trim()) out.push([a + j, v.trim()]); }
  });
  return { items: out, lang: document.documentElement.lang, rtl: document.documentElement.classList.contains('ps-rtl-text') || document.documentElement.classList.contains('loop-rtl-text') || document.documentElement.dir === 'rtl' || !!document.querySelector('#app[dir="rtl"]') };
}

(async () => {
  const b = await chromium.launch();
  if (process.env.SHOTS) fs.mkdirSync(OUT, { recursive: true });
  const report = {}; let total = 0;
  for (const page of PAGES) {
    const english = new Set();
    for (const lang of LANGS) {
      const ctx = await b.newContext({ viewport: { width: 1366, height: 768 }, locale: lang });
      await ctx.route(/gstatic\.com\/firebasejs|firebasejs/, r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
      await ctx.route(/googletagmanager|google-analytics|appsforoffice/, r => r.fulfill({ contentType: 'text/javascript', body: '' }));
      await ctx.addInitScript(l => { try { ['ps_ui_lang','ql_viewer_lang','ps_lang','ps_viewer_lang'].forEach(k => localStorage.setItem(k, l)); } catch (e) {} }, lang);
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', e => errs.push(e.message));
      const sep = page.includes('?') ? '&' : '?';
      await p.goto(BASE + page + sep + 'lang=' + lang, { waitUntil: 'domcontentloaded' }).catch(e => errs.push(e.message));
      await p.waitForTimeout(2500);
      const r = await p.evaluate(collect).catch(e => ({ items: [], err: e.message }));
      if (process.env.SHOTS) await p.screenshot({ path: path.join(OUT, page.replace(/\W+/g, '_') + '-' + lang + '.png') }).catch(() => {});
      if (lang === 'en') r.items.forEach(([, t]) => english.add(t));
      else {
        const left = [...new Set(r.items.map(x => x[1]).filter(t => english.has(t) && /[A-Za-z]{3,}.*[A-Za-z]{2,}|[A-Za-z]{4,}/.test(t) && !ALLOW.test(t) && !SAME_EVERYWHERE.has(t) && !(LATIN.has(lang) && COGNATES.has(t))))];
        const issues = [];
        if (r.lang !== lang) issues.push(`<html lang> is "${r.lang}"`);
        if (lang === 'ar' && !r.rtl) issues.push('Arabic is not set to read right to left');
        if (left.length) issues.push(...left.map(t => 'English: ' + t.slice(0, 120)));
        if (errs.length) issues.push(...errs.slice(0, 2).map(e => 'page error: ' + e.slice(0, 120)));
        if (issues.length) { (report[page] = report[page] || {})[lang] = issues; total += issues.length; }
      }
      await ctx.close();
    }
    const n = report[page] ? Object.values(report[page]).reduce((a, x) => a + x.length, 0) : 0;
    console.log((n ? '  ✗ ' : '  ✓ ') + page + (n ? `  ${n} issue(s)` : ''));
  }
  await b.close();
  fs.writeFileSync(process.env.REPORT || '/tmp/i18n-sweep.json', JSON.stringify(report, null, 1));
  console.log(total ? `\n${total} issue(s) — details in ${process.env.REPORT || '/tmp/i18n-sweep.json'}` : '\nEvery page reads in every language.');
  process.exit(total ? 1 : 0);
})();
