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
const { ADMIN_EMAILS } = require('../lib/quota');

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

    const { action, wsId, email, role, uid, emailKey: ek, tier } = req.body || {};
    const isSiteAdmin = ADMIN_EMAILS.includes(callerEmail);

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
          await db.ref('users/' + memberUid + '/tier').set('free');
          await db.ref('admin/users_index/' + memberUid + '/tier').set('free').catch(() => {});
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
        await db.ref('workspaces/' + inv.wsId + '/members/' + callerUid).set({ email: callerEmail, role: inv.role || 'member', joinedAt: Date.now() });
        await db.ref('workspaces/' + inv.wsId + '/invites/' + k).remove();
        await db.ref('team_invites/' + k).remove();
        await db.ref('users/' + callerUid + '/workspaceId').set(inv.wsId);
        await db.ref('users/' + callerUid + '/tier').set(ws.tier);
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
        if (snap.exists()) snap.forEach(s => { const v = s.val(); out.push({ id: s.key, name: v.name || '', tier: v.tier || 'team_small', ownerUid: v.ownerUid, createdAt: v.createdAt || 0, members: v.members || {}, invites: v.invites || {} }); });
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
        await db.ref('users/' + user.uid + '/tier').set(ws.tier);
        await db.ref('admin/users_index/' + user.uid + '/tier').set(ws.tier).catch(() => {});
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
          await db.ref('users/' + mUid + '/tier').set(t);
          await db.ref('admin/users_index/' + mUid + '/tier').set(t).catch(() => {});
        }
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
