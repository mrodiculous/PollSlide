#!/usr/bin/env node
/**
 * PollSlide — Realtime Database backup (local, on-demand or scheduled).
 *
 * Exports the ENTIRE RTDB to a timestamped JSON file in ./backups/, then prunes
 * backups older than KEEP_DAYS. Safe to run as often as you like.
 *
 * SETUP (once):
 *   1. Firebase Console → Project Settings → Service accounts → "Generate new private key".
 *   2. Save it as  service-account.json  in the repo root (it is git-ignored — never commit it).
 *   3. Set your database URL (Console → Realtime Database → the URL at the top), either:
 *        - env:  FIREBASE_DATABASE_URL="https://echonest-live-survey-default-rtdb.firebaseio.com"
 *        - or edit DEFAULT_DB_URL below.
 *   4. From the repo:  npm install   (installs firebase-admin, already a dependency)
 *
 * RUN:
 *   node scripts/backup.js                 # full backup → ./backups/
 *   FIREBASE_DATABASE_URL=... node scripts/backup.js
 *   node scripts/backup.js --out /Volumes/Backup/pollslide   # backup to an external drive
 *
 * SCHEDULE (macOS, recommended — runs on your always-on Mac):
 *   see  com.pollslide.backup.plist  and the DISASTER-RECOVERY.md runbook.
 *
 * This is the SECONDARY backup. The PRIMARY should be Firebase's own automated
 * daily backups (Blaze plan → GCS export) — see DISASTER-RECOVERY.md. Belt and braces.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Change this if you don't want to use the env var.
const DEFAULT_DB_URL = 'https://echonest-live-survey-default-rtdb.firebaseio.com';
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);

function arg(name) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; }

(async () => {
  let admin;
  try { admin = require('firebase-admin'); }
  catch (e) { console.error('✗ firebase-admin not installed. Run `npm install` in the repo root first.'); process.exit(1); }

  // ── credentials ──
  const saPath = path.join(process.cwd(), 'service-account.json');
  if (!fs.existsSync(saPath)) {
    console.error('✗ service-account.json not found in ' + process.cwd());
    console.error('  Firebase Console → Project Settings → Service accounts → Generate new private key,');
    console.error('  save it as service-account.json in the repo root (it is git-ignored).');
    process.exit(1);
  }
  const sa = require(saPath);
  const dbURL = arg('--db-url') || process.env.FIREBASE_DATABASE_URL || DEFAULT_DB_URL;

  admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: dbURL });
  console.log('• project :', sa.project_id);
  console.log('• database:', dbURL);

  // ── read the whole database ──
  let data;
  try {
    const snap = await admin.database().ref('/').get();
    data = snap.exists() ? snap.val() : {};
  } catch (e) {
    console.error('✗ Read failed:', e.message);
    console.error('  Check the database URL and that the service account has database read access.');
    process.exit(1);
  }

  // ── write timestamped file ──
  const outDir = arg('--out') || path.join(process.cwd(), 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const file = path.join(outDir, `pollslide-backup-${stamp}.json`);
  const json = JSON.stringify(data, null, 0);
  fs.writeFileSync(file, json);

  const topKeys = Object.keys(data);
  const users = data.users ? Object.keys(data.users).length : 0;
  const sessions = data.sessions ? Object.keys(data.sessions).length : 0;
  console.log(`✓ Backup written: ${file}`);
  console.log(`  size ${(json.length / 1024 / 1024).toFixed(2)} MB · top-level: ${topKeys.join(', ')}`);
  console.log(`  users: ${users} · sessions: ${sessions}`);

  // ── prune old backups ──
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  let pruned = 0;
  for (const f of fs.readdirSync(outDir)) {
    if (!/^pollslide-backup-.*\.json$/.test(f)) continue;
    const p = path.join(outDir, f);
    if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); pruned++; }
  }
  if (pruned) console.log(`  pruned ${pruned} backup(s) older than ${KEEP_DAYS} days`);
  process.exit(0);
})();
