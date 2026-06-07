// PollSlide — Complete Account Deletion (Server-Side)
// Vercel Serverless Function
//
// Why server-side? Firebase Auth user deletion requires the Admin SDK.
// Client-side Firebase can't delete Auth users — that's by design for security.
//
// Security model:
// - The caller sends their Firebase ID token in the Authorization header
// - We verify it server-side with admin.auth().verifyIdToken()
// - We only delete if token.uid === the uid being deleted, OR caller is admin
// - This means a user can only delete their own account, admins can delete any

const admin = require('firebase-admin');

const ADMIN_EMAILS = ['help@pollslide.com'];

function getApp() {
  if (admin.apps.length > 0) return admin.apps[0];
  const pk = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!pk) throw new Error('FIREBASE_PRIVATE_KEY not set');
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  pk,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Verify Firebase ID token from Authorization header
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) return res.status(401).json({ error: 'No auth token provided' });

  let app, decodedToken;
  try {
    app = getApp();
    decodedToken = await admin.auth(app).verifyIdToken(idToken);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid auth token: ' + e.message });
  }

  const callerUid   = decodedToken.uid;
  const callerEmail = decodedToken.email || '';
  const { uid } = req.body || {};

  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  // Security: only the account owner or an admin can delete
  const isOwner = callerUid === uid;
  const isAdmin = ADMIN_EMAILS.includes(callerEmail);
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'Not authorised to delete this account' });
  }

  const db = admin.database(app);
  const results = { auth: false, database: false, sessions: false };
  const errors  = [];

  // 1. Get user data for cleanup + audit trail
  let userEmail = '', sessionCodes = [];
  try {
    const userSnap = await db.ref('users/' + uid).get();
    if (userSnap.exists()) {
      const userData = userSnap.val();
      userEmail = userData.email || '';
      const pres = userData.presentations || {};
      sessionCodes = Object.values(pres)
        .filter(p => p.sessionCode)
        .map(p => p.sessionCode);
    }
  } catch (e) { errors.push('user_read: ' + e.message); }

  // 2. Delete Firebase Auth user
  try {
    await admin.auth(app).deleteUser(uid);
    results.auth = true;
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      results.auth = true; // Already deleted — fine
    } else {
      errors.push('auth_delete: ' + e.message);
    }
  }

  // 3. Delete all database records
  try {
    const deletes = {
      ['users/' + uid]:                    null,
      ['admin/users_index/' + uid]:        null,
      ['mac_link/' + uid]:                 null,
      ['admin/deletion_requests/' + uid]:  null,
      ['admin/flags/' + uid]:              null,
      ['admin/notes/' + uid]:              null,
    };
    await db.ref('/').update(deletes);
    results.database = true;
  } catch (e) { errors.push('db_delete: ' + e.message); }

  // 4. Delete all session response data
  try {
    const sessionDeletes = {};
    for (const code of sessionCodes) {
      sessionDeletes['sessions/' + code + '/responses'] = null;
      sessionDeletes['sessions/' + code + '/currentQuestion'] = null;
      sessionDeletes['sessions/' + code + '/meta'] = null;
    }
    if (Object.keys(sessionDeletes).length > 0) {
      await db.ref('/').update(sessionDeletes);
    }
    results.sessions = true;
  } catch (e) { errors.push('sessions_delete: ' + e.message); }

  // 5. Write audit log (admin-only writes this — caller is verified above)
  try {
    await db.ref('admin/deleted_accounts/' + uid).set({
      email:       userEmail,
      deletedAt:   Date.now(),
      deletedBy:   callerEmail,
      selfDelete:  isOwner,
      results,
    });
  } catch (e) { /* Audit failure shouldn't block response */ }

  const success = results.auth && results.database;
  return res.status(success ? 200 : 500).json({
    success,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
};
