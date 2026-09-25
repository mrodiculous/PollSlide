/* The sandbox must never change production and must never reach live data.
 * Executes the real ps-env.js under simulated hosts. Run: node scripts/tests/sandbox-env.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'ps-env.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n));

function run(host, search, sandboxCfg) {
  let code = src;
  if (sandboxCfg) code = code.replace(/var SANDBOX = \{[\s\S]*?\};/, 'var SANDBOX = ' + JSON.stringify(sandboxCfg) + ';');
  const calls = [];
  const firebase = { initializeApp: (cfg, name) => { calls.push(cfg); return { cfg, name }; } };
  const doc = { body: { appendChild() {} }, createElement: () => ({ style: {}, set textContent(v) {} }), addEventListener() {} };
  const win = {};
  const ctx = { window: win, location: { hostname: host, search: search || '', origin: 'https://' + host }, firebase, document: doc };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  return { env: win.PS_ENV, firebase, calls };
}
const LIVE = { apiKey: 'live', databaseURL: 'https://echonest-live-survey-default-rtdb.firebaseio.com', projectId: 'echonest-live-survey' };

console.log('\nProduction is untouched');
{
  const r = run('app.pollslide.com');
  ok('env is production', r.env.name === 'production');
  ok('answer links stay https://app.pollslide.com', r.env.appOrigin === 'https://app.pollslide.com');
  r.firebase.initializeApp(LIVE);
  ok('initializeApp receives the page\'s own (live) config unchanged', r.calls[0] === LIVE);
  const l = run('localhost');
  ok('localhost without ?sandbox=1 behaves as production', l.env.name === 'production');
}
console.log('\nAn unconfigured sandbox fails closed');
{
  const r = run('pollslide-git-staging.vercel.app');
  ok('a preview host is sandbox', r.env.name === 'sandbox');
  let threw = false; try { r.firebase.initializeApp(LIVE); } catch (e) { threw = true; }
  ok('it refuses to connect instead of using live data', threw && r.calls.length === 0);
  const m = run('staging.pollslide.com', '', LIVE);
  let threw2 = false; try { m.firebase.initializeApp(LIVE); } catch (e) { threw2 = true; }
  ok('pasting the LIVE project into the sandbox slot is also refused', threw2);
}
console.log('\nA configured sandbox is fully separate');
{
  const SB = { apiKey: 'sb', authDomain: 'x', databaseURL: 'https://pollslide-sandbox-default-rtdb.firebaseio.com', projectId: 'pollslide-sandbox', storageBucket: 'x', messagingSenderId: '1', appId: '1' };
  const r = run('staging.pollslide.com', '', SB);
  r.firebase.initializeApp(LIVE, 'named');
  ok('the live config a page passes is replaced by the sandbox one', r.calls[0].projectId === 'pollslide-sandbox');
  ok('named apps (e.g. masquerade) are redirected too', r.calls.length === 1);
  ok('QR/answer links point at the sandbox host', r.env.appOrigin === 'https://staging.pollslide.com');
}
console.log('\nEvery app page loads the switch before Firebase starts');
{
  /* The PowerPoint add-in pages (powerpoint.html, powerpoint-content/index.html) are left out
     on purpose: they are frozen as submitted to Microsoft AppSource and must not change.
     On a sandbox host they still talk to the LIVE project — see docs/SANDBOX.md, Known limits. */
  const pages = ['companion.html','answer.html','admin.html','live.html','overlay.html','report.html','present.html','presenter.html','results.html','recap.html'];
  for (const p of pages) {
    const h = fs.readFileSync(path.join(ROOT, p), 'utf8');
    const sdk = h.search(/firebase-app-compat\.js/), env = h.search(/\/ps-env\.js\?v=/), init = h.search(/initializeApp\(/);
    ok(p + ': ps-env.js after the SDK, before initializeApp', sdk > -1 && env > sdk && init > env);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
