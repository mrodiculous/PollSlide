// PollSlide — automated off-database backup endpoint.
//
// Reads the whole Realtime Database and stores a timestamped JSON snapshot in a
// Google Cloud Storage bucket, so backups live OUTSIDE the database (a bad actor or
// bug that wipes the DB cannot touch them). Triggered daily by Vercel Cron, or on
// demand by a signed-in admin.
//
// Auth: Vercel cron secret (Authorization: Bearer $CRON_SECRET) OR a signed-in admin.
//
// Requires envs (already used by other endpoints): FIREBASE_PROJECT_ID,
// FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL, CRON_SECRET.
// Plus ONE of:
//   BACKUP_BUCKET  — a GCS bucket name to write to (recommended; e.g. "<project>.appspot.com").
//   (none)         — falls back to returning the JSON as a download (manual pull only).
//
// Retention: keeps the last BACKUP_KEEP (default 30) snapshots in the bucket.

const admin = require('firebase-admin');
const { getApp, verifyToken, tokenFrom, ADMIN_EMAILS } = require('../lib/quota');

module.exports = async function handler(req, res) {
  // ── auth ──
  let by = null;
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization === 'Bearer ' + secret) {
    by = 'cron';
  } else {
    const tok = tokenFrom(req);
    if (!tok) return res.status(401).json({ error: 'No auth' });
    let who;
    try { who = await verifyToken(tok); } catch (e) { return res.status(401).json({ error: 'Invalid auth token' }); }
    if (!ADMIN_EMAILS.includes(who.email)) return res.status(403).json({ error: 'Admins only' });
    by = who.email;
  }

  let db;
  try { db = admin.database(getApp()); }
  catch (e) { return res.status(500).json({ error: 'Firebase admin not configured', detail: e.message }); }

  // ── read whole DB ──
  let data;
  try { const snap = await db.ref('/').get(); data = snap.exists() ? snap.val() : {}; }
  catch (e) { return res.status(500).json({ error: 'DB read failed', detail: e.message }); }

  const json = JSON.stringify(data);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `pollslide-backup-${stamp}.json`;
  const bucketName = process.env.BACKUP_BUCKET;

  // ── Option A: store in GCS (real automated off-site backup) ──
  if (bucketName) {
    try {
      const bucket = admin.storage(getApp()).bucket(bucketName);
      await bucket.file(`backups/${filename}`).save(json, {
        contentType: 'application/json', resumable: false,
        metadata: { cacheControl: 'no-store' },
      });

      // retention: keep the last N
      const keep = Number(process.env.BACKUP_KEEP || 30);
      try {
        const [files] = await bucket.getFiles({ prefix: 'backups/pollslide-backup-' });
        const sorted = files.sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first (ISO names sort)
        await Promise.all(sorted.slice(keep).map(f => f.delete().catch(() => {})));
      } catch (e) { /* retention is best-effort */ }

      await db.ref('admin/backups/log/' + stamp).set({ at: Date.now(), by, bytes: json.length, file: `backups/${filename}`, bucket: bucketName, ok: true });
      return res.status(200).json({ ok: true, stored: `gs://${bucketName}/backups/${filename}`, bytes: json.length, by });
    } catch (e) {
      await db.ref('admin/backups/log/' + stamp).set({ at: Date.now(), by, bytes: json.length, ok: false, error: e.message }).catch(() => {});
      return res.status(500).json({ error: 'Backup write failed — is BACKUP_BUCKET correct and Storage enabled?', detail: e.message });
    }
  }

  // ── Option B: no bucket → return as a download (manual pull; cron cannot persist this) ──
  await db.ref('admin/backups/log/' + stamp).set({ at: Date.now(), by, bytes: json.length, mode: 'download' }).catch(() => {});
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(json);
};
