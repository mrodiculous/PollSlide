#!/usr/bin/env node
/* One-time: stamp quiz_builder/<code>/owner (+ deck) on every existing session, so the
 * session-ownership rule (2026-10-10) can be published without locking anyone out.
 * The presenter also stamps its own codes at sign-in; this covers people who haven't
 * signed in since the code shipped. Already-stamped codes are never touched.
 *
 * Same setup as scripts/backup.js (service-account.json in the repo root, git-ignored).
 *
 *   node scripts/claim-session-owners.js            # dry run: counts only, writes nothing
 *   node scripts/claim-session-owners.js --write    # stamp them
 *
 * ROLLOUT ORDER (see TODO.md): 1) deploy the app  2) this script with --write
 * 3) publish database-rules.json in the Firebase console. Reversible: re-publish the
 * previous rules and nothing else changes — the owner fields are harmless on their own. */
'use strict';
const path = require('path');
const WRITE = process.argv.includes('--write');
const DB_URL = process.env.FIREBASE_DATABASE_URL || 'https://echonest-live-survey-default-rtdb.firebaseio.com';

(async () => {
  let admin;
  try { admin = require('firebase-admin'); } catch (e) { console.error('✗ Run `npm install` first.'); process.exit(1); }
  const key = path.resolve(__dirname, '..', 'service-account.json');
  try { admin.initializeApp({ credential: admin.credential.cert(require(key)), databaseURL: DB_URL }); }
  catch (e) { console.error('✗ ' + key + ' not found — see the setup in scripts/backup.js.'); process.exit(1); }
  const db = admin.database();

  const [usersSnap, qbSnap] = await Promise.all([db.ref('users').once('value'), db.ref('quiz_builder').once('value')]);
  const qb = qbSnap.val() || {};
  const codeOwner = {};             // code → { uid, presId } from every user's decks
  const clash = [];
  usersSnap.forEach(u => {
    const pres = (u.val() || {}).presentations || {};
    for (const [presId, p] of Object.entries(pres)) {
      const code = p && p.sessionCode; if (!code) continue;
      if (codeOwner[code] && codeOwner[code].uid !== u.key) clash.push(code);
      else codeOwner[code] = { uid: u.key, presId };
    }
  });

  const updates = {}; let already = 0, orphan = 0, stamped = 0;
  for (const code of Object.keys(qb)) {
    if (qb[code] && qb[code].owner) { already++; continue; }
    const o = codeOwner[code];
    if (!o || clash.includes(code)) { orphan++; continue; }
    updates[`quiz_builder/${code}/owner`] = o.uid;
    updates[`quiz_builder/${code}/deck`] = o.presId;
    stamped++;
  }
  console.log(`sessions: ${Object.keys(qb).length} · already owned: ${already} · to stamp: ${stamped} · no matching deck: ${orphan}` +
    (clash.length ? ` · same code in two accounts (left alone): ${clash.length}` : ''));
  if (!WRITE) { console.log('Dry run — nothing written. Re-run with --write.'); process.exit(0); }
  const keys = Object.keys(updates);
  for (let i = 0; i < keys.length; i += 500) {          // modest batches
    const chunk = {}; keys.slice(i, i + 500).forEach(k => { chunk[k] = updates[k]; });
    await db.ref().update(chunk);
  }
  console.log(`✓ stamped ${stamped} sessions. Now publish database-rules.json in the Firebase console.`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
