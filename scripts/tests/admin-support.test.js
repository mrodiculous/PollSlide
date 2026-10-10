#!/usr/bin/env node
/* Admin & support audit, 10 Oct 2026.
 *  1. /api/ai-status named every AI vendor and model behind Polly to anyone who asked.
 *     It is admin-only now — users never learn which AI answered.
 *  2. "Priority support" is sold on Pro and Team, but a ticket never showed its sender's
 *     plan. Tickets now carry a plan badge and paying plans sort first among those waiting.
 * Run: node scripts/tests/admin-support.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const A = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const S = fs.readFileSync(path.join(ROOT, 'api', 'ai-status.js'), 'utf8');

(async () => {
  console.log('\nAI status is admin-only');
  const handler = require(path.join(ROOT, 'api', 'ai-status.js'));
  const call = async (headers) => { let code = 0, body = null; const res = { setHeader() {}, status(c) { code = c; return this; }, json(b) { body = b; return this; }, end() { return this; } };
    await handler({ method: 'GET', headers: headers || {}, body: {} }, res); return { code, body }; };
  const anon = await call({});
  ok('no sign-in → 401, and not one provider or model name in the reply', anon.code === 401 && !/openai|local|fal|model/i.test(JSON.stringify(anon.body)), anon);
  const bad = await call({ authorization: 'Bearer not-a-real-token' });
  ok('a made-up token → refused', bad.code === 401 || bad.code === 403, bad);
  ok('the check runs BEFORE any provider is probed', S.indexOf("if (!ADMIN_EMAILS.includes(who.email))") > 0 && S.indexOf("if (!ADMIN_EMAILS.includes(who.email))") < S.indexOf('const localLLM   = await probe('));
  ok('the admin panel sends its sign-in token', /fetch\('\/api\/ai-status',\{headers:\{'Authorization':'Bearer '\+t\}\}\)/.test(A));
  ok('no runbook step or quick link still points at the open URL', !/curl -s https:\/\/app\.pollslide\.com\/api\/ai-status/.test(A) && !/href:'https:\/\/app\.pollslide\.com\/api\/ai-status'/.test(A));

  console.log('\nPriority support can actually be given');
  ok('paying plans rank above Free: Enterprise > Team Large > Team Small > Pro > Free', /const PRIO=\{enterprise:4,team_large:3,team_small:2,pro:1,free:0\};/.test(A));
  ok('order: waiting-on-us first, then plan, then most recent activity', /\(T\.needsResponse\(b\[1\]\)-T\.needsResponse\(a\[1\]\)\)\|\|\(prio\(b\[1\]\)-prio\(a\[1\]\)\)\|\|byActivity\(a,b\)/.test(A));
  ok('every ticket row shows the sender\'s plan', /\$\{planPill\}\$\{needs\?/.test(A) && /const planPill=/.test(A));
  ok('an unknown sender or unknown tier counts as Free, never crashes the list', /return PRIO\[x\]===undefined\?'free':x;/.test(A));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
