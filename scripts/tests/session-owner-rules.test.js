#!/usr/bin/env node
/* quiz_builder/<code> — the published questions every phone, big screen and add-in reads —
 * may only be written by the code's owner, an editor of its deck, or support (2026-10-10).
 * Before this, ".write": "auth != null" let ANY signed-in account, including the anonymous
 * sign-in the Mac companion uses, rewrite any session's questions knowing only its room code.
 *
 * The rule is evaluated here against a shim of the RTDB rule API (auth / data / newData /
 * root), and the presenter is checked for the claim-before-write it now depends on.
 * Run: node scripts/tests/session-owner-rules.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'database-rules.json'), 'utf8')).rules;
const QB = rules.quiz_builder.$sessionCode;
let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n));

/* A snapshot shim: .child(a).child(b)…, .exists(), .val(). */
const snap = (v) => ({
  child: (k) => snap(v && typeof v === 'object' ? v[k] : undefined),
  exists: () => v !== undefined && v !== null,
  val: () => (v === undefined ? null : v),
  isString: () => typeof v === 'string',
});
const DB = { deckGrants: { uOwner: { pres_1: { uEditor: 'edit', uViewer: 'view' } } } };
function canWrite(auth, before, after) {
  return Function('auth', 'data', 'newData', 'root', `return (${QB['.write']});`)(auth, snap(before), snap(after), snap(DB)) === true;
}
const user = (uid, extra) => Object.assign({ uid, provider: 'password', token: { email: uid + '@x.com' } }, extra || {});
const owned = { owner: 'uOwner', deck: 'pres_1', questions: [{ text: 'Q' }] };
const withQ = (o, q) => Object.assign({}, o, { questions: [{ text: q }] });

console.log('\nThe owner, editors and support keep working');
ok('owner rewrites their questions', canWrite(user('uOwner'), owned, withQ(owned, 'new')));
ok('an editor of the deck (deckGrants … = edit) can write', canWrite(user('uEditor'), owned, withQ(owned, 'edit')));
ok('support can write (masquerade, repairs)', canWrite(user('uSupport', { token: { email: 'help@pollslide.com' } }), owned, withQ(owned, 'fix')));
ok('a first claim: no owner yet, writer stamps themselves', canWrite(user('uNew'), { questions: [] }, { owner: 'uNew', deck: 'pres_9', questions: [] }));
ok('a brand-new code claimed by its creator', canWrite(user('uNew'), null, { owner: 'uNew', deck: 'pres_9' }));
ok('the owner deleting the whole node', canWrite(user('uOwner'), owned, null));

console.log('\nStrangers cannot');
ok('another signed-in account cannot rewrite questions', !canWrite(user('uStranger'), owned, withQ(owned, 'hacked')));
ok('a view-only grant cannot write', !canWrite(user('uViewer'), owned, withQ(owned, 'x')));
ok('the anonymous sign-in (Mac companion / console) cannot write', !canWrite({ uid: 'anon1', provider: 'anonymous', token: {} }, owned, withQ(owned, 'x')));
ok('signed out cannot write', !canWrite(null, owned, withQ(owned, 'x')));
ok('nobody can claim a code for someone else', !canWrite(user('uStranger'), null, { owner: 'uOwner' }));
ok('an unclaimed code cannot be written without claiming it', !canWrite(user('uStranger'), { questions: [] }, { questions: [{ text: 'x' }] }));
ok('a stranger cannot take over by changing owner', !canWrite(user('uStranger'), owned, Object.assign({}, owned, { owner: 'uStranger' })));

console.log('\nOwner is permanent');
const ov = QB.owner && QB.owner['.validate'];
const valid = (auth, before, after) => Function('auth', 'data', 'newData', `return (${ov});`)(auth, snap(before), snap(after)) === true;
ok('owner may be set once', valid(user('uOwner'), null, 'uOwner'));
ok('owner cannot be changed by the owner either', !valid(user('uOwner'), 'uOwner', 'uOther'));
ok('support can reassign (account moves)', valid(user('s', { token: { email: 'help@pollslide.com' } }), 'uOwner', 'uOther'));

console.log('\nThe app claims before it writes');
const P = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
ok('presenter defines ensureClaim and claims every own deck on load', /function ensureClaim\(/.test(P) && /claimAllMyCodes\(\);/.test(P));
const writesQ = [...P.matchAll(/await db\.ref\(`quiz_builder\/\$\{(\w+(?:\.\w+)?)\}\/questions`\)\.set/g)];
const unclaimed = writesQ.filter(m => !P.slice(Math.max(0, m.index - 400), m.index).includes('ensureClaim('));
ok(`every awaited questions write is preceded by ensureClaim (${writesQ.length} sites)`, writesQ.length >= 6 && unclaimed.length === 0);
ok('the open-deck mirror waits for the claim', /ensureClaim\(pres\.sessionCode, id\)\.then\(/.test(P));
const PS = fs.readFileSync(path.join(ROOT, 'present.html'), 'utf8');
ok('PresentSlide stamps owner before publishing', /quiz_builder\/'\+code\+'\/owner'\)\.get\(\)/.test(PS));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
