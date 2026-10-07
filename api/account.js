// PollSlide — Account changes (server-authoritative). Vercel Serverless Function.
//
// Self-service (the signed-in user, from Account settings in the presenter):
//   syncEmail      after Firebase has changed the sign-in address (the user clicked the
//                  link sent to the NEW address), bring every copy of it in line.
//                  The new address comes from the verified ID token — never the body.
//
// Admin only (help@pollslide.com — Admin → Accounts):
//   adminFind            look an account up by email or uid
//   adminChangeEmail     change a user's sign-in email for them (after the SOP checks)
//   adminTransferPlan    what moving one account's content into another would do
//   adminTransferRun     do it (backup → copy → verify → remove)
//   adminTransferUndo    put a transfer back from its backup
//   adminSuspend         suspend / unsuspend an account (can't sign in; sessions ended)
//   adminSignOutAll      sign an account out on every device
//
// Identity always comes from the verified token (see memory: endpoint-auth-hardening).
// Every change is appended to admin/account_audit.
const admin = require('firebase-admin');
const { ADMIN_EMAILS } = require('../lib/quota');
const A = require('../lib/account');

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

async function stripeUpdate(customerId, email) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe not configured');
  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' });
  await stripe.customers.update(customerId, { email });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const app = getApp();
    const db = admin.database(app);
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sign in required.' });
    let decoded;
    try { decoded = await admin.auth(app).verifyIdToken(token); }
    catch (e) { return res.status(401).json({ error: 'Your session expired — sign in again.' }); }
    const callerUid = decoded.uid;
    const callerEmail = (decoded.email || '').toLowerCase();
    const isAdmin = ADMIN_EMAILS.includes(callerEmail);
    const body = req.body || {};
    const action = body.action;

    const audit = (entry) => db.ref('admin/account_audit').push(Object.assign({ at: Date.now(), by: callerEmail }, entry)).catch(() => {});
    // Best-effort mail. A mail failure never undoes an account change.
    const mail = async (type, to, data) => {
      if (!to) return;
      try {
        const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
        await fetch(`${APP_URL}/api/send-email`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
          body: JSON.stringify({ type, to, data }) });
      } catch (e) { console.error('account mail failed (non-fatal):', type, e.message); }
    };

    /* ── Self: the sign-in address has changed; update the copies ── */
    if (action === 'syncEmail') {
      if (!decoded.email || decoded.email_verified !== true) return res.status(400).json({ error: 'Confirm your new email address first (check its inbox).' });
      const u = (await db.ref('users/' + callerUid).get()).val() || {};
      const recorded = String(u.pendingEmailFrom || '').toLowerCase();
      if (!recorded && String(u.email || '').toLowerCase() === callerEmail) return res.status(200).json({ ok: true, changed: false });
      const r = await A.syncEmail(db, { uid: callerUid, newEmail: callerEmail, oldEmails: recorded ? [recorded] : [], stripeUpdate });
      if (!r.previous.length) return res.status(200).json({ ok: true, changed: false });
      await audit({ type: 'email_changed', uid: callerUid, from: r.previous.join(', '), to: r.email, self: true, done: r.done, problems: r.problems });
      for (const old of r.previous) await mail('email_changed', old, { newEmail: r.email, oldEmail: old, audience: 'old' });
      await mail('email_changed', r.email, { newEmail: r.email, oldEmail: r.previous[0], audience: 'new' });
      return res.status(200).json({ ok: true, changed: true, done: r.done, problems: r.problems });
    }

    if (!isAdmin) return res.status(403).json({ error: 'Not allowed.' });

    /* ── Admin ── */
    if (action === 'adminFind') {
      const q = String(body.query || '').trim();
      if (!q) return res.status(400).json({ error: 'Enter an email or uid.' });
      let u;
      try { u = A.isEmail(q) ? await admin.auth(app).getUserByEmail(q.toLowerCase()) : await admin.auth(app).getUser(q); }
      catch (e) { return res.status(404).json({ error: 'No account with that email or uid.' }); }
      const rec = (await db.ref('users/' + u.uid).get()).val() || {};
      return res.status(200).json({ ok: true, user: {
        uid: u.uid, email: u.email || '', emailVerified: !!u.emailVerified, disabled: !!u.disabled,
        providers: (u.providerData || []).map(p => p.providerId),
        created: u.metadata && u.metadata.creationTime, lastSignIn: u.metadata && u.metadata.lastSignInTime,
        tier: rec.tier || 'free', decks: Object.keys(rec.presentations || {}).length,
        classes: Object.keys(rec.classes || {}).length, workspaceId: rec.workspaceId || null,
        stripeCustomerId: rec.stripeCustomerId || null, pendingEmail: rec.pendingEmail || null,
        suspended: rec.suspended || null,
      } });
    }

    if (action === 'adminChangeEmail') {
      const uid = String(body.uid || ''), next = String(body.newEmail || '').toLowerCase().trim();
      const reason = String(body.reason || '').slice(0, 300);
      if (!uid || !A.isEmail(next)) return res.status(400).json({ error: 'A uid and a valid new email are required.' });
      if (!reason) return res.status(400).json({ error: 'Record how you verified the request (SOP step 2).' });
      let u;
      try { u = await admin.auth(app).getUser(uid); } catch (e) { return res.status(404).json({ error: 'No such account.' }); }
      const old = (u.email || '').toLowerCase();
      if (old === next) return res.status(400).json({ error: 'That is already their email.' });
      try { await admin.auth(app).getUserByEmail(next); return res.status(409).json({ error: 'Another account already uses that email. Move content instead (SOP: duplicate accounts).' }); }
      catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
      /* A Google sign-in account's address comes from Google, so changing only the email
         field leaves them signing in with the OLD Google account. switchToPassword (Route A,
         2026-10-01): same account — uid, plan, team, decks, billing all kept — but Google
         sign-in is removed and they set a password from a reset email at the NEW address. */
      const isGoogle = (u.providerData || []).some(p => p.providerId === 'google.com');
      const toPassword = !!body.switchToPassword && isGoogle;
      if (isGoogle && !toPassword) return res.status(400).json({ error: 'This account signs in with Google. Choose "Switch to email + password at the new address", or move their content to a new account instead (SOP §2).' });
      await admin.auth(app).updateUser(uid, Object.assign({ email: next, emailVerified: false }, toPassword ? { providersToUnlink: ['google.com'] } : {}));
      const r = await A.syncEmail(db, { uid, newEmail: next, oldEmails: [old], stripeUpdate });
      await audit({ type: 'email_changed', uid, from: old, to: next, self: false, reason, done: r.done, problems: r.problems, switchedToPassword: toPassword || undefined });
      await mail('email_changed', old, { newEmail: next, oldEmail: old, audience: 'old', bySupport: true });
      await mail('email_changed', next, { newEmail: next, oldEmail: old, audience: 'new', bySupport: true, switchedToPassword: toPassword });
      return res.status(200).json({ ok: true, done: r.done, problems: r.problems, switchedToPassword: toPassword });
    }

    /* ── Suspend / unsuspend, sign out everywhere (2026-10-07) ──
       Suspend: Firebase "disabled" (no new sign-in) + every refresh token revoked (each device
       is signed out within the hour, when its current token expires). It does NOT touch the
       Stripe subscription — the Admin screen says so — and it never deletes anything: an
       audience can still answer this person's QR codes. Admin accounts can't be suspended. */
    if (action === 'adminSuspend' || action === 'adminSignOutAll') {
      const uid = String(body.uid || '');
      const reason = String(body.reason || '').slice(0, 300);
      if (!uid) return res.status(400).json({ error: 'A uid is required.' });
      if (!reason) return res.status(400).json({ error: 'Record why (e.g. "abuse report #123", "user asked — lost laptop").' });
      let u;
      try { u = await admin.auth(app).getUser(uid); } catch (e) { return res.status(404).json({ error: 'No such account.' }); }
      if (ADMIN_EMAILS.includes((u.email || '').toLowerCase())) return res.status(400).json({ error: 'Admin accounts can\'t be suspended or signed out from here.' });
      if (action === 'adminSignOutAll') {
        await admin.auth(app).revokeRefreshTokens(uid);
        await audit({ type: 'signed_out_everywhere', uid, email: u.email || '', reason });
        return res.status(200).json({ ok: true });
      }
      const suspend = body.suspend !== false;
      await admin.auth(app).updateUser(uid, { disabled: suspend });
      if (suspend) await admin.auth(app).revokeRefreshTokens(uid);
      await db.ref('users/' + uid + '/suspended').set(suspend ? { at: Date.now(), by: callerEmail, reason } : null);
      await audit({ type: suspend ? 'account_suspended' : 'account_unsuspended', uid, email: u.email || '', reason });
      return res.status(200).json({ ok: true, disabled: suspend });
    }

    if (action === 'adminTransferPlan') {
      const plan = await A.transferPlan(db, String(body.fromUid || ''), String(body.toUid || ''));
      return res.status(200).json({ ok: true, plan });
    }

    if (action === 'adminTransferRun') {
      if (body.confirm !== 'MOVE') return res.status(400).json({ error: 'Type MOVE to confirm.' });
      const reason = String(body.reason || '').slice(0, 300);
      if (!reason) return res.status(400).json({ error: 'Record how you verified both accounts belong to this person (SOP).' });
      const r = await A.transferRun(db, String(body.fromUid || ''), String(body.toUid || ''), { actor: callerEmail });
      await audit({ type: 'content_moved', uid: String(body.fromUid), toUid: String(body.toUid), transfer: r.id, moved: r.moved, reason });
      return res.status(200).json({ ok: true, result: r });
    }

    if (action === 'adminTransferUndo') {
      const r = await A.transferUndo(db, String(body.id || ''));
      await audit({ type: 'content_move_undone', transfer: r.id });
      return res.status(200).json({ ok: true, result: r });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    const code = (e && e.code && Number.isInteger(e.code)) ? e.code : 500;
    console.error('account error:', e && (e.msg || e.message) || e);
    return res.status(code).json({ error: (e && (e.msg || e.message)) || 'Something went wrong.' });
  }
};
