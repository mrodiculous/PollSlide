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
  'results.html', 'overlay.html', 'powerpoint.html',
];
const files = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_FILES;

// Handlers that are inline expressions or browser built-ins, not app functions.
const IGNORE_HANDLERS = new Set(['if', 'for', 'while', 'return', 'alert', 'confirm', 'print', 'open', 'history']);

let findings = 0;

/* Which element ids ever get `.disabled` assigned, and to what?
 *
 * The first version of this used "is there a `.disabled =` within 300 characters of
 * the id string" and got it wrong in BOTH directions — it flagged live buttons in
 * report.html (cleared with `= rows.length===0`, not `= false`) and it missed a
 * genuinely dead button whose neighbouring function happened to touch .disabled.
 * Proximity is not a scope. So: split the JS into function bodies, resolve
 * `const b = el('x')` inside each one, and attribute every assignment to a real id.
 *
 * Returns Map<id, rhs[]> — an id absent from the map is never assigned at all.
 */
function collectDisabledAssignments(js) {
  const out = new Map();
  const add = (id, rhs) => {
    if (!id) return;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(rhs.trim());
  };

  // Carve out each function body by brace matching, so a local `b` can't leak
  // across into the next function. Everything left over is one top-level scope.
  const scopes = [];
  const covered = [];
  for (const m of js.matchAll(/\bfunction\s*[\w$]*\s*\([^)]*\)\s*\{/g)) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < js.length; i++) {
      const c = js[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    scopes.push(js.slice(m.index, i + 1));
    covered.push([m.index, i + 1]);
  }
  let last = 0, top = '';
  for (const [a, b] of covered.sort((x, y) => x[0] - y[0])) { if (a > last) top += js.slice(last, a); last = Math.max(last, b); }
  scopes.push(top + js.slice(last));

  // Accessors that take an id and hand back the element. `el` and `$` are the two
  // this codebase actually uses; getElementById is the raw form.
  const GET = String.raw`(?:document\.getElementById|el|\$|byId)\(\s*['"\`]([^'"\`]+)['"\`]\s*\)`;

  for (const body of scopes) {
    // local variable -> id, e.g.  const b = el('teamModeBtn');
    const bind = new Map();
    for (const m of body.matchAll(new RegExp(String.raw`(?:const|let|var)\s+([\w$]+)\s*=\s*` + GET, 'g'))) bind.set(m[1], m[2]);
    for (const m of body.matchAll(new RegExp(String.raw`^\s*([\w$]+)\s*=\s*` + GET, 'gm')))                bind.set(m[1], m[2]);

    // direct:  el('csvBtn').disabled = <rhs>
    for (const m of body.matchAll(new RegExp(GET + String.raw`\s*\.disabled\s*=\s*([^;\n]+)`, 'g'))) add(m[1], m[2]);

    // via local: b.disabled = <rhs>
    for (const m of body.matchAll(/\b([\w$]+)\s*\.disabled\s*=\s*([^;\n]+)/g)) {
      if (bind.has(m[1])) add(bind.get(m[1]), m[2]);
    }
  }
  return out;
}

for (const f of files) {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) { console.log(`\n=== ${f} ===\n  (missing — skipped)`); continue; }
  const html = fs.readFileSync(full, 'utf8');
  const js = (html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || []).join('\n');
  const hits = [];

  // A. disabled and never enabled ------------------------------------------
  const assigns = collectDisabledAssignments(js);
  for (const m of html.matchAll(/<(?:button|input|select|textarea)\b([^>]*\bdisabled\b[^>]*)>/gi)) {
    const id = (m[1].match(/id="([^"]+)"/) || [])[1];
    if (!id) continue;
    const rhs = assigns.get(id);
    if (!rhs) {
      hits.push(`[A] #${id} ships disabled and NOTHING ever assigns its .disabled. This is the team-play bug. VERIFY IN BROWSER.`);
    } else if (rhs.every(r => /^true\b/.test(r))) {
      // Touched, but only ever pushed back to disabled — still unclickable.
      hits.push(`[A] #${id} ships disabled and its .disabled is only ever set to true. VERIFY IN BROWSER.`);
    }
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
