/* Tests for provider selection in api/translate.js.
 *
 * Live translation used to try the Mac first and only call the cloud if that failed —
 * so an audience waited out gemma4's measured 10.5-12.9s, and a corrupted local reply
 * made it 10.5s PLUS a cloud call.
 *
 * It now HEDGES: the Mac starts alone, and the cloud is only asked if the Mac hasn't
 * answered within TRANSLATE_HEDGE_MS. A healthy warm local model therefore does all
 * the work and costs nothing, while a cold or struggling one stops being the room's
 * problem after the hedge instead of after twelve seconds.
 *
 * The failure modes that matter, and are covered here:
 *   • a healthy Mac wins and the cloud is never called at all
 *   • a slow Mac is rescued, and the wait is the hedge — not the Mac
 *   • local-only (no cloud key) still works
 *   • a local reply that fails the corruption gate must lose, not win
 *   • an unparseable reply must lose, not be returned as garbage
 *   • every provider failing must return null, so the audience sees the original
 *   • TRANSLATE_RACE=0 must genuinely not fire the second provider
 *
 * Run: node scripts/tests/translate-race.test.js
 */
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const QS = [{ stem: 'What is a gene?', options: ['A', 'B'] }];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* Load api/translate.js fresh with a given env and a stubbed fetch.
 * The module reads env into consts at load time, so it must be required AFTER the
 * env is set and with the require cache cleared. */
function load({ race = true, local = true, cloud = true, hedgeMs = 2500 }, responder) {
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  process.env.TRANSLATE_RACE      = race ? '1' : '0';
  process.env.TRANSLATE_HEDGE_MS  = String(hedgeMs);
  process.env.LOCAL_LLM_URL    = local ? 'https://mac.example/v1' : '';
  process.env.OPENAI_API_KEY   = cloud ? 'sk-test' : '';
  process.env.FIREBASE_PROJECT_ID = '';        // no admin creds → cache disabled

  const hits = { local: 0, openai: 0 };
  global.fetch = async (url, opts) => {
    const which = String(url).includes('mac.example') ? 'local' : 'openai';
    hits[which]++;
    const r = await responder(which, opts);
    if (r === 'throw') throw new Error(which + ' unreachable');
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: r } }] }) };
  };
  const mod = require(path.resolve(__dirname, '../../api/translate.js'));
  return { mod, hits };
}

const good = (prefix) => JSON.stringify({ questions: [{ stem: prefix + ' gene?', options: [prefix + ' A', prefix + ' B'] }] });
// Drops nothing, but the emoji gate is what rejects a corrupted local answer:
const QS_EMOJI = [{ stem: '🔴 What is a gene?', options: ['A', 'B'] }];
const dropsEmoji = JSON.stringify({ questions: [{ stem: 'Was ist ein Gen?', options: ['A', 'B'] }] });

async function run() {
  console.log('\nHedging: the Mac gets a head start, the cloud is a safety net');
  {
    // A healthy warm local model answers well inside the hedge.
    const { mod, hits } = load({ hedgeMs: 400 }, async (which) => {
      if (which === 'local') { await sleep(60); return good('[local]'); }
      await sleep(5); return good('[cloud]');
    });
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    ok('local answers and is used', r.provider === 'local', r.provider);
    ok('the cloud is never called at all', hits.openai === 0, hits);
  }
  {
    // A slow (cold, or struggling) local model stops being the room's problem.
    const { mod, hits } = load({ hedgeMs: 150 }, async (which) => {
      if (which === 'local') { await sleep(4000); return good('[local]'); }
      await sleep(60); return good('[cloud]');
    });
    const t0 = Date.now();
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    const ms = Date.now() - t0;
    ok('the cloud rescues it', r.provider === 'openai', r.provider);
    ok('and the wait is the hedge, not the Mac', ms < 1000, ms + 'ms');
    ok('the cloud was called exactly once', hits.openai === 1, hits);
  }
  {
    // No cloud key: hedging must not break the local-only setup.
    const { mod, hits } = load({ cloud: false, hedgeMs: 50 }, async () => { await sleep(300); return good('[local]'); });
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    ok('local-only still works with no cloud to hedge with', r.provider === 'local' && !!r.outQs);
    ok('and nothing tried to reach OpenAI', hits.openai === 0, hits);
  }
  {
    // Local dies instantly — the cloud should still be asked, after the hedge.
    const { mod } = load({ hedgeMs: 100 }, async (which) => {
      if (which === 'local') return 'throw';
      await sleep(30); return good('[cloud]');
    });
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    ok('a dead Mac falls through to the cloud', r.provider === 'openai', r.provider);
  }

  console.log('\nThe fast provider wins');
  {
    const { mod, hits } = load({ hedgeMs: 0 }, async (which) => {
      if (which === 'local') { await sleep(400); return good('[local]'); }
      await sleep(20); return good('[cloud]');
    });
    const t0 = Date.now();
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    const ms = Date.now() - t0;
    ok('cloud answer is used when it returns first', r.provider === 'openai', r.provider);
    ok('and we did NOT wait for the slow one', ms < 300, ms + 'ms');
    ok('both were actually started (that is the race)', hits.local === 1 && hits.openai === 1, hits);
  }

  console.log('\nA corrupted local reply loses');
  {
    const { mod } = load({ hedgeMs: 0 }, async (which) => {
      if (which === 'local') { await sleep(10); return dropsEmoji; }   // fast but drops 🔴
      await sleep(200); return JSON.stringify({ questions: [{ stem: '🔴 Was ist ein Gen?', options: ['A', 'B'] }] });
    });
    const r = await mod.__test.translateStructuredViaProviders(QS_EMOJI, 'German');
    ok('the fast-but-corrupted local answer is rejected', r.provider === 'openai', r.provider);
    ok('and the emoji survives', r.outQs && r.outQs[0].stem.includes('🔴'), r.outQs && r.outQs[0]);
  }

  console.log('\nUnparseable replies lose rather than leaking garbage');
  {
    const { mod } = load({ hedgeMs: 0 }, async (which) => {
      if (which === 'local') { await sleep(10); return 'Sure! Here you go: not json at all'; }
      await sleep(120); return good('[cloud]');
    });
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    ok('garbage is not returned as a translation', r.provider === 'openai', r.provider);
    ok('the real answer comes through', r.outQs && r.outQs[0].stem.startsWith('[cloud]'), r.outQs && r.outQs[0]);
  }

  console.log('\nWhen everything fails');
  {
    const { mod } = load({ hedgeMs: 0 }, async () => 'throw');
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    ok('returns null so the caller can fall back to the originals', r.outQs === null, r);
    ok('and names no provider', !r.provider, r.provider);
  }

  console.log('\nOne provider only');
  {
    const { mod, hits } = load({ local: false }, async () => good('[cloud]'));
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    ok('cloud alone still works', r.provider === 'openai' && !!r.outQs);
    ok('and the Mac is not called', hits.local === 0, hits);
  }
  {
    const { mod, hits } = load({ cloud: false }, async () => good('[local]'));
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    ok('local alone still works', r.provider === 'local' && !!r.outQs);
    ok('and OpenAI is not called', hits.openai === 0, hits);
  }

  console.log('\nTRANSLATE_RACE=0 really does go back to one-at-a-time');
  {
    const { mod, hits } = load({ race: false }, async (which) => {
      if (which === 'openai') { await sleep(10); return good('[cloud]'); }
      return good('[local]');
    });
    const r = await mod.__test.translateStructuredViaProviders(QS, 'German');
    ok('the first provider answers', !!r.outQs);
    ok('the second is never started', hits.local === 0 || hits.openai === 0, hits);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}
run();
