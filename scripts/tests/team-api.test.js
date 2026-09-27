/* Every team action, run for real against api/team.js with an in-memory database.
 *
 * 2026-09-27: `who` was used by every tier change in api/team.js and never defined, so
 * removing a member, adding one from Admin, changing a team's plan and starting/ending a
 * demo all crashed half-way (a removed member kept the paid plan). No test had ever run
 * this file. These run each action and check the END STATE, not just the status code.
 * Run: node scripts/tests/team-api.test.js */
const path = require('path'), Module = require('module');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));

// ── in-memory RTDB ────────────────────────────────────────────────────────────
let TREE = {};
const parts = (p) => String(p || '').split('/').filter(Boolean);
const getAt = (p) => { let n = TREE; for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; } return n === undefined ? null : n; };
const setAt = (p, v) => { const ks = parts(p); let n = TREE; for (let i = 0; i < ks.length - 1; i++) { if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') n[ks[i]] = {}; n = n[ks[i]]; }
  const last = ks[ks.length - 1]; if (v === null || v === undefined) delete n[last]; else n[last] = JSON.parse(JSON.stringify(v)); };
const snap = (p) => { const v = getAt(p); return { exists: () => v !== null, val: () => v, forEach: (fn) => Object.entries(v || {}).forEach(([k, x]) => fn({ key: k, val: () => x })) }; };
const db = { ref: (p) => ({ get: async () => snap(p), set: async (v) => setAt(p, v), remove: async () => setAt(p, null), update: async (o) => Object.entries(o).forEach(([k, v]) => setAt(p + '/' + k, v)) }) };

const USERS = { owner1: 'owner@team.com', member1: 'maya@team.com', member2: 'leo@team.com', buyer99: 'buyer@new.com', helpdesk: 'help@pollslide.com' };
const mails = [];
let caller = 'owner1';
const origLoad = Module._load;
Module._load = function (req) {
  if (req === 'firebase-admin') return { apps: [{}], initializeApp: () => ({}), database: () => db,
    auth: () => ({ verifyIdToken: async () => ({ uid: caller, email: USERS[caller] }),
                   getUserByEmail: async (e) => { const uid = Object.keys(USERS).find(u => USERS[u] === e); if (!uid) throw new Error('no user'); return { uid, email: e }; },
                   getUser: async (uid) => ({ uid, email: USERS[uid] }) }) };
  if (/lib\/tier$/.test(req)) return { setUserTier: async (d, uid, tier) => setAt('users/' + uid + '/tier', tier) };
  if (/lib\/quota$/.test(req)) return { ADMIN_EMAILS: ['help@pollslide.com'] };
  return origLoad.apply(this, arguments);
};
const handler = require(path.join(ROOT, 'api', 'team.js'));
Module._load = origLoad;
global.fetch = async (url, o) => { mails.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; };

function call(as, body) {
  caller = as;
  return new Promise((resolve) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); return this; }, end() { resolve({ code: this.code }); } };
    handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res);
  });
}
function seed() {
  TREE = { users: {
      owner1: { tier: 'team_small', workspaceId: 'ws1' }, member1: { tier: 'team_small', workspaceId: 'ws1' },
      member2: { tier: 'free' }, buyer99: { tier: 'team_large' } },
    workspaces: { ws1: { name: 'Acme', ownerUid: 'owner1', tier: 'team_small',
      members: { owner1: { email: 'owner@team.com', role: 'owner' }, member1: { email: 'maya@team.com', role: 'member' } }, invites: {} } } };
  mails.length = 0;
}
const key = (e) => e.replace(/[.#$/\[\]@]/g, '_');

(async () => {
  console.log('\nOwner and member actions');
  seed();
  let r = await call('owner1', { action: 'remove', wsId: 'ws1', uid: 'member1' });
  ok('removing a member succeeds (it used to crash on `who`)', r.code === 200, r);
  ok('…the member is off the team, unlinked, and back on Free', !getAt('workspaces/ws1/members/member1') && !getAt('users/member1/workspaceId') && getAt('users/member1/tier') === 'free');

  seed();
  r = await call('owner1', { action: 'invite', wsId: 'ws1', email: 'leo@team.com', role: 'member' });
  ok('an invite is created and emailed', r.code === 200 && getAt('team_invites/' + key('leo@team.com')) && mails.some(m => m.type === 'team_invite'));
  mails.length = 0;
  r = await call('owner1', { action: 'resend', wsId: 'ws1', emailKey: key('leo@team.com') });
  ok('the invite can be resent', r.code === 200 && mails.some(m => m.type === 'team_invite' && m.to === 'leo@team.com'));
  mails.length = 0;
  r = await call('member2', { action: 'accept' });
  ok('the invitee joins with the team\'s plan', r.code === 200 && getAt('users/member2/tier') === 'team_small' && getAt('users/member2/workspaceId') === 'ws1');
  ok('…and the owner is emailed that someone joined', mails.some(m => m.type === 'team_joined' && m.to === 'owner@team.com' && m.data.memberEmail === 'leo@team.com'));
  r = await call('member2', { action: 'leave', wsId: 'ws1' });
  ok('a member can leave on their own and goes back to Free', r.code === 200 && !getAt('workspaces/ws1/members/member2') && getAt('users/member2/tier') === 'free');
  r = await call('owner1', { action: 'leave', wsId: 'ws1' });
  ok('the owner cannot leave their own team', r.code === 400, r);
  r = await call('member1', { action: 'resend', wsId: 'ws1', emailKey: 'x' });
  ok('a plain member cannot resend invites', r.code === 403, r);

  console.log('\nAdmin (support) actions');
  seed();
  r = await call('helpdesk', { action: 'adminAssign', wsId: 'ws1', email: 'leo@team.com', role: 'member' });
  ok('"Add existing user" works and gives them the plan (it used to crash)', r.code === 200 && getAt('users/member2/tier') === 'team_small', r);
  r = await call('helpdesk', { action: 'adminSetTier', wsId: 'ws1', tier: 'team_large' });
  ok('changing a team\'s plan moves every member (it used to crash)', r.code === 200 && getAt('users/member1/tier') === 'team_large' && getAt('users/member2/tier') === 'team_large', r);
  r = await call('helpdesk', { action: 'adminComp', wsId: 'ws1', tier: 'team_small', expiresAt: Date.now() + 86400000 });
  ok('starting a demo works, owner included', r.code === 200 && getAt('users/owner1/tier') === 'team_small' && getAt('workspaces/ws1/comp'), r);
  r = await call('helpdesk', { action: 'adminEndComp', wsId: 'ws1' });
  ok('ending a demo works: everyone to Free, demo team removed', r.code === 200 && !getAt('workspaces/ws1') && getAt('users/member1/tier') === 'free', r);
  seed();
  r = await call('helpdesk', { action: 'adminDelete', wsId: 'ws1' });
  ok('deleting a team detaches members to Free, owner keeps own plan', r.code === 200 && !getAt('workspaces/ws1') && getAt('users/member1/tier') === 'free' && getAt('users/owner1/tier') === 'team_small', r);
  seed();
  r = await call('helpdesk', { action: 'adminCreate', uid: 'buyer99' });
  const wsId = r.body && r.body.wsId;
  ok('support can create the team for a buyer who has none', r.code === 200 && getAt('workspaces/' + wsId + '/ownerUid') === 'buyer99' && getAt('users/buyer99/workspaceId') === wsId && getAt('workspaces/' + wsId + '/tier') === 'team_large', r);
  r = await call('helpdesk', { action: 'adminCreate', uid: 'buyer99' });
  ok('…but never a second one', r.code === 409, r);
  r = await call('owner1', { action: 'adminCreate', uid: 'buyer99' });
  ok('only site admins can do it', r.code === 403, r);

  console.log('\nEmails exist for each step');
  const T = require(path.join(ROOT, 'api', 'send-email.js')).TEMPLATES;
  ok('team_joined, team_ended and team_invite templates render', ['team_joined', 'team_ended', 'team_invite'].every(k => T[k] && /<html/.test(T[k]({ wsName: 'A', memberEmail: 'a@b.c', ownerEmail: 'o@b.c', invitedBy: 'o@b.c' }).html)));
  ok('the team-plan confirmation says where Team admin is, with the team video', /Team admin/.test(T.upgrade({ planKey: 'team_small', plan: 'Team Small' }).html) && /team-setup/.test(T.upgrade({ planKey: 'team_small' }).html));
  ok('…and a Pro confirmation does not', !/team-setup/.test(T.upgrade({ planKey: 'pro', plan: 'Pro' }).html));
  const wh = require('fs').readFileSync(path.join(ROOT, 'api', 'stripe-webhook.js'), 'utf8');
  ok('members are emailed when the owner\'s team plan ends', /type: 'team_ended'/.test(wh) && /Promise\.allSettled/.test(wh));
  const pres = require('fs').readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
  ok('the app creates a buyer\'s team at sign-in and shows Team admin once', /await ensureTeamSetup\(\)/.test(pres) && /teamIntroSeen/.test(pres));
  ok('members see "Leave this team"; managers see "Resend"', /teamLeave\(\)/.test(pres) && /teamResend\(/.test(pres));

  console.log('\nThe watchdog notices teams out of step');
  const W = require(path.join(ROOT, 'lib', 'watchdog.js'));
  const unpaid = W.evalTeamDrift({ teams: [{ name: 'Acme', tier: 'team_small', ownerTier: 'free', members: [{ owner: true, tier: 'free', linked: true }, { tier: 'team_small', linked: true }] }] });
  ok('a team nobody pays for opens an incident', unpaid.ok === false && /nobody is paying/.test(unpaid.detail));
  const comp = W.evalTeamDrift({ teams: [{ name: 'Demo', tier: 'team_small', ownerTier: 'free', comp: true, members: [{ owner: true, tier: 'team_small', linked: true }] }] });
  ok('a free demo team (comp) is not flagged', comp.ok === true);
  const stuck = W.evalTeamDrift({ teams: [{ name: 'Acme', tier: 'team_small', ownerTier: 'team_small', members: [{ owner: true, tier: 'team_small', linked: true }, { tier: 'free', linked: true }] }] });
  ok('a member stuck on the wrong plan is flagged', stuck.ok === false && /1 member/.test(stuck.detail));
  ok('the check is wired into the watchdog', /id: 'team_drift'/.test(require('fs').readFileSync(path.join(ROOT, 'api', 'watchdog.js'), 'utf8')));
  const adm = require('fs').readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('Admin → Teams shows health, team-plan accounts with no team, and Resend', /function teamHealth\(/.test(adm) && /function teamOrphans\(/.test(adm) && /twResend\(/.test(adm));
  ok('a user\'s details show their team', /\$\{teamLineHtml\(uid\)\}/.test(adm));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
