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


// A backup that fails silently is worse than no backup: it LOOKS like it's working
// right up until the day you need it. Every other cron here emails on trouble; this
// one didn't. Best-effort — an email problem must never mask the backup result.
async function alertBackup(subject, body) {
  try {
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
    await fetch(APP_URL + '/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify({
        type: 'notify',
        to: process.env.LEGAL_ALERT_EMAIL || 'help@pollslide.com',
        data: { subject, heading: 'Backup', body },
      }),
    });
  } catch (e) { /* alerting is best-effort */ }
}

// Has a backup succeeded recently? A cron that quietly stops firing (expired creds,
// changed schedule) leaves no failure to alert on — only an absence — so we check for
// the absence explicitly.
async function checkBackupFreshness(db) {
  try {
    const maxAgeH = Number(process.env.BACKUP_MAX_AGE_HOURS || 48);
    const snap = await db.ref('admin/backups/log').orderByKey().limitToLast(40).get();
    if (!snap.exists()) return;
    let newestOk = 0;
    snap.forEach(c => { const v = c.val(); if (v && v.ok !== false && v.at > newestOk) newestOk = v.at; });
    const ageH = newestOk ? (Date.now() - newestOk) / 3600000 : Infinity;
    if (ageH > maxAgeH) {
      await db.ref('admin/backups/stale').set({ at: Date.now(), lastGoodAt: newestOk || null, ageHours: Math.round(ageH) });
      await alertBackup('⚠️ No successful PollSlide backup in ' + Math.round(ageH) + 'h',
        'The most recent successful backup is ' + (newestOk ? new Date(newestOk).toISOString() : 'NONE ON RECORD') +
        '. Check the Vercel cron and BACKUP_BUCKET / storage credentials.');
    } else {
      await db.ref('admin/backups/stale').remove().catch(() => {});
    }
  } catch (e) { /* freshness check is advisory */ }
}

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
      await checkBackupFreshness(db);
      return res.status(200).json({ ok: true, stored: `gs://${bucketName}/backups/${filename}`, bytes: json.length, by });
    } catch (e) {
      await db.ref('admin/backups/log/' + stamp).set({ at: Date.now(), by, bytes: json.length, ok: false, error: e.message }).catch(() => {});
      await alertBackup('🚨 PollSlide backup FAILED',
        'The nightly backup could not be written.<br><br><b>Error:</b> ' + String(e.message).slice(0, 300) +
        '<br><br>Check BACKUP_BUCKET, Firebase Storage, and the service-account permissions. Until this is fixed there is no fresh off-site copy.');
      return res.status(500).json({ error: 'Backup write failed — is BACKUP_BUCKET correct and Storage enabled?', detail: e.message });
    }
  }

  // ── Option B: no bucket → return as a download (manual pull; cron cannot persist this) ──
  await db.ref('admin/backups/log/' + stamp).set({ at: Date.now(), by, bytes: json.length, mode: 'download' }).catch(() => {});
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.status(200).send(json);
};
