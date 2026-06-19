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
const admin = require('firebase-admin');

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

    const { action, wsId, email, role, uid, emailKey: ek } = req.body || {};

    const wsData = async id => { const s = await db.ref('workspaces/' + id).get(); return s.exists() ? s.val() : null; };
    const requireManager = async id => {
      const ws = await wsData(id);
      if (!ws) throw { code: 404, msg: 'Workspace not found' };
      const m = ws.members && ws.members[callerUid];
      if (!m || !['owner', 'admin'].includes(m.role)) throw { code: 403, msg: 'Not authorized' };
      return ws;
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
        await db.ref('workspaces/' + wsId + '/members/' + uid).remove();
        return res.status(200).json({ ok: true });
      }
      case 'setRole': {
        const ws = await requireManager(wsId);
        if (uid === ws.ownerUid) return res.status(400).json({ error: 'Cannot change the owner' });
        const callerRole = ws.members[callerUid].role;
        if (role === 'member' && callerRole !== 'owner') return res.status(403).json({ error: 'Only the owner can demote an admin' });
        await db.ref('workspaces/' + wsId + '/members/' + uid + '/role').set(role === 'admin' ? 'admin' : 'member');
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
