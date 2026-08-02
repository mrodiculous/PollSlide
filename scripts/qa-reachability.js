#!/usr/bin/env node
/*
 * PollSlide — reachability QA
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * Team play shipped completely unusable: `#teamModeBtn` carries the `disabled`
 * attribute in the markup (like Report / Big screen / Q&A, which are explicitly
 * re-enabled when a presentation opens) but nothing ever set `.disabled = false`.
 * Every line of logic behind it was correct — the button just could not be clicked.
 *
 * It slipped through because QA called `syncTeamModeBtn()` and asserted the label
 * said "Teams: On". That passes on a button no human can press.
 *
 *   TESTING THE FUNCTION IS NOT TESTING THE FEATURE.
 *
 * WHAT THIS CHECKS (static, fast, run before every push)
 *   A. a control ships `disabled` and no code ever clears it
 *   B. a control ships display:none and no code ever shows it
 *   C. an on*="handler()" whose function is never defined
 *
 * Static analysis WILL produce false positives (locals like `b.disabled = ...`,
 * helper accessors like `el('x')`, modals built with createElement). So every hit
 * is a PROMPT TO VERIFY IN THE BROWSER, not proof of a bug. The definitive check
 * is always: open the page, put it in the user's state, and assert
 *     el.disabled === false   and   el.click() actually does something.
 *
 * Usage:  node scripts/qa-reachability.js [files...]   (defaults to all app pages)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FILES = [
  'presenter.html', 'answer.html', 'live.html', 'report.html',
  'recap.html', 'admin.html', 'present.html', 'companion.html',
];
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;

// Handlers that are inline expressions or browser built-ins, not app functions.
const IGNORE_HANDLERS = new Set(['if', 'for', 'while', 'return', 'alert', 'confirm', 'print', 'open', 'history']);

let findings = 0;

for (const f of files) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) { console.log(`\n=== ${f} ===\n  (missing — skipped)`); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const js = (html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n');
  const hits = [];

  // A. disabled and never enabled ------------------------------------------
  for (const m of html.matchAll(/<(?:button|input|select|textarea)\b([^>]*\bdisabled\b[^>]*)>/gi)) {
    const id = (m[1].match(/id="([^"]+)"/) || [])[1];
    if (!id) continue;
    // Look for ANY assignment that could clear it, including via a local variable
    // captured from getElementById on a nearby line.
    const clears =
      new RegExp(`['"\`]${id}['"\`][\\s\\S]{0,300}?\\.disabled\\s*=\\s*(?:false|!)`).test(js) ||
      new RegExp(`\\.disabled\\s*=\\s*(?:false|!)[\\s\\S]{0,300}?['"\`]${id}['"\`]`).test(js);
    if (!clears) hits.push(`[A] #${id} ships disabled — found no code clearing it. VERIFY IN BROWSER.`);
  }

  // B. hidden and never shown ----------------------------------------------
  for (const m of html.matchAll(/<(?:button|a|div)\b([^>]*id="([^"]+)"[^>]*style="[^"]*display\s*:\s*none[^"]*"[^>]*)>/gi)) {
    const id = m[2];
    const shows = new RegExp(`['"\`]${id}['"\`][\\s\\S]{0,300}?(?:style\\.display|classList\\.(?:remove|toggle)|hidden\\s*=)`).test(js);
    if (!shows) hits.push(`[B] #${id} ships display:none — found no code showing it. VERIFY IN BROWSER.`);
  }

  // C. dead handlers --------------------------------------------------------
  const handlers = new Set();
  for (const m of html.matchAll(/\bon(?:click|change|input|submit|keydown)="\s*([a-zA-Z_$][\w$]*)\s*\(/g)) handlers.add(m[1]);
  for (const h of handlers) {
    if (IGNORE_HANDLERS.has(h)) continue;
    const defined =
      new RegExp(`function\\s+${h}\\b`).test(js) ||
      new RegExp(`(?:const|let|var)\\s+${h}\\s*=`).test(js) ||
      new RegExp(`window\\.${h}\\s*=`).test(js);
    if (!defined) hits.push(`[C] on*="${h}()" but ${h} is never defined — clicking would do nothing.`);
  }

  console.log(`\n=== ${f} ===`);
  if (hits.length) { findings += hits.length; hits.forEach(h => console.log('  ' + h)); }
  else console.log('  no reachability suspects');
}

console.log(`\n${findings} suspect(s). Each one must be confirmed or dismissed in the browser:`);
console.log('  open the page → put it in the user\'s state → assert el.disabled === false → el.click()\n');
process.exit(0);   // advisory: never blocks a build on a heuristic
