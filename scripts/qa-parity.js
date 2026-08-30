#!/usr/bin/env node
/*
 * PollSlide — cross-product parity
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * PollSlide is one engine behind five products, and features keep landing in one
 * surface and never reaching the others. Nothing noticed. Real examples, all found
 * by hand after a user hit them:
 *   • PresentSlide never published `currentQuestion`, so audience phones could not
 *     follow the presenter — every other product had done this for months.
 *   • "Keep in original language" (noTranslate) shipped for Polls, Surveys, Quizzes
 *     and Study. PresentSlide never got it.
 *   • answer.html injected question text unescaped long after other pages escaped.
 *
 * So: one place that knows what each capability IS, which surfaces it SHOULD apply
 * to and why, and which surfaces actually have it.
 *
 * TWO PASSES
 *   1. KNOWN capabilities — declared below, detected by signature. Anything present
 *      in some applicable surfaces and missing from others is a GAP, printed with
 *      what it would mean for the surface that is missing it.
 *   2. DISCOVERY — functions and markers that exist in exactly ONE surface but look
 *      general-purpose. These are CANDIDATES, not gaps. A machine cannot tell
 *      "deliberately specific to this product" from "should have been shared", so
 *      they are printed for a human to triage, and triaged ones are recorded so the
 *      same suggestion is not made twice.
 *
 * Adding a capability is one entry in CAPABILITIES. That is the whole maintenance
 * cost, and it is what makes the next divergence show up the day it lands.
 *
 * Usage:  node scripts/qa-parity.js            report gaps + candidates
 *         node scripts/qa-parity.js --gaps     gaps only (quiet)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ── The surfaces, and what KIND of thing each one is ─────────────────────────
 * A capability applies to a surface when their roles overlap. Getting these tags
 * right is what stops the tool demanding a leaderboard on the billing page. */
const SURFACES = {
  'presenter.html': { name: 'Presenter Studio', roles: ['authoring', 'presenting', 'live-host'] },
  'present.html':   { name: 'PresentSlide',     roles: ['authoring', 'presenting', 'live-host'] },
  'answer.html':    { name: 'Audience page',    roles: ['audience'] },
  'live.html':      { name: 'Big screen',       roles: ['projection', 'audience-visible'] },
  'results.html':   { name: 'Results',          roles: ['audience-visible'] },
  'recap.html':     { name: 'Recap',            roles: ['audience-visible'] },
  'report.html':    { name: 'Reports',          roles: ['analysis'] },
  'companion.html': { name: 'Mac companion',    roles: ['projection'] },
  'powerpoint.html':{ name: 'PowerPoint add-in',roles: ['presenting', 'projection'] },
};

/* ── What we know how to look for ──────────────────────────────────────────
 * `appliesTo` is the ROLE a surface must have for the capability to be relevant.
 * `why` is printed on a gap — it has to say what the user loses, not what the code
 * lacks, or nobody can judge whether the gap is worth closing. */
const CAPABILITIES = [
  {
    id: 'error-reporting', label: 'Client error reporting',
    appliesTo: ['authoring', 'audience', 'projection', 'analysis', 'presenting'],
    detect: /errors\.js\?v=/,
    why: 'A page that throws for real users reports nothing, so a break here is invisible until somebody emails.',
  },
  {
    id: 'output-escaping', label: 'Escapes presenter/model text before rendering',
    appliesTo: ['audience', 'audience-visible', 'projection', 'analysis'],
    detect: /\b(esc|escT|escHtml|escapeHtml|escapeQa|rich)\s*\(/,
    why: 'Unescaped question text lets a stray "<" swallow the rest of a question, and lets model output run as HTML on every phone.',
  },
  {
    id: 'follow-presenter', label: 'Publishes currentQuestion so phones follow',
    appliesTo: ['live-host'],
    detect: /currentQuestion['"`]\)?\s*\)?\s*\.set|currentQuestion['"`]\s*\)\.set|\/currentQuestion'\)\.set|currentQuestion.*\.set\(/,
    why: 'Without it the audience stays frozen on whichever slide or question their QR happened to encode.',
  },
  {
    id: 'stable-qids', label: 'Stable question ids (PSQid)',
    appliesTo: ['live-host', 'audience', 'projection', 'analysis'],
    detect: /PSQid\./,
    why: 'Response buckets keyed by array position get mis-attributed the moment anything is reordered or deleted.',
  },
  {
    id: 'no-translate', label: '"Keep in original language" honoured',
    appliesTo: ['authoring', 'audience'],
    detect: /noTranslate/,
    why: 'Wordplay, spelling and language questions get auto-translated into nonsense, and the presenter has no way to stop it.',
  },
  {
    id: 'viewer-translation', label: 'Live translation for the viewer',
    appliesTo: ['audience'],
    detect: /api\/translate/,
    why: 'A viewer whose phone is in another language reads the deck in a language they may not speak.',
  },
  {
    id: 'see-original', label: '"See original" toggle',
    appliesTo: ['audience'],
    detect: /_showOriginal|seeOriginal|showOriginal/,
    why: 'A viewer who thinks a translation is wrong has no way to check what was actually written.',
  },
  {
    id: 'present-display', label: 'Full screen + wake lock while presenting',
    appliesTo: ['presenting', 'projection'],
    detect: /PSDisplay|present-display\.js/,
    why: 'Browser chrome stays on screen in front of the room, and the display can dim mid-session.',
  },
  {
    id: 'qa-panel', label: 'Audience Q&A',
    appliesTo: ['live-host'],
    detect: /sessions\/.*\/qa|openQAPanel|startPresentQa|\/qa'/,
    why: 'The room cannot ask questions back during this product.',
  },
];

/* Triaged discovery candidates: things that look shared but are deliberately not.
 * Recording a decision here stops the tool re-suggesting it every run — a checker
 * that repeats a rejected idea is one people stop reading. */
const TRIAGED = {
  'buildResult':   'PresentSlide-specific slide rendering.',
  'renderNav':     'PresentSlide slide navigator.',
  'psBrandQR':     'Shared already via markup, not a function export.',
  'exportPDF':     'PresentSlide only, by design.',
};

const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return null; } };
const applies = (cap, surface) => (SURFACES[surface].roles || []).some(r => cap.appliesTo.includes(r));

function run() {
  const gapsOnly = process.argv.includes('--gaps');
  const src = {};
  for (const f of Object.keys(SURFACES)) { const s = read(f); if (s) src[f] = s; }

  const gaps = [];
  console.log('\n═══ CAPABILITY MATRIX ═══\n');
  const files = Object.keys(src);
  const w = Math.max(...CAPABILITIES.map(c => c.label.length));
  console.log(' '.repeat(w + 2) + files.map(f => f.replace('.html', '').slice(0, 9).padEnd(10)).join(''));

  for (const cap of CAPABILITIES) {
    const cells = files.map(f => {
      if (!applies(cap, f)) return '·'.padEnd(10);            // not relevant here
      const has = cap.detect.test(src[f]);
      if (!has) gaps.push({ cap, surface: f });
      return (has ? 'yes' : 'MISSING').padEnd(10);
    });
    console.log(cap.label.padEnd(w + 2) + cells.join(''));
  }
  console.log('\n  yes = present · MISSING = applies here but absent · · = not applicable\n');

  /* A capability that NO applicable surface has is not a parity gap — it is simply
   * something the product does not do yet. Only report where some have it and
   * others do not; that is the divergence this tool exists to catch. */
  const real = gaps.filter(g => {
    const applicable = files.filter(f => applies(g.cap, f));
    return applicable.some(f => g.cap.detect.test(src[f]));
  });

  console.log('═══ GAPS — implemented somewhere, missing here ═══\n');
  if (!real.length) console.log('  None. Every capability that exists is in every surface it applies to.\n');
  for (const g of real) {
    const hasIt = files.filter(f => applies(g.cap, f) && g.cap.detect.test(src[f]));
    console.log(`  ▸ ${g.cap.label}`);
    console.log(`      missing from : ${SURFACES[g.surface].name} (${g.surface})`);
    console.log(`      already in   : ${hasIt.map(f => SURFACES[f].name).join(', ')}`);
    console.log(`      what it costs: ${g.cap.why}\n`);
  }

  if (gapsOnly) { console.log(`${real.length} gap(s).\n`); return; }

  /* ── Discovery ────────────────────────────────────────────────────────────
   * Functions defined in exactly ONE surface whose name suggests something general.
   * Deliberately noisy-but-bounded: a machine cannot tell intent, so these are
   * printed as candidates to triage, never as failures. */
  const defs = {};
  for (const f of files) {
    for (const m of src[f].matchAll(/\bfunction\s+([a-zA-Z_$][\w$]{4,})\s*\(/g)) {
      (defs[m[1]] ||= new Set()).add(f);
    }
  }
  const GENERIC = /^(sync|render|apply|toggle|update|publish|handle|show|open|close|format|build|load|save|track|report|escape|translate)/;
  const candidates = Object.entries(defs)
    .filter(([n, s]) => s.size === 1 && GENERIC.test(n) && !TRIAGED[n])
    .filter(([n]) => !CAPABILITIES.some(c => c.detect.test(n)))
    .map(([n, s]) => ({ name: n, only: [...s][0] }))
    .sort((a, b) => a.only.localeCompare(b.only) || a.name.localeCompare(b.name));

  console.log('═══ CANDIDATES — in one surface only, name looks general ═══\n');
  console.log('  Not gaps. A human decides whether each is product-specific by design\n  or something the others should have. Record the decision in TRIAGED.\n');
  const byFile = {};
  for (const c of candidates) (byFile[c.only] ||= []).push(c.name);
  for (const [f, names] of Object.entries(byFile)) {
    console.log(`  ${SURFACES[f].name} (${f}) — ${names.length}`);
    console.log('      ' + names.slice(0, 14).join(', ') + (names.length > 14 ? `, …+${names.length - 14}` : ''));
    console.log('');
  }

  console.log(`${real.length} gap(s) · ${candidates.length} candidate(s) to triage\n`);
}
run();
process.exit(0);   // advisory, like the other qa-* checkers
