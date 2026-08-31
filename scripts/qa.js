#!/usr/bin/env node
/* PollSlide — every gate, one command.
 * ---------------------------------------------------------------------------
 *   node scripts/qa.js            everything
 *   node scripts/qa.js --fast     skip the slow cross-product parity sweep
 *
 * WHY THIS EXISTS
 * The gates kept arriving one at a time — a syntax check, then reachability, then
 * escaping, then parity, then undefined-name — each documented in its own header as
 * "run this before every push". Five things you must remember to run is zero things
 * anyone runs. This is the one thing to remember.
 *
 * Each gate is here because something real got through:
 *   syntax        inline <script> is invisible to `node --check`
 *   undefined     toast() was called three times and never defined; the worst call
 *                 was inside a submit-failure handler, so a student whose answer
 *                 failed to save got no warning — the warning was what threw
 *   reachability  team play shipped as a button nobody could click
 *   escaping      an unescaped "<" swallowed a question, and would have run as HTML
 *   parity        a capability built for one product and forgotten in the other four
 *   tests         everything above only proves the page loads, not that it is right
 *
 * Exit code is the number of failing gates, so it can gate a commit.
 * --------------------------------------------------------------------------- */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fast = process.argv.includes('--fast');

const GATES = [
  { name: 'syntax',       script: 'qa-syntax.js',       why: 'inline <script> blocks parse' },
  { name: 'undefined',    script: 'qa-undefined.js',    why: 'nothing is called that is not defined' },
  { name: 'reachability', script: 'qa-reachability.js', why: 'every control can actually be used' },
  { name: 'escaping',     script: 'qa-escaping.js',     why: 'nothing user-typed reaches innerHTML raw' },
  { name: 'parity',       script: 'qa-parity.js',       why: 'capabilities are not stranded in one product', slow: true },
];

const run = (file, args = []) => spawnSync(process.execPath, [file, ...args], { cwd: ROOT, encoding: 'utf8' });

let failed = [];
console.log('\n═══ PollSlide QA ═══\n');

for (const gate of GATES) {
  if (fast && gate.slow) { console.log(`  ‒ ${gate.name.padEnd(13)} skipped (--fast)`); continue; }
  const file = path.join(__dirname, gate.script);
  if (!fs.existsSync(file)) { console.log(`  ‒ ${gate.name.padEnd(13)} missing, skipped`); continue; }
  const r = run(file);
  const okay = r.status === 0;
  if (!okay) failed.push(gate);
  console.log(`  ${okay ? '✓' : '✗'} ${gate.name.padEnd(13)} ${gate.why}`);
  // stderr as well as stdout: a gate that CRASHES prints its reason there, and
  // showing only stdout made a crash look like a clean run that merely exited 1.
  if (!okay) {
    const body = (r.stdout || '') + (r.stderr ? '\n' + r.stderr.split('\n').slice(0, 6).join('\n') : '');
    console.log(body.split('\n').map(l => '        ' + l).join('\n').replace(/\s+$/, ''));
  }
}

// Tests last: they are the slowest and the most informative when something is broken.
const testDir = path.join(ROOT, 'scripts', 'tests');
let total = 0, bad = 0, files = 0;
if (fs.existsSync(testDir)) {
  for (const f of fs.readdirSync(testDir).filter(f => f.endsWith('.test.js')).sort()) {
    const r = run(path.join(testDir, f));
    const m = /(\d+) passed, (\d+) failed/.exec(r.stdout || '');
    files++;
    if (m) { total += +m[1]; bad += +m[2]; }
    if (r.status !== 0) {
      bad += m ? 0 : 1;
      console.log(`  ✗ ${('test:' + f.replace('.test.js', '')).padEnd(13)}`);
      console.log((r.stdout || r.stderr || '').split('\n').filter(l => l.includes('✗')).map(l => '      ' + l).join('\n'));
    }
  }
  console.log(`  ${bad ? '✗' : '✓'} ${'tests'.padEnd(13)} ${total} assertions across ${files} files` + (bad ? `, ${bad} FAILING` : ''));
  if (bad) failed.push({ name: 'tests' });
}

console.log('');
if (!failed.length) {
  console.log('All gates pass.\n');
  process.exit(0);
}
console.log(`${failed.length} gate(s) failing: ${failed.map(g => g.name).join(', ')}\n`);
process.exit(failed.length);
