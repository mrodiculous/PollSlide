#!/usr/bin/env node
/* PollSlide QA — functions that are CALLED but never DEFINED.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * answer.html called toast() from three places and never defined it. Every call
 * threw a ReferenceError. The worst was inside the submit-failure handler: a student
 * whose answer failed to save got no warning at all, because the code meant to warn
 * them was itself the thing that threw. Nothing caught it — the page parses, the
 * syntax is valid, the tests passed, and the throw only happens on a path you have to
 * be unlucky to reach. It surfaced by accident, in a browser console.
 *
 * A page's inline scripts share one global scope, so this is decidable: gather every
 * name that is CALLED, gather every name that is DEFINED (here or in a script this
 * page loads), and subtract.
 *
 * FALSE POSITIVES ARE THE FAILURE MODE. A checker that cries wolf gets ignored, and
 * then it may as well not exist. So this is deliberately conservative:
 *   • Anything assigned anywhere, by any syntax, counts as defined.
 *   • Browser, Firebase and library globals are allowlisted.
 *   • Method calls (a.b()) are ignored entirely — only bare calls are checked.
 *   • Anything it cannot parse confidently, it stays quiet about.
 * It would rather miss a real bug than report one that isn't.
 *
 * Run: node scripts/qa-undefined.js
 * Exit 1 if anything is called but never defined.
 * --------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES = ['answer.html', 'presenter.html', 'live.html', 'report.html', 'present.html', 'admin.html'];

/* Names the platform provides. Not an exhaustive list of the web platform — just
 * enough that everything PollSlide actually calls is covered. */
const GLOBALS = new Set([
  // language
  'Array','Boolean','Date','Error','Function','JSON','Map','Math','Number','Object','Promise',
  'Proxy','Reflect','RegExp','Set','String','Symbol','WeakMap','WeakSet','BigInt','Intl',
  'parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
  'encodeURI','decodeURI','escape','unescape','eval','structuredClone','queueMicrotask',
  // dom / browser
  'alert','confirm','prompt','fetch','setTimeout','setInterval','clearTimeout','clearInterval',
  'requestAnimationFrame','cancelAnimationFrame','requestIdleCallback','getComputedStyle',
  'matchMedia','open','close','print','scrollTo','scrollBy','focus','blur','btoa','atob',
  'Image','Audio','Blob','File','FileReader','FormData','Headers','Request','Response','URL',
  'URLSearchParams','WebSocket','Worker','XMLHttpRequest','AbortController','IntersectionObserver',
  'ResizeObserver','MutationObserver','CustomEvent','Event','KeyboardEvent','MouseEvent',
  'TextEncoder','TextDecoder','DOMParser','Notification','ClipboardItem','EventSource',
  'HTMLElement','Node','Element','CanvasRenderingContext2D','Option','Text','DocumentFragment',
  'getSelection','crypto','performance','navigator','location','history','screen','document',
  'window','console','localStorage','sessionStorage','indexedDB','top','parent','self','globalThis',
  // libraries the pages load from a CDN
  'firebase','Chart','QRCode','html2canvas','jspdf','jsPDF','marked','confetti','Sortable','mermaid',
  'require','module','exports','process',
  'SpeechSynthesisUtterance','speechSynthesis','ontouchstart','DataTransfer','Range','Selection',
]);

/* Comments and literal text are blanked by a real scanner, not a regex. The regex
 * version of this got nested template literals wrong and reported 106 problems, all
 * of them false — see scripts/lib/blank-literals.js for why. */
const { blankLiterals } = require('./lib/blank-literals.js');

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
}
function localSources(html) {
  return [...html.matchAll(/<script[^>]*\bsrc="(?!https?:)([^"?]+)/g)].map(m => m[1].replace(/^\.?\//, ''));
}

/* Every way this codebase brings a name into scope. Anything matching counts as
 * defined — over-matching here only makes the checker quieter, never wronger. */
function definitionsIn(code) {
  const out = new Set();
  const add = (re) => { for (const m of code.matchAll(re)) out.add(m[1]); };
  add(/\bfunction\s+([A-Za-z_$][\w$]*)/g);                     // function f(){}
  add(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);            // const f = …
  add(/\bclass\s+([A-Za-z_$][\w$]*)/g);
  add(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g);                    // window.f = …
  add(/^\s*([A-Za-z_$][\w$]*)\s*=[^=]/gm);                     // bare global assignment
  add(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g);
  /* Object method shorthand — `{ reveal() {…}, pop() {…} }` — defines a name that
   * looks exactly like a call site. Counting it as a definition is both true and the
   * thing that keeps the checker quiet about it. */
  add(/[{,]\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^()]{0,200}\)\s*\{/g);
  // destructured: const { a, b } = …   const [a, b] = …   for (const [k, v] of …)
  for (const m of code.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]\s*(?:=|\bof\b|\bin\b)/g)) {
    m[1].split(',').forEach(part => {
      const n = part.split(':').pop().split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(n)) out.add(n);
    });
  }
  // parameters, so a helper called inside a callback isn't flagged
  for (const m of code.matchAll(/(?:function\s*\*?\s*[\w$]*\s*)?\(([^()]{0,400})\)\s*(?:=>|\{)/g)) {
    m[1].split(',').forEach(part => {
      const n = part.split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(n)) out.add(n);
    });
  }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) out.add(m[1]);   // x => …
  add(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g);
  return out;
}

/* Bare calls only: `foo(` but never `.foo(`, `function foo(`, or a keyword. */
function callsIn(code) {
  const out = new Map();
  const KEYWORDS = new Set(['if','for','while','switch','catch','return','typeof','function','new',
                            'do','else','case','delete','void','in','of','await','yield','throw','with','super',
                            'async','static','constructor']);
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (KEYWORDS.has(name)) continue;
      if (/\b(function|class)\s+$/.test(line.slice(0, m.index + m[1].length))) continue;
      if (!out.has(name)) out.set(name, i + 1);
    }
  });
  return out;
}

let problems = 0;
console.log('\nCalled but never defined\n' + '─'.repeat(60));

for (const page of PAGES) {
  const file = path.join(ROOT, page);
  let html;
  try { html = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.log(`  · ${page} — not readable, skipped`); continue; }

  const inline = blankLiterals(inlineScripts(html));
  // Names this page's own <script src="…"> files bring with them.
  let external = '';
  for (const src of localSources(html)) {
    try { external += '\n' + blankLiterals(fs.readFileSync(path.join(ROOT, src), 'utf8')); }
    catch (e) { /* a file we can't read just makes us quieter */ }
  }

  const defined = new Set([...definitionsIn(inline), ...definitionsIn(external), ...GLOBALS]);
  const missing = [...callsIn(inline)].filter(([name]) => !defined.has(name));

  if (!missing.length) { console.log(`  ✓ ${page}`); continue; }
  console.log(`  ✗ ${page}`);
  missing.forEach(([name, line]) => {
    const all = [...inline.matchAll(new RegExp('(^|[^.\\w$])' + name + '\\s*\\(', 'g'))].length;
    console.log(`      ${name}()  — called ${all}×, first at inline-script line ${line}`);
    problems++;
  });
}

console.log('─'.repeat(60));
console.log(problems
  ? `\n${problems} name(s) called but never defined. Each one throws a ReferenceError\nthe moment that line runs — and takes the rest of its function down with it.\n`
  : '\nNothing called that is not defined.\n');
process.exit(problems ? 1 : 0);
