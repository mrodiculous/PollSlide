#!/usr/bin/env node
/* PollSlide QA — no credential in a file the browser can read.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * `presenter.html` carried a live Giphy API key as a top-level constant:
 *
 *     const GIPHY_KEY = '45s8…';
 *
 * It shipped to every browser that loaded the app and went into the GitHub history.
 * Nothing flagged it, because it is perfectly valid JavaScript that does exactly what
 * it looks like it does. The only reason it surfaced was someone reading the file.
 *
 * A key in client source is not a bug that breaks anything, which is precisely why it
 * survives: the feature works, the tests pass, nobody notices. So it needs a check.
 *
 * WHAT IT LOOKS FOR: assignments that name a credential, and the shapes of the common
 * providers' keys. Deliberately NOT a general entropy scan — those produce constant
 * false positives on minified code and hashes, and a checker people learn to ignore
 * protects nothing.
 *
 * Run: node scripts/qa-secrets.js
 * --------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Files the browser can fetch. api/ and lib/ run server-side and legitimately read keys.
const CLIENT_FILES = [
  'presenter.html', 'answer.html', 'present.html', 'live.html', 'report.html',
  'admin.html', 'recap.html', 'results.html', 'overlay.html', 'companion.html',
  'powerpoint.html', 'gifs.js', 'roster.js', 'retakes.js', 'gradebook.js',
  'qid.js', 'errors.js', 'ui-lang.js', 'present-display.js',
];

const RULES = [
  { name: 'a named credential assigned a literal',
    // KEY/TOKEN/SECRET/PASSWORD = "…" with something long enough to be real.
    // `_KEY` as well as `API_KEY`: the one that shipped was named GIPHY_KEY, which the
    // narrower pattern missed — it was only caught by its shape.
    re: /\b(?:const|let|var)\s+\w*(?:_KEY|API_?KEY|SECRET|TOKEN|PASSWORD|PRIVATE_?KEY)\w*\s*=\s*['"`]([^'"`]{16,})['"`]/gi },
  { name: 'Giphy / Tenor key shape',
    re: /['"`]([A-Za-z0-9]{32})['"`]\s*[,;)\]]/g, guard: (m, src, i) =>
      /giphy|tenor|api_?key/i.test(src.slice(Math.max(0, i - 220), i + 60)) },
  { name: 'Stripe secret key',   re: /\b(sk_live_[A-Za-z0-9]{10,}|sk_test_[A-Za-z0-9]{10,})\b/g },
  { name: 'Google API key',      re: /\bAIza[0-9A-Za-z_\-]{30,}\b/g },
  { name: 'OpenAI key',          re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'private key block',   re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

/* Firebase's browser config is public by design — it identifies the project, it does
 * not authorise anything. Security comes from the database rules. Flagging it would
 * be the false positive that gets this whole check switched off. */
const ALLOW = [/apiKey:\s*['"]AIza/, /firebaseConfig/i];

let findings = 0;
console.log('\nCredentials in client-readable files\n' + '─'.repeat(60));

for (const f of CLIENT_FILES) {
  const p = path.join(ROOT, f);
  let src;
  try { src = fs.readFileSync(p, 'utf8'); }
  catch (e) { continue; }               // a missing file is not a finding

  const hits = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(src))) {
      const around = src.slice(Math.max(0, m.index - 120), m.index + 120);
      if (ALLOW.some(a => a.test(around))) continue;
      if (rule.guard && !rule.guard(m, src, m.index)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      const shown = String(m[1] || m[0]);
      hits.push(`${rule.name} — line ${line}: ${shown.slice(0, 6)}…${shown.slice(-4)}`);
    }
  }
  if (hits.length) {
    findings += hits.length;
    console.log(`  ✗ ${f}`);
    hits.forEach(h => console.log('      ' + h));
  }
}

if (!findings) console.log(`  ✓ ${CLIENT_FILES.length} client files checked, no credentials found`);
console.log('─'.repeat(60));
console.log(findings
  ? '\nA key in a client file is readable by anyone who opens dev tools, and is in the\n' +
    'git history for good. Move it to a Vercel environment variable and read it from a\n' +
    'server endpoint — see GIF-SETUP.md for how api/gif-search.js does it. Then ROTATE\n' +
    'the exposed key: removing it from the file does not un-publish it.\n'
  : '\nNo credentials in client-readable files.\n');
process.exit(findings ? 1 : 0);
