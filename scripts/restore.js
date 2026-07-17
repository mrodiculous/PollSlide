#!/usr/bin/env node
/**
 * PollSlide — Realtime Database restore (careful, staged).
 *
 * Restores data from a backup JSON produced by scripts/backup.js. Defaults to a
 * DRY RUN and to a SCOPED path so you can never nuke the whole DB by accident.
 *
 * USAGE:
 *   # 1) Inspect what a backup contains (no writes):
 *   node scripts/restore.js <backup.json> --path users/<uid>/presentations --dry-run
 *
 *   # 2) Restore ONE user's presentations (the common "someone deleted their stuff" case):
 *   node scripts/restore.js <backup.json> --path users/<uid>/presentations --apply
 *
 *   # 3) Restore a single presentation:
 *   node scripts/restore.js <backup.json> --path "users/<uid>/presentations/<presId>" --apply
 *
 *   # 4) FULL restore of the entire database (rare — disaster only). Requires BOTH flags:
 *   node scripts/restore.js <backup.json> --all --apply --i-understand-this-overwrites-everything
 *
 * Notes:
 *   - --apply WRITES with .set(), which OVERWRITES the target path with the backup value.
 *     Anything currently under that path that is NOT in the backup is removed. That is why
 *     you scope with --path: restoring users/<uid>/presentations only touches that subtree.
 *   - Always take a fresh backup FIRST (node scripts/backup.js) so the pre-restore state is
 *     itself recoverable.
 *   - Credentials + DB URL: same as backup.js (service-account.json + FIREBASE_DATABASE_URL).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_URL = 'https://echonest-live-survey-default-rtdb.firebaseio.com';
function has(flag) { return process.argv.includes(flag); }
function arg(name) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; }
function getIn(obj, dbPath) { return dbPath.split('/').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj); }

(async () => {
  const backupFile = process.argv[2];
  if (!backupFile || backupFile.startsWith('--')) {
    console.error('Usage: node scripts/restore.js <backup.json> --path <db/path> [--apply]');
    console.error('       node scripts/restore.js <backup.json> --all --apply --i-understand-this-overwrites-everything');
    process.exit(1);
  }
  if (!fs.existsSync(backupFile)) { console.error('✗ Backup file not found:', backupFile); process.exit(1); }

  const dbPath = arg('--path');
  const all = has('--all');
  const apply = has('--apply');            // default is dry-run
  const forced = has('--i-understand-this-overwrites-everything');

  if (!dbPath && !all) { console.error('✗ Specify --path <db/path> (recommended) or --all (full restore).'); process.exit(1); }
  if (all && apply && !forced) { console.error('✗ Full restore needs the explicit flag: --i-understand-this-overwrites-everything'); process.exit(1); }

  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  const target = all ? '/' : dbPath;
  const value = all ? backup : getIn(backup, dbPath);

  if (value === undefined) { console.error(`✗ Path "${dbPath}" does not exist in this backup.`); process.exit(1); }

  const preview = JSON.stringify(value);
  const keys = value && typeof value === 'object' ? Object.keys(value) : [];
  console.log('• backup :', backupFile);
  console.log('• target :', target);
  console.log('• payload:', (preview.length / 1024).toFixed(1), 'KB', keys.length ? `· keys: ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ' …' : ''}` : '');

  if (!apply) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to restore this path.');
    process.exit(0);
  }

  let admin;
  try { admin = require('firebase-admin'); } catch (e) { console.error('✗ Run `npm install` first.'); process.exit(1); }
  const saPath = path.join(process.cwd(), 'service-account.json');
  if (!fs.existsSync(saPath)) { console.error('✗ service-account.json not found (see backup.js setup).'); process.exit(1); }
  const sa = require(saPath);
  const dbURL = arg('--db-url') || process.env.FIREBASE_DATABASE_URL || DEFAULT_DB_URL;
  admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: dbURL });

  console.log(`\n⚠️  WRITING to ${dbURL}${target} — this overwrites that path with the backup value.`);
  console.log('   (Take a fresh backup first if you have not: node scripts/backup.js)');
  await new Promise(r => setTimeout(r, 4000));   // 4s to Ctrl-C

  try {
    await admin.database().ref(all ? '/' : dbPath).set(value);
    console.log('✓ Restore complete for', target);
  } catch (e) {
    console.error('✗ Restore failed:', e.message);
    process.exit(1);
  }
  process.exit(0);
})();
