# PollSlide — Backup & Disaster Recovery Runbook

**Purpose:** how PollSlide's data is backed up, how to restore it, and exactly what to do
in each failure scenario. Data lives in **Firebase Realtime Database** (`echonest-live-survey`).
Code is on GitHub + Vercel. Payments are in Stripe. Auth is Firebase Auth.

> **Golden rule:** before ANY restore or destructive fix, take a fresh backup first
> (`node scripts/backup.js`) so the current state is itself recoverable. You can always
> go forward from a known-good snapshot; you cannot un-overwrite live data.

---

## 1. Backup layers (defense in depth)

| Layer | What | Where it lives | Frequency | Set up by |
| --- | --- | --- | --- | --- |
| **① Firebase automated backups** (PRIMARY) | Full RTDB export | Google Cloud Storage (off-database) | Daily | You (console, ~5 min) |
| **② Cloud endpoint** `api/backup.js` | Full RTDB JSON → GCS bucket | Your `BACKUP_BUCKET` | Daily (Vercel cron) | Deployed; needs 1 env var |
| **③ Local script** `scripts/backup.js` | Full RTDB JSON | Your Mac `./backups/` (+ external drive) | Daily (launchd) or on-demand | You (~5 min) |
| **④ Point-in-time undo** | Deleted presentations | `users/<uid>/trash` for 30 days | Instant | Built in (presenter.html) |
| **⑤ Code** | All app + website code | GitHub | Every push | Done |

You want **at least ① plus one of ② / ③.** Layer ④ handles the everyday "oops I deleted it."
Layers ①–③ handle everything worse.

### Set up ① — Firebase automated daily backups (do this first)
1. Firebase Console → **Realtime Database** → **Backups** tab.
   (Requires the **Blaze** pay-as-you-go plan — backups are a Blaze feature; cost for our
   data size is negligible.)
2. Enable **Automated backups**, choose **daily**, pick a GCS bucket (accept the default).
3. Confirm. Google now writes a dated export every day, retained per your setting. These are
   **off-database and versioned** — the real safety net.

### Set up ② — the cloud backup endpoint (already coded)
1. Create/confirm a GCS bucket (Firebase Storage default bucket is fine).
2. In Vercel → Project → Settings → **Environment Variables**, add:
   `BACKUP_BUCKET = <your-bucket-name>` (e.g. `echonest-live-survey.appspot.com`)
   and confirm `CRON_SECRET` is set (it already gates the other crons).
3. Redeploy. The `0 7 * * *` cron in `vercel.json` now writes `backups/pollslide-backup-<ISO>.json`
   to that bucket daily and keeps the last 30 (`BACKUP_KEEP`). Manual run / check:
   ```
   curl -H "Authorization: Bearer $CRON_SECRET" https://app.pollslide.com/api/backup
   ```
   A log of every run is at `admin/backups/log` in the DB.
   *If `BACKUP_BUCKET` is unset, the endpoint still works but only returns the JSON as a
   download (a cron can't persist that) — so set the bucket for true automation.*

### Set up ③ — local backups on your always-on Mac
1. Firebase Console → Project Settings → **Service accounts** → **Generate new private key**.
   Save as `service-account.json` in the repo root. **It is git-ignored — never commit it.**
2. Set the DB URL (Console → Realtime Database, top of page). Either export
   `FIREBASE_DATABASE_URL=...` or edit `DEFAULT_DB_URL` in `scripts/backup.js`.
3. `npm install` (installs `firebase-admin`, already a dependency).
4. Run once to confirm: `node scripts/backup.js` → writes `./backups/pollslide-backup-*.json`.
5. Schedule daily: edit + install `scripts/com.pollslide.backup.plist` (instructions inside it).
6. **Best practice:** point `--out` at an external drive or synced folder occasionally, so a
   backup exists off the one machine: `node scripts/backup.js --out ~/Dropbox/pollslide-backups`.

---

## 2. Restore procedures

Restores use `scripts/restore.js`. It **dry-runs by default** and is **path-scoped** so you
can't wipe the whole DB by accident. `--apply` overwrites the target path with the backup value.

```
# See what's in a backup (no writes)
node scripts/restore.js backups/pollslide-backup-2026-07-17.json --path users/<uid>/presentations --dry-run

# Restore one user's presentations
node scripts/restore.js <backup.json> --path users/<uid>/presentations --apply

# Restore a single presentation
node scripts/restore.js <backup.json> --path "users/<uid>/presentations/<presId>" --apply

# FULL restore (disaster only — needs all three flags)
node scripts/restore.js <backup.json> --all --apply --i-understand-this-overwrites-everything
```

Restoring from a **Firebase native backup (①)**: download the export from the GCS bucket, then
either import it in the Console (Realtime Database → ⋮ → Import JSON — for full restores) or run
it through `restore.js` for a scoped restore.

---

## 3. Scenario playbooks

### A. A user deleted their own presentation/question by mistake
1. **Question** — an **Undo** toast appears for ~10s; click it. (In-memory undo.)
2. **Presentation** — **Undo** toast (~12s), or **presenter → 🗑 Recently deleted** to restore
   anything deleted in the last **30 days**. No backup needed.
3. Older than 30 days: restore that user's subtree from a backup (scenario is rare):
   `restore.js <backup> --path users/<uid>/presentations/<presId> --apply`.

### B. A bad actor mass-deleted or corrupted data (account compromise)
1. **Contain first:** in Firebase Console → Authentication, **disable/anon-out the compromised
   account**; rotate any leaked credentials (see D). If it's DB-wide, temporarily set Realtime
   Database rules to read-only to stop further writes (`".write": false` at root, publish).
2. **Take a fresh backup** of the current (damaged) state anyway — evidence + the ability to cherry-pick.
3. Identify the last good snapshot (Firebase native backup ① or local ③) from **before** the incident.
4. **Scoped restore** of the affected subtree(s) — prefer `--path` over `--all`. Verify in the
   Console before and after.
5. Re-enable writes. Log it in `COMPLIANCE-LOG.md`; if personal data was exposed, follow the
   **72-hour breach process** in the Admin → Runbook.

### C. Whole database wiped / severe corruption
1. Set DB rules to `".write": false` at root (stop the bleeding), publish.
2. Get the newest good export (① GCS, or ③ local `backups/`).
3. **Full restore:** Console → Import JSON, or `restore.js <backup> --all --apply --i-understand-this-overwrites-everything`.
4. Spot-check `users`, `sessions`, `app_config`. Restore write rules. Announce status on `/status`.

### D. Service-account key or admin credential leaked
1. Firebase Console → Project Settings → Service accounts → **delete the compromised key**,
   generate a new one; update `service-account.json` locally and the Vercel env vars
   (`FIREBASE_PRIVATE_KEY` etc.), redeploy.
2. Rotate `CRON_SECRET`, Stripe keys, and any other secrets that shared exposure.
3. Review `admin/backups/log` and DB audit for unexpected writes; if any, treat as scenario B.

### E. Firebase / Google outage
1. Nothing to restore — it's an availability event. Post on **/status**.
2. RTDB is multi-region within Google; outages are rare and usually short. Our backups (① GCS,
   ③ local) mean that even a catastrophic provider-side data loss is recoverable to the last
   daily snapshot.

### F. Stripe / billing data
Stripe is the system of record for payments and is itself backed up/redundant by Stripe. We store
only `tier`/plan flags in the DB (restorable from backups). No card data is ever in our DB.

---

## 4. Test your recovery (do this — untested backups aren't backups)
- **Quarterly:** download the latest backup and run a **dry-run restore** of one user's subtree;
  confirm the data looks right. Once a year, do an `--apply` restore into a throwaway path
  (e.g. `restore-test/...`) and inspect.
- After any change to the data shape in `answer.html` / `presenter.html`, re-confirm a backup
  still round-trips.

---

## 5. Hardening posture (against bad actors)
- **Rules:** root reads are `false`; every path is scoped to its owner or admin
  (`database-rules.json`). Audience-writable paths (`sessions/*/responses`,`qa`,`study`) are open
  by necessity (anonymous audience) — client-side filters profanity/links + rate-limits; a
  server-side **shape/length `.validate`** hardening is staged in
  `Downloads/PollSlide/FIREBASE-RULES-audience-validation.md` (verify field shapes against the
  current `answer.html` before publishing — different question types write different fields).
- **Quota tamper-proofing:** `aiUsedThisMonth`/`aiQuotaMonth` are server-written and now
  client-immutable via `.validate` (see `database-rules.json`).
- **Secrets:** never in git (`.gitignore`); rotate on any suspicion (scenario D).
- **Deletes are soft** (30-day trash) so mistakes and malice are reversible.
- **Backups are off-database** (①/②/③) so a DB compromise cannot reach them.

_Last updated: 2026-07-17. Keep this file current when the backup setup changes._
