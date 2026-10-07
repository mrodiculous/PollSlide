// PollSlide — Team workspace admin (server-authoritative)
// Vercel Serverless Function.
//
// Verifies the caller's Firebase ID token and performs all team mutations with the
// Admin SDK, so roles, seat limits, and (critically) invite acceptance can't be
// spoofed by a tampered client. The acceptance path verifies the verified email
// actually matches the pending invite — something RTDB rules can't express.
//
// Env (same as stripe-webhook.js): FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL, NEXT_PUBLIC_APP_URL.
//
// Admin (help@pollslide.com, via lib/quota ADMIN_EMAILS) can act on ANY
// workspace, plus admin-only actions: adminList, adminAssign, adminSetTier,
// adminDelete — these power the Teams page in admin.html.
const admin = require('firebase-admin');
const { setUserTier } = require('../lib/tier');
const { ADMIN_EMAILS } = require('../lib/quota');
const TT = require('../lib/team-transfer');
const { tierForSubscription } = require('../lib/stripe-tier');

/* What Stripe says one account pays for: { customerId, subs: [{ id, status, tier, metadata }] }.
   Read for the owner-handover preview and re-read right before the transfer runs. */
async function stripeBilling(db, uid) {
  const out = { customerId: null, subs: [] };
  const cust = (await db.ref('users/' + uid + '/stripeCustomerId').get()).val();
  if (!cust) return out;
  out.customerId = cust;
  if (!process.env.STRIPE_SECRET_KEY) throw { code: 500, msg: 'Stripe is not configured on the server — cannot check billing.' };
  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' });
  const list = await stripe.subscriptions.list({ customer: cust, status: 'all', limit: 100 });
  for (const sub of list.data) {
    if (!TT.LIVE.includes(sub.status)) continue;
    out.subs.push({ id: sub.id, status: sub.status, tier: await tierForSubscription(stripe, sub, { strict: true }), metadata: sub.metadata || {} });
  }
  out.stripe = stripe;
  return out;
}

function getApp() {
  if (admin.apps.length) return admin.apps[0];
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) {
    throw { code: 500, msg: 'Firebase Admin credentials not configured.' };
  }
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const SEATS = { team_small: 5, team_large: 25 };
function seatLimit(ws) { return SEATS[ws && ws.tier] || 5; }
function emailKey(e) { return (e || '').toLowerCase().trim().replace(/[.#$/\[\]@]/g, '_'); }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const app = getApp();
    const db  = admin.database(app);

    // ── Authenticate the caller via their Firebase ID token ──
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    const decoded = await admin.auth(app).verifyIdToken(token);
    const callerUid   = decoded.uid;
    const callerEmail = (decoded.email || '').toLowerCase();

    const { action, wsId, email, role, uid, emailKey: ek, tier, expiresAt, note } = req.body || {};
    const isSiteAdmin = ADMIN_EMAILS.includes(callerEmail);
    /* Who did it, for the tier audit trail. This was referenced by every tier change in this
       file and never defined (found 2026-09-27), so removing a member, adding one from Admin,
       changing a team's plan and starting or ending a demo all threw PART-WAY through:
       e.g. a removed member was detached but kept the paid plan. */
    const who = { email: callerEmail, uid: callerUid };
    // Best-effort customer emails. A mail failure never undoes or fails a team change.
    const mail = async (type, to, data) => {
      if (!to) return;
      try {
        const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
        await fetch(`${APP_URL}/api/send-email`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
          body: JSON.stringify({ type, to, data }) });
      } catch (e) { console.error('team mail failed (non-fatal):', type, e.message); }
    };

    const wsData = async id => { const s = await db.ref('workspaces/' + id).get(); return s.exists() ? s.val() : null; };
    const requireManager = async id => {
      const ws = await wsData(id);
      if (!ws) throw { code: 404, msg: 'Workspace not found' };
      if (isSiteAdmin) return ws; // site admin can manage any workspace
      const m = ws.members && ws.members[callerUid];
      if (!m || !['owner', 'admin'].includes(m.role)) throw { code: 403, msg: 'Not authorized' };
      return ws;
    };
    const requireSiteAdmin = () => { if (!isSiteAdmin) throw { code: 403, msg: 'Admins only' }; };
    // Detach a member: remove from the workspace AND clean their user record
    // right away (no waiting for the client-side self-heal at next sign-in).
    const detachMember = async (id, memberUid, ws) => {
      await db.ref('workspaces/' + id + '/members/' + memberUid).remove();
      const wsIdSnap = await db.ref('users/' + memberUid + '/workspaceId').get();
      if (wsIdSnap.val() === id) {
        await db.ref('users/' + memberUid + '/workspaceId').remove();
        if (memberUid !== ws.ownerUid) {
          await setUserTier(db, memberUid, 'free', { source:'team', actor: who.email || 'owner', reason:'removed from workspace' });
        }
      }
    };

    switch (action) {
      case 'invite': {
        const ws = await requireManager(wsId);
        const e = (email || '').toLowerCase().trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.status(400).json({ error: 'Invalid email' });
        const k = emailKey(e);
        const r = role === 'admin' ? 'admin' : 'member';
        if (Object.values(ws.members || {}).some(m => (m.email || '').toLowerCase() === e)) return res.status(409).json({ error: 'Already a member' });
        if (Object.keys(ws.members || {}).length + Object.keys(ws.invites || {}).length >= seatLimit(ws)) return res.status(409).json({ error: 'No seats left' });
        const inv = { email: e, role: r, invitedBy: callerEmail, createdAt: Date.now() };
        await db.ref('workspaces/' + wsId + '/invites/' + k).set(inv);
        await db.ref('team_invites/' + k).set({ wsId, wsName: ws.name || '', role: r, invitedBy: callerEmail, createdAt: inv.createdAt });
        // Tell the invitee — without this they'd only find out if they happened
        // to sign in with this email. Best-effort: the invite stands either way.
        try {
          const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
          await fetch(`${APP_URL}/api/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
            body: JSON.stringify({ type: 'team_invite', to: e, data: { wsName: ws.name || '', invitedBy: callerEmail, role: r } }),
          });
        } catch (mailErr) { console.error('Invite email failed (non-fatal):', mailErr.message); }
        return res.status(200).json({ ok: true });
      }
      case 'accept': {
        const k = emailKey(callerEmail);
        const invSnap = await db.ref('team_invites/' + k).get();
        if (!invSnap.exists()) return res.status(404).json({ error: 'No pending invite' });
        const inv = invSnap.val();
        const ws = await wsData(inv.wsId);
        if (!ws) { await db.ref('team_invites/' + k).remove(); return res.status(404).json({ error: 'Workspace no longer exists' }); }
        if (Object.keys(ws.members || {}).length >= seatLimit(ws)) return res.status(409).json({ error: 'Workspace is full' });
        // Airtight: the invite on the workspace must match the caller's verified email.
        const wsInv = ws.invites && ws.invites[k];
        if (!wsInv || (wsInv.email || '').toLowerCase() !== callerEmail) return res.status(403).json({ error: 'Invite does not match your account' });
        /* The role comes from the workspace's own invite (written by its owner/admin), never
           from the team_invites index, which is only a lookup and must not grant anything. */
        await db.ref('workspaces/' + inv.wsId + '/members/' + callerUid).set({ email: callerEmail, role: wsInv.role === 'admin' ? 'admin' : 'member', joinedAt: Date.now() });
        await db.ref('workspaces/' + inv.wsId + '/invites/' + k).remove();
        await db.ref('team_invites/' + k).remove();
        await db.ref('users/' + callerUid + '/workspaceId').set(inv.wsId);
        await setUserTier(db, callerUid, ws.tier, { source:'team', actor:'self', reason:'accepted team invite', ref: inv.wsId });
        // Tell the owner their seat was taken — otherwise they only find out by opening the panel.
        const ownerEmail = ((ws.members || {})[ws.ownerUid] || {}).email;
        const used = Object.keys(ws.members || {}).length + 1;
        await mail('team_joined', ownerEmail, { wsName: ws.name || '', memberEmail: callerEmail, used, limit: seatLimit(ws) });
        return res.status(200).json({ ok: true, wsId: inv.wsId, tier: ws.tier, wsName: ws.name || '' });
      }
      case 'remove': {
        const ws = await requireManager(wsId);
        if (uid === ws.ownerUid) return res.status(400).json({ error: 'Cannot remove the owner' });
        await detachMember(wsId, uid, ws);
        return res.status(200).json({ ok: true });
      }
      case 'setRole': {
        const ws = await requireManager(wsId);
        if (uid === ws.ownerUid) return res.status(400).json({ error: 'Cannot change the owner' });
        const callerRole = isSiteAdmin ? 'owner' : (ws.members[callerUid] || {}).role;
        if (role === 'member' && callerRole !== 'owner') return res.status(403).json({ error: 'Only the owner can demote an admin' });
        await db.ref('workspaces/' + wsId + '/members/' + uid + '/role').set(role === 'admin' ? 'admin' : 'member');
        return res.status(200).json({ ok: true });
      }
      // ── Site-admin actions (admin.html → Teams page) ──
      case 'adminList': {
        requireSiteAdmin();
        const snap = await db.ref('workspaces').get();
        const out = [];
        if (snap.exists()) snap.forEach(s => { const v = s.val(); out.push({ id: s.key, name: v.name || '', tier: v.tier || 'team_small', ownerUid: v.ownerUid, createdAt: v.createdAt || 0, members: v.members || {}, invites: v.invites || {}, comp: v.comp || null }); });
        return res.status(200).json({ ok: true, workspaces: out, seats: SEATS });
      }
      case 'adminAssign': {
        // Add an EXISTING account to a workspace directly — no invite dance.
        requireSiteAdmin();
        const ws = await wsData(wsId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });
        const e = (email || '').toLowerCase().trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.status(400).json({ error: 'Invalid email' });
        if (Object.values(ws.members || {}).some(m => (m.email || '').toLowerCase() === e)) return res.status(409).json({ error: 'Already a member' });
        if (Object.keys(ws.members || {}).length + Object.keys(ws.invites || {}).length >= seatLimit(ws)) return res.status(409).json({ error: 'No seats left' });
        let user;
        try { user = await admin.auth(app).getUserByEmail(e); }
        catch (err) { return res.status(404).json({ error: 'No account with that email — send an invite instead' }); }
        const r = role === 'admin' ? 'admin' : 'member';
        await db.ref('workspaces/' + wsId + '/members/' + user.uid).set({ email: e, role: r, joinedAt: Date.now() });
        await db.ref('users/' + user.uid + '/workspaceId').set(wsId);
        await setUserTier(db, user.uid, ws.tier, { source:'team', actor: who.email || 'admin', reason:'added to workspace by admin', ref: wsId });
        return res.status(200).json({ ok: true, uid: user.uid });
      }
      case 'adminSetTier': {
        requireSiteAdmin();
        const ws = await wsData(wsId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });
        const t = SEATS[tier] ? tier : null;
        if (!t) return res.status(400).json({ error: 'Tier must be team_small or team_large' });
        await db.ref('workspaces/' + wsId + '/tier').set(t);
        for (const mUid of Object.keys(ws.members || {})) {
          if (mUid === ws.ownerUid) continue; // owner's tier follows their own billing
          await setUserTier(db, mUid, t, { source:'team', actor: who.email || 'admin', reason:'workspace tier changed', ref: wsId });
        }
        return res.status(200).json({ ok: true });
      }
      case 'adminComp': {
        // Comp a whole workspace as a free DEMO for a period. Unlike adminSetTier, this
        // ALSO grants the owner the tier (a demo has no paying owner) and records a comp
        // marker with an optional expiresAt that /api/comp-sweep uses to auto-revert.
        requireSiteAdmin();
        const ws = await wsData(wsId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });
        const t = SEATS[tier] ? tier : null;
        if (!t) return res.status(400).json({ error: 'Tier must be team_small or team_large' });
        const exp = expiresAt ? Number(expiresAt) : null;
        if (exp !== null && (!Number.isFinite(exp) || exp <= Date.now())) return res.status(400).json({ error: 'End date must be in the future' });
        await db.ref('workspaces/' + wsId + '/tier').set(t);
        await db.ref('workspaces/' + wsId + '/comp').set({ by: callerEmail, at: Date.now(), expiresAt: exp, note: String(note || '').slice(0, 300) });
        for (const mUid of Object.keys(ws.members || {})) {  // everyone incl. the owner
          await setUserTier(db, mUid, t, { source:'team', actor: who.email || 'admin', reason:'workspace tier changed', ref: wsId });
        }
        return res.status(200).json({ ok: true });
      }
      case 'adminEndComp': {
        // End a demo now (or the sweep does it on expiry): everyone incl. owner → Free,
        // then delete the (content-free) workspace. Members' presentations are untouched.
        requireSiteAdmin();
        const ws = await wsData(wsId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });
        for (const mUid of Object.keys(ws.members || {})) {
          await db.ref('users/' + mUid + '/workspaceId').remove().catch(() => {});
          await setUserTier(db, mUid, 'free', { source:'team', actor: who.email || 'admin', reason:'workspace deleted', ref: wsId });
        }
        for (const k of Object.keys(ws.invites || {})) await db.ref('team_invites/' + k).remove().catch(() => {});
        await db.ref('workspaces/' + wsId).remove();
        return res.status(200).json({ ok: true });
      }
      case 'adminDelete': {
        requireSiteAdmin();
        const ws = await wsData(wsId);
        if (!ws) return res.status(404).json({ error: 'Workspace not found' });
        for (const mUid of Object.keys(ws.members || {})) await detachMember(wsId, mUid, ws);
        for (const k of Object.keys(ws.invites || {})) await db.ref('team_invites/' + k).remove().catch(() => {});
        await db.ref('workspaces/' + wsId).remove();
        return res.status(200).json({ ok: true });
      }
      /* ── Team owner handover (2026-10-07) — see lib/team-transfer.js for the rule ──
         adminTransferPlan: preview only, changes nothing. adminTransferOwner: re-checks
         everything, then Stripe first (re-tag the subscription + customer), then the database
         in one multi-path update; if the database write fails, the Stripe tags are put back. */
      case 'adminTransferPlan':
      case 'adminTransferOwner': {
        requireSiteAdmin();
        const ws = await wsData(wsId);
        const toUid = String(uid || '');
        const fromUid = ws && ws.ownerUid;
        const moveBillingEmail = (req.body || {}).moveBillingEmail !== false;
        const from = fromUid ? await stripeBilling(db, fromUid) : { subs: [] };
        const to = toUid ? await stripeBilling(db, toUid) : { subs: [] };
        const plan = TT.planTransfer({ ws, fromUid, toUid, from, to, moveBillingEmail });
        const view = { ok: plan.ok, problems: plan.problems, steps: plan.steps, notes: plan.notes };
        if (action === 'adminTransferPlan') return res.status(200).json({ ok: true, plan: view });
        if ((req.body || {}).confirm !== 'TRANSFER') return res.status(400).json({ error: 'Type TRANSFER to confirm.' });
        const reason = String((req.body || {}).reason || '').slice(0, 300);
        if (!reason) return res.status(400).json({ error: 'Record who asked for this and how you verified it (SOP).' });
        if (!plan.ok) return res.status(409).json({ error: plan.problems.join(' '), plan: view });

        // 1) Stripe: re-tag the subscription and its customer to the new owner.
        let stripeDone = false;
        if (plan.moveSub) {
          const stripe = from.stripe;
          await stripe.subscriptions.update(plan.moveSub.id, { metadata: { ...plan.moveSub.metadata, firebase_uid: toUid } });
          const cust = await stripe.customers.retrieve(plan.customerId);
          await stripe.customers.update(plan.customerId, { metadata: { ...((cust && cust.metadata) || {}), firebase_uid: toUid },
            ...(moveBillingEmail && plan.toEmail ? { email: plan.toEmail } : {}) });
          stripeDone = true;
        }
        // 2) Database, all at once.
        const upd = {
          [`workspaces/${wsId}/ownerUid`]: toUid,
          [`workspaces/${wsId}/members/${toUid}/role`]: 'owner',
          [`workspaces/${wsId}/members/${fromUid}/role`]: 'admin',
        };
        if (plan.moveSub) Object.assign(upd, {
          [`users/${toUid}/stripeCustomerId`]: plan.customerId, [`admin/users_index/${toUid}/stripeCustomerId`]: plan.customerId,
          [`users/${fromUid}/stripeCustomerId`]: null, [`admin/users_index/${fromUid}/stripeCustomerId`]: null,
        });
        try { await db.ref('/').update(upd); }
        catch (e) {
          if (stripeDone) {   // put Stripe back so billing still points at the owner the database has
            try {
              await from.stripe.subscriptions.update(plan.moveSub.id, { metadata: { ...plan.moveSub.metadata, firebase_uid: fromUid } });
              await from.stripe.customers.update(plan.customerId, { metadata: { firebase_uid: fromUid }, ...(moveBillingEmail && plan.fromEmail ? { email: plan.fromEmail } : {}) });
            } catch (e2) { throw { code: 500, msg: 'Database update failed AND Stripe could not be put back — fix by hand: subscription ' + plan.moveSub.id + ' / customer ' + plan.customerId + ' must carry firebase_uid ' + fromUid + '.' }; }
          }
          throw { code: 500, msg: 'Database update failed; nothing was changed (Stripe was put back). ' + (e.message || '') };
        }
        // 3) Plans: both stay on the team plan (the new owner as payer, the old one as admin).
        await setUserTier(db, toUid, ws.tier, { source: 'team', actor: who.email, reason: 'became team owner (handover)', ref: wsId });
        await setUserTier(db, fromUid, ws.tier, { source: 'team', actor: who.email, reason: 'handed team ownership over', ref: wsId });
        await db.ref('admin/account_audit').push({ at: Date.now(), by: callerEmail, type: 'team_owner_transferred', ws: wsId,
          from: plan.fromEmail, to: plan.toEmail, billingMoved: !!plan.moveSub, subscription: plan.moveSub ? plan.moveSub.id : null, reason }).catch(() => {});
        const note = `Team ownership of ${ws.name || 'your team'} moved from ${plan.fromEmail} to ${plan.toEmail}.` + (plan.moveSub ? ' The team subscription moved with it — same card and renewal date, nothing was charged.' : '');
        await mail('notify', plan.toEmail, { subject: 'You now own your PollSlide team', heading: 'You are the team owner', body: note + ' You can now invite people and use "Manage billing" from your account menu.' });
        await mail('notify', plan.fromEmail, { subject: 'Your PollSlide team has a new owner', heading: 'Team ownership handed over', body: note + ' You stay on the team as an admin. Questions? Reply to this email.' });
        return res.status(200).json({ ok: true, plan: view });
      }
      case 'leave': {
        // A member leaves on their own — before, only an owner/admin could remove them.
        const ws = await wsData(wsId);
        if (!ws || !(ws.members || {})[callerUid]) return res.status(404).json({ error: 'You are not in this team' });
        if (ws.ownerUid === callerUid) return res.status(400).json({ error: 'The owner can\'t leave their own team. Cancel the team plan instead, or contact support to hand the team over.' });
        await detachMember(wsId, callerUid, ws);
        return res.status(200).json({ ok: true });
      }
      case 'resend': {
        // Resend an invite email that went to spam or was deleted. Same people who can invite.
        const ws = await requireManager(wsId);
        const inv = (ws.invites || {})[ek];
        if (!inv) return res.status(404).json({ error: 'That invite no longer exists' });
        await mail('team_invite', inv.email, { wsName: ws.name || '', invitedBy: inv.invitedBy || callerEmail, role: inv.role });
        await db.ref('workspaces/' + wsId + '/invites/' + ek + '/resentAt').set(Date.now());
        return res.status(200).json({ ok: true });
      }
      case 'adminCreate': {
        /* Support: a team-plan account with no team yet (a buyer who never opened Team admin).
           Creates exactly what the app's loadOrCreateWorkspace() creates, owned by that user. */
        requireSiteAdmin();
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(uid || ''))) return res.status(400).json({ error: 'Missing user id' });
        const existing = (await db.ref('users/' + uid + '/workspaceId').get()).val();
        if (existing && await wsData(existing)) return res.status(409).json({ error: 'That account is already in a team' });
        const u = (await db.ref('users/' + uid).get()).val() || {};
        const t = SEATS[u.tier] ? u.tier : null;
        if (!t) return res.status(400).json({ error: 'That account is not on a team plan' });
        let ownerEmail = (u.email || '').toLowerCase();
        try { ownerEmail = (await admin.auth(app).getUser(uid)).email || ownerEmail; } catch (e) {}
        const id = 'ws_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        await db.ref('workspaces/' + id).set({ name: (ownerEmail || 'My') + '’s Team', ownerUid: uid, tier: t, createdAt: Date.now(),
          members: { [uid]: { email: ownerEmail, role: 'owner', joinedAt: Date.now() } }, createdBy: callerEmail });
        await db.ref('users/' + uid + '/workspaceId').set(id);
        return res.status(200).json({ ok: true, wsId: id });
      }
      case 'revoke': {
        await requireManager(wsId);
        await db.ref('workspaces/' + wsId + '/invites/' + ek).remove();
        await db.ref('team_invites/' + ek).remove();
        return res.status(200).json({ ok: true });
      }
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    const code = Number.isInteger(e.code) ? e.code : 500;
    return res.status(code).json({ error: e.msg || e.message || 'Server error' });
  }
};
