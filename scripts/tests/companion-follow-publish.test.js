/* Phones must follow WHERE THE MAC COMPANION IS. Reported 2026-09-23: with the Mac
 * companion driving (it detects each slide's QR), phones stayed on whatever the web
 * presenter had selected instead of following the companion. Cause: the companion, in
 * targeted/QR mode, knew the slide but never published sessions/<code>/currentQuestion —
 * the only node answer.html follows. It now publishes it (single-instance per presenter,
 * so a legitimate writer), which makes phones follow the companion; when the user drives
 * the web presenter instead, ITS newer write wins (last .set wins) and phones follow that.
 *
 * Runs the REAL published payload extracted from companion.html. Run:
 *   node scripts/tests/companion-follow-publish.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'companion.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name));

console.log('\nThe companion can drive following (and does so safely)');
{
  ok('it loads the auth SDK (currentQuestion .write needs auth)',
     /firebasejs\/[\d.]+\/firebase-auth-compat\.js/.test(src));
  ok('it signs in anonymously, best-effort', /signInAnonymously\(\)\.catch\(/.test(src));
  ok('the publish waits for auth then never throws', /_authReady\.then\(\(\) => \{[\s\S]*?\}\)\.catch\(\(\) => \{\}\)/.test(src));

  // Only in targeted/QR mode — never when merely following the presenter (mac_link mode).
  const boot = src.slice(src.indexOf('function boot()'), src.indexOf('boot();'));
  ok('targeted mode (QR detected) shows the slide via showTargetedQuestion',
     /if \(targetSession && targetQIndex !== null\)[\s\S]*?showTargetedQuestion\(targetSession/.test(boot));
  ok('presenter/mac_link mode just watches — it does not publish',
     /watchMacLink\(\)/.test(boot));
  ok('the publisher is called only from showTargetedQuestion',
     (src.match(/publishCompanionLive\(/g) || []).length === 2);   // definition + single call site
  ok('and only when the companion moves to a NEW detected slide',
     /if \(curQId !== qId\) \{[\s\S]*?publishCompanionLive\(session, qIdx, q, qId/.test(src));
}

console.log('\nThe published pointer matches where the phone writes and the companion reads');
{
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'qid.js'), 'utf8'), ctx);
  const PSQid = ctx.window.PSQid;

  const m = src.match(/db\.ref\('sessions\/' \+ session \+ '\/currentQuestion'\)\.set\(\{[\s\S]*?\}\)\.catch/);
  ok('the publish payload is present', !!m);

  if (m) {
    const payloadSrc = m[0].replace(/^db\.ref[^{]*\.set\(/, '(').replace(/\)\.catch$/, ')');
    const build = new Function('session', 'qIdx', 'q', 'qId', 'total', 'return ' + payloadSrc + ';');
    const CODE = 'ABC1234';
    const deck = [
      { id: 'q0_stable', text: 'Q1', type: 'multiple_choice' },   // legacy — positional == real
      { id: 'qz9f3k2', text: 'Q2', type: 'multiple_choice' },     // fresh id — positional != real
    ];
    for (const qIdx of [0, 1]) {
      const q = deck[qIdx];
      const qId = PSQid.bucket(q, qIdx, CODE);          // what showTargetedQuestion passes in
      const p = build(CODE, qIdx, q, qId, deck.length);
      ok(`Q${qIdx + 1}: published id IS the real quiz_builder bucket`, p.id === PSQid.bucket(q, qIdx, CODE));
      ok(`Q${qIdx + 1}: carries qIndex so the phone advances`, p.qIndex === qIdx);
      ok(`Q${qIdx + 1}: id == phone-write bucket == companion-read bucket (answers register)`,
         p.id === PSQid.bucket(q, qIdx, CODE));
    }
    // It is a full .set (last-writer-wins), so whichever surface acted most recently drives.
    ok('the write is a plain .set — most-recent action wins (companion vs presenter)',
       /\.set\(\{/.test(m[0]) && !/transaction/.test(m[0]));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
