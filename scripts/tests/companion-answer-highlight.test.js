/* The Mac companion must highlight the correct answer after reveal in EVERY choice
 * display mode, not just the neon bars. Reported 2026-09-23: Column, Donut and Pie
 * coloured the correct option green but skipped the two things that make bars read as
 * "here is the answer" — the ✓ marker and the dimming of wrong options. This locks in
 * that all of them now give the same treatment, and that an opinion poll (no correct
 * answer set) highlights nothing.
 *
 * Runs the REAL donutPieChartHTML extracted from companion.html, so it fails if the
 * shipped renderer drifts. Run: node scripts/tests/companion-answer-highlight.test.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'companion.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name));

/* ── Donut & Pie: execute the real renderer ─────────────────────────────────── */
console.log('\nDonut & Pie highlight the correct answer after reveal');
{
  const m = src.match(/function donutPieChartHTML\(mode, counts, total, correct, revealed, opts\) \{[\s\S]*?\n\}/);
  ok('donutPieChartHTML is present', !!m);

  if (m) {
    // Globals the function closes over.
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const PS_COLORS = ['#6c63ff', '#ff6584', '#f7b731', '#43b0f1', '#a55eea', '#26de81'];
    const escapeHtml = s => String(s);
    const curQ = { options: [{ text: 'Mars' }, { text: 'Venus' }, { text: 'Jupiter' }] };
    // Capture the real function by building it with its globals injected — avoids an
    // eval-into-block redeclaration and keeps it the shipped source verbatim.
    const donutPieChartHTML = new Function('letters', 'PS_COLORS', 'escapeHtml', 'curQ',
      m[0] + '\nreturn donutPieChartHTML;')(letters, PS_COLORS, escapeHtml, curQ);

    const counts = [{ i: 0, count: 3 }, { i: 1, count: 1 }, { i: 2, count: 2 }];   // A correct
    const opts = { palette: PS_COLORS, options: curQ.options };

    for (const mode of ['donut', 'pie']) {
      const live = donutPieChartHTML(mode, counts, 6, [0], false, opts);
      const revd = donutPieChartHTML(mode, counts, 6, [0], true, opts);
      const noca = donutPieChartHTML(mode, counts, 6, [], true, opts);

      ok(`${mode}: before reveal, no ✓ and nothing dimmed`,
         !live.includes('✓') && !live.includes('opacity="0.28"') && !/opacity:0\.4;/.test(live));
      ok(`${mode}: after reveal, correct slice is green`, revd.includes('#43e97b'));
      ok(`${mode}: after reveal, exactly one ✓ (the correct option)`, (revd.match(/✓/g) || []).length === 1);
      ok(`${mode}: after reveal, wrong slices dimmed`, revd.includes('opacity="0.28"'));
      ok(`${mode}: after reveal, wrong legend rows dimmed`, /opacity:0\.4;/.test(revd));
      ok(`${mode}: opinion poll (no correct answer) highlights nothing`,
         !noca.includes('✓') && !noca.includes('opacity="0.28"') && !/opacity:0\.4;/.test(noca));
    }
  }
}

/* ── Column: structural check on the inline block ───────────────────────────── */
console.log('\nColumn gives the correct answer the same treatment');
{
  const col = src.slice(src.indexOf("viewMode === 'column'"), src.indexOf("viewMode === 'pie'"));
  ok('column exists', col.length > 0);
  ok('it computes both showCorrect and isWrong', /showCorrect/.test(col) && /isWrong/.test(col));
  ok('it dims wrong columns after reveal', /opacity:0\.34;filter:grayscale/.test(col));
  ok('it marks the correct column with a ✓', /✓/.test(col));
  ok('it greens the correct column', /#43e97b/.test(col));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
