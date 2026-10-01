/* While Microsoft reviews PollSlide LIVE, the add-in must not change (2026-10-01).
 * The reviewer tests the live page; the only way to change a submission is to cancel it.
 * Delete SUBMIT-TO-MICROSOFT/REVIEW-FREEZE.json on approval and this test passes again.
 * Run: node scripts/tests/addin-review-freeze.test.js */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..'), F = path.join(ROOT, 'SUBMIT-TO-MICROSOFT', 'REVIEW-FREEZE.json');
console.log('\nPollSlide LIVE: frozen while Microsoft reviews it');
if (!fs.existsSync(F)) { console.log('  ✓ not in review — no freeze\n\n1 passed, 0 failed'); process.exit(0); }
const freeze = JSON.parse(fs.readFileSync(F, 'utf8'));
let pass = 0, fail = 0;
for (const [f, h] of Object.entries(freeze.files)) {
  const now = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  if (now === h) { pass++; console.log('  ✓ ' + f + ' unchanged since submission'); }
  else { fail++; console.log('  ✗ ' + f + ' CHANGED while Microsoft is reviewing it (submitted ' + freeze.submittedAt + '). Undo it, or — only once approved — delete SUBMIT-TO-MICROSOFT/REVIEW-FREEZE.json.'); }
}
if (freeze.qidCore) {
  // The add-in loads the LIVE /qid.js. The functions it uses must behave exactly as submitted.
  const src = fs.readFileSync(path.join(ROOT, 'qid.js'), 'utf8');
  const core = src.slice(src.indexOf('bucket: function'), src.indexOf('/* ── LINK NUMBERS'));
  const now = crypto.createHash('sha256').update(core).digest('hex');
  if (now === freeze.qidCore) { pass++; console.log('  ✓ qid.js — the functions the add-in uses are unchanged'); }
  else { fail++; console.log('  ✗ qid.js — a function the add-in uses (bucket/backfill/fresh/isLegacy) CHANGED during review. Add new functions after them instead.'); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
