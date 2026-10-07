/* Support tools (2026-10-07): suspend / unsuspend, sign out everywhere, team owner handover.
 * Run for real against api/account.js and api/team.js with an in-memory database and a fake
 * Stripe, checking the END STATE — including what must NOT have changed when a step refuses.
 * Run: node scripts/tests/support-tools.test.js */
const path = require('path'), Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')));

// ── in-memory RTDB ───────────────────────────────────────────────────────────
let TREE = {}, failUpdate = false;
const parts = (p) => String(p || '').split('/').filter(Boolean);
const getAt = (p) => { let n = TREE; for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; };
const setAt = (p, v) => { const ks = parts(p); let n = TREE; for (let i = 0; i < ks.length - 1; i++) { if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') n[ks[i]] = {}; n = n[ks[i]]; }
  const last = ks[ks.length - 1]; if (v === null || v === undefined) delete n[last]; else n[last] = JSON.parse(JSON.stringify(v)); };
const snap = (p) => { const v = getAt(p); return { exists: () => v !== null, val: () => v, forEach: (fn) => Object.entries(v || {}).forEach(([k, x]) => fn({ key: k, val: () => x })) }; };
let pushN = 0;
const db = { ref: (p) => ({ get: async () => snap(p), set: async (v) => setAt(p, v), remove: async () => setAt(p, null),
  update: async (o) => { if (failUpdate && p === '/') throw new Error('network'); Object.entries(o).forEach(([k, v]) => setAt(p + '/' + k, v)); },
  push: async (v) => setAt(p + '/k' + (++pushN), v) }) };

// ── fake Stripe ──────────────────────────────────────────────────────────────
let SUBS = {}, CUST = {};
const stripeCalls = [];
function FakeStripe() {
  return {
    subscriptions: {
      list: async ({ customer }) => ({ data: Object.values(SUBS).filter(s => s.customer === customer) }),
      update: async (id, o) => { stripeCalls.push(['sub', id, o]); SUBS[id] = { ...SUBS[id], metadata: o.metadata }; return SUBS[id]; } },
    customers: {
      retrieve: async (id) => CUST[id],
      update: async (id, o) => { stripeCalls.push(['cust', id, o]); CUST[id] = { ...CUST[id], ...(o.email ? { email: o.email } : {}), metadata: o.metadata }; return CUST[id]; } },
  };
}

const USERS = { owner1: 'owner@team.com', member1: 'maya@team.com', member2: 'leo@team.com', outsider: 'x@y.com', helpdesk: 'help@pollslide.com', target: 'troll@example.com' };
const DISABLED = {}, REVOKED = [];
const mails = [];
let caller = 'helpdesk';
const origLoad = Module._load;
Module._load = function (req) {
  if (req === 'firebase-admin') return { apps: [{}], initializeApp: () => ({}), database: () => db,
    auth: () => ({ verifyIdToken: async () => ({ uid: caller, email: USERS[caller] }),
      getUser: async (uid) => { if (!USERS[uid]) throw new Error('no'); return { uid, email: USERS[uid], providerData: [], metadata: {} }; },
      getUserByEmail: async (e) => { const uid = Object.keys(USERS).find(u => USERS[u] === e); if (!uid) { const er = new Error('no'); er.code = 'auth/user-not-found'; throw er; } return { uid, email: e }; },
      updateUser: async (uid, o) => { if ('disabled' in o) DISABLED[uid] = o.disabled; },
      revokeRefreshTokens: async (uid) => { REVOKED.push(uid); } }) };
  if (req === 'stripe') return FakeStripe;
  if (/lib\/tier$/.test(req)) return { setUserTier: async (d, uid, tier) => setAt('users/' + uid + '/tier', tier) };
  if (/lib\/quota$/.test(req)) return { ADMIN_EMAILS: ['help@pollslide.com'] };
  if (/lib\/stripe-tier$/.test(req)) return { tierForSubscription: async (s, sub) => sub.__tier };
  return origLoad.apply(this, arguments);
};
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
const teamHandler = require(path.join(ROOT, 'api', 'team.js'));
const accountHandler = require(path.join(ROOT, 'api', 'account.js'));
// Stubs stay in place: api/team.js loads 'stripe' lazily, at the moment it reads billing.
global.fetch = async (url, o) => { mails.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; };

const call = (handler, as, body) => { caller = as; return new Promise((resolve) => {
  const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); return this; }, end() { resolve({ code: this.code }); } };
  handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res); }); };
const team = (as, body) => call(teamHandler, as, body), account = (as, body) => call(accountHandler, as, body);

function seed({ comp = false, ownerSubs = 1, newOwnerSub = false } = {}) {
  TREE = { users: {
      owner1: { tier: 'team_small', workspaceId: 'ws1', ...(comp ? {} : { stripeCustomerId: 'cus_A' }) },
      member1: { tier: 'team_small', workspaceId: 'ws1', ...(newOwnerSub ? { stripeCustomerId: 'cus_M' } : {}) },
      target: { tier: 'pro', stripeCustomerId: 'cus_T' } },
    admin: { users_index: { owner1: comp ? {} : { stripeCustomerId: 'cus_A' } } },
    workspaces: { ws1: { name: 'Acme', ownerUid: 'owner1', tier: 'team_small', ...(comp ? { comp: { by: 'help@pollslide.com' } } : {}),
      members: { owner1: { email: 'owner@team.com', role: 'owner' }, member1: { email: 'maya@team.com', role: 'member' } }, invites: {} } } };
  SUBS = {}; CUST = { cus_A: { id: 'cus_A', email: 'owner@team.com', metadata: { firebase_uid: 'owner1' } }, cus_M: { id: 'cus_M', email: 'maya@team.com', metadata: { firebase_uid: 'member1' } } };
  if (!comp) for (let i = 0; i < ownerSubs; i++) SUBS['sub_A' + i] = { id: 'sub_A' + i, customer: 'cus_A', status: 'active', __tier: 'team_small', metadata: { firebase_uid: 'owner1', plan: 'team_small' } };
  if (newOwnerSub) SUBS.sub_M = { id: 'sub_M', customer: 'cus_M', status: 'active', __tier: 'pro', metadata: { firebase_uid: 'member1' } };
  stripeCalls.length = 0; mails.length = 0; failUpdate = false;
}
const go = { action: 'adminTransferOwner', wsId: 'ws1', uid: 'member1', confirm: 'TRANSFER', reason: 'Owner left Acme; CFO emailed from acme domain' };

(async () => {
  console.log('\nTeam owner handover — paid team');
  seed();
  let r = await team('helpdesk', { action: 'adminTransferPlan', wsId: 'ws1', uid: 'member1' });
  ok('preview: allowed, and says the subscription moves with no charge', r.code === 200 && r.body.plan.ok && r.body.plan.steps.some(s => /no charge/.test(s)), r.body);
  ok('preview changes nothing', getAt('workspaces/ws1/ownerUid') === 'owner1' && stripeCalls.length === 0);
  r = await team('helpdesk', { ...go, confirm: 'yes' });
  ok('needs TRANSFER typed', r.code === 400);
  r = await team('helpdesk', { ...go, reason: '' });
  ok('needs a recorded reason', r.code === 400);
  r = await team('owner1', go);
  ok('only site admins can transfer', r.code === 403, r);
  r = await team('helpdesk', go);
  ok('transfer succeeds', r.code === 200, r);
  ok('the new owner owns the team; the old owner is an admin', getAt('workspaces/ws1/ownerUid') === 'member1' && getAt('workspaces/ws1/members/member1/role') === 'owner' && getAt('workspaces/ws1/members/owner1/role') === 'admin');
  ok('the SAME subscription now points at the new owner (webhook will follow them)', SUBS.sub_A0.metadata.firebase_uid === 'member1' && SUBS.sub_A0.metadata.plan === 'team_small');
  ok('the Stripe customer is re-tagged and receipts go to the new owner', CUST.cus_A.metadata.firebase_uid === 'member1' && CUST.cus_A.email === 'maya@team.com');
  ok('"Manage billing" moves: the customer id is on the new owner, gone from the old', getAt('users/member1/stripeCustomerId') === 'cus_A' && getAt('users/owner1/stripeCustomerId') === null && getAt('admin/users_index/member1/stripeCustomerId') === 'cus_A');
  ok('both keep the team plan', getAt('users/member1/tier') === 'team_small' && getAt('users/owner1/tier') === 'team_small');
  ok('nothing was charged or created in Stripe (only metadata/email updates)', stripeCalls.every(c => c[0] === 'sub' || c[0] === 'cust') && stripeCalls.length === 2);
  ok('it is in the audit log and both people are emailed', Object.values(getAt('admin/account_audit') || {}).some(a => a.type === 'team_owner_transferred' && a.billingMoved) && mails.filter(m => m.type === 'notify').map(m => m.to).sort().join() === 'maya@team.com,owner@team.com');

  seed();
  r = await team('helpdesk', { ...go, moveBillingEmail: false });
  ok('receipts can stay with the old address if asked', r.code === 200 && CUST.cus_A.email === 'owner@team.com' && CUST.cus_A.metadata.firebase_uid === 'member1');

  console.log('\nTeam owner handover — refusals change nothing');
  seed({ newOwnerSub: true });
  r = await team('helpdesk', go);
  ok('the new owner already pays for their own plan → refused (no double billing)', r.code === 409 && /pay twice/.test(r.body.error), r.body);
  ok('…and nothing changed, in the database or Stripe', getAt('workspaces/ws1/ownerUid') === 'owner1' && stripeCalls.length === 0 && SUBS.sub_A0.metadata.firebase_uid === 'owner1');
  seed({ ownerSubs: 2 });
  r = await team('helpdesk', go);
  ok('the old owner has two live subscriptions → refused (which one pays?)', r.code === 409 && /2 live subscriptions/.test(r.body.error) && stripeCalls.length === 0, r.body);
  seed();
  r = await team('helpdesk', { ...go, uid: 'outsider' });
  ok('someone not on the team → refused', r.code === 409 && /must already be a member/.test(r.body.error), r.body);

  console.log('\nTeam owner handover — comped team, and a failure half-way');
  seed({ comp: true });
  r = await team('helpdesk', go);
  ok('a free demo team: ownership moves, Stripe untouched', r.code === 200 && getAt('workspaces/ws1/ownerUid') === 'member1' && stripeCalls.length === 0 && getAt('workspaces/ws1/comp'), r.body);
  seed(); failUpdate = true;
  r = await team('helpdesk', go);
  ok('database write fails after Stripe → error, and Stripe is put back to the old owner', r.code === 500 && SUBS.sub_A0.metadata.firebase_uid === 'owner1' && CUST.cus_A.metadata.firebase_uid === 'owner1' && CUST.cus_A.email === 'owner@team.com', r.body);
  ok('…and the team still belongs to the old owner', getAt('workspaces/ws1/ownerUid') === 'owner1');

  console.log('\nSuspend, unsuspend, sign out everywhere');
  seed();
  r = await account('helpdesk', { action: 'adminSuspend', uid: 'target', reason: '' });
  ok('a reason is required', r.code === 400);
  r = await account('helpdesk', { action: 'adminSuspend', uid: 'target', reason: 'abuse report #12' });
  ok('suspend: cannot sign in, every session ended, marked with who/why', r.code === 200 && DISABLED.target === true && REVOKED.includes('target') && getAt('users/target/suspended/reason') === 'abuse report #12');
  ok('…nothing deleted, plan and billing untouched', getAt('users/target/tier') === 'pro' && getAt('users/target/stripeCustomerId') === 'cus_T');
  r = await account('helpdesk', { action: 'adminSuspend', uid: 'target', reason: 'appeal accepted', suspend: false });
  ok('unsuspend: can sign in again, marker cleared', r.code === 200 && DISABLED.target === false && getAt('users/target/suspended') === null);
  REVOKED.length = 0;
  r = await account('helpdesk', { action: 'adminSignOutAll', uid: 'target', reason: 'user lost laptop' });
  ok('sign out everywhere ends sessions and changes nothing else', r.code === 200 && REVOKED.includes('target') && DISABLED.target === false);
  r = await account('helpdesk', { action: 'adminSuspend', uid: 'helpdesk', reason: 'oops' });
  ok('the admin account itself can never be suspended from here', r.code === 400 && DISABLED.helpdesk === undefined, r.body);
  r = await account('target', { action: 'adminSuspend', uid: 'owner1', reason: 'x' });
  ok('only admins can suspend', r.code === 403);
  const audit = Object.values(getAt('admin/account_audit') || {}).map(a => a.type);
  ok('every action is in the audit log', ['account_suspended', 'account_unsuspended', 'signed_out_everywhere'].every(t => audit.includes(t)), audit);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
