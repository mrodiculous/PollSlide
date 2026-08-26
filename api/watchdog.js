/* PollSlide — Auto-pilot runner (cron).
 * ---------------------------------------------------------------------------
 * Runs every 15 minutes. For each check: look, decide, fix if there's a known-safe
 * remedy, confirm the fix actually worked, then email Rod only on a state change.
 * See lib/watchdog.js for the design notes and the pure decision functions.
 *
 * Auth: Vercel cron sends `Authorization: Bearer $CRON_SECRET`. An admin can also
 * trigger a run from Admin → Auto-pilot with their Firebase id token.
 *
 * Env: CRON_SECRET, INTERNAL_API_KEY, FIREBASE_*, NEXT_PUBLIC_APP_URL,
 *      OPS_ALERT_EMAIL (defaults to help@pollslide.com), STRIPE_SECRET_KEY,
 *      BACKUP_MAX_AGE_HOURS, LOCAL_LLM_URL, OPENAI_API_KEY.
 * --------------------------------------------------------------------------- */
const admin = require('firebase-admin');
const {
  evalBackupAge, evalErrorSpike, evalTierDrift, evalProbe, evalAiReachable,
  decideNotification, isStoredBackup,
  evalShareHygiene, evalQidBackfill, evalOrphanGrants,
} = require('../lib/watchdog');
const { setUserTier } = require('../lib/tier');
const { tierForSubscription } = require('../lib/stripe-tier');
const { verifyToken, tokenFrom, ADMIN_EMAILS } = require('../lib/quota');

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';
const ALERT_TO = process.env.OPS_ALERT_EMAIL || 'help@pollslide.com';

function getDb() {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PROJECT_ID) return null;
  const app = admin.apps.length ? admin.apps[0] : admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  return admin.database(app);
}

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

async function sendAlert(subject, heading, body) {
  try {
    await fetchWithTimeout(APP_URL + '/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify({ type: 'notify', to: ALERT_TO, data: { subject, heading, body } }),
    }, 10000);
    return true;
  } catch (e) { return false; }
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ── The checks ─────────────────────────────────────────────────────────────── */
const CHECKS = [
  {
    id: 'backup_stale',
    title: 'Backups have stopped running',
    severity: 'high',
    autoFix: true,
    async gather(ctx) {
      const snap = await ctx.db.ref('admin/backups/log').orderByKey().limitToLast(40).get();
      let lastOkAt = 0;
      // The log field is `at` — NOT `t`. Reading the wrong name silently yields 0,
      // which reads as "no backup has ever succeeded" no matter how healthy things are.
      snap.forEach(s => { const v = s.val(); if (isStoredBackup(v)) lastOkAt = Math.max(lastOkAt, v.at); });
      return {
        lastOkAt, now: Date.now(),
        maxAgeHours: Number(process.env.BACKUP_MAX_AGE_HOURS || 48),
        // Same deployment as api/backup.js, so this is the value that endpoint will see.
        bucketConfigured: !!process.env.BACKUP_BUCKET,
      };
    },
    evaluate: evalBackupAge,
    // Don't run the remedy when the problem is missing configuration. With no bucket,
    // /api/backup exports the WHOLE database and streams it back to be discarded —
    // doing that every 15 minutes would be expensive and would fix nothing.
    canFix: (res) => !res.configIssue,
    // Remedy: just run the backup. It's idempotent — worst case we store one extra.
    async fix(ctx) {
      const r = await fetchWithTimeout(APP_URL + '/api/backup', {
        method: 'POST', headers: { Authorization: 'Bearer ' + (process.env.CRON_SECRET || '') },
      }, 60000);
      return { note: 'Triggered a backup run (HTTP ' + r.status + ').' };
    },
    hint: 'If BACKUP_BUCKET is unset, set it in Vercel to your Firebase Storage bucket and redeploy — until then nothing is being stored off-site.',
  },

  {
    id: 'client_error_spike',
    title: 'A page is throwing errors for real users',
    severity: 'high',
    autoFix: false,   // a JS bug needs a human; auto-"fixing" code is not a thing
    async gather(ctx) {
      const day = new Date().toISOString().slice(0, 10);
      const snap = await ctx.db.ref('admin/client_errors/' + day).get();
      let total = 0, distinct = 0, worst = null;
      snap.forEach(s => {
        const v = s.val() || {}; const c = v.count || 1;
        total += c; distinct++;
        if (!worst || c > worst.count) worst = { count: c, message: v.message || '', page: v.page || '?' };
      });
      return { total, distinct, worst };
    },
    evaluate: evalErrorSpike,
    hint: 'Open Admin → Errors in the wild for the stack trace and the page it happens on.',
  },

  {
    id: 'tier_drift',
    title: 'A plan disagrees with Stripe',
    severity: 'high',
    autoFix: true,
    async gather(ctx) {
      if (!process.env.STRIPE_SECRET_KEY) return { rows: [], skipped: 'no STRIPE_SECRET_KEY' };
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const [idxS, wsS, compS] = await Promise.all([
        ctx.db.ref('admin/users_index').get(),
        ctx.db.ref('workspaces').get(),
        ctx.db.ref('admin/comps').get(),
      ]);
      const idx = idxS.val() || {};

      // Accounts whose tier legitimately does NOT come from their own Stripe
      // subscription. Comparing these to Stripe produces false drift, and "fixing" it
      // would strip access from a paying team's member or end a comp early.
      const exempt = new Set(Object.keys(compS.val() || {}));
      for (const ws of Object.values(wsS.val() || {})) {
        for (const mUid of Object.keys((ws && ws.members) || {})) {
          if (mUid !== (ws && ws.ownerUid)) exempt.add(mUid);   // owner still bills normally
        }
      }

      const rows = [];
      // Only accounts Stripe knows about can drift; free users have nothing to compare.
      const linked = Object.entries(idx)
        .filter(([uid, u]) => u && u.stripeCustomerId && !exempt.has(uid))
        .slice(0, 60);
      for (const [uid, u] of linked) {
        try {
          const subs = await stripe.subscriptions.list({ customer: u.stripeCustomerId, status: 'all', limit: 5 });
          const live = subs.data.find(s => ['active', 'trialing', 'past_due'].includes(s.status));
          // strict: if we cannot say with confidence what they pay for, say nothing.
          // A guess here would auto-change a real customer's plan.
          const expected = live ? await tierForSubscription(stripe, live, { strict: true }) : 'free';
          rows.push({ uid, email: u.email, actual: u.tier || 'free', expected, sub: live ? live.id : null });
        } catch (e) { /* one unreadable customer must not fail the whole sweep */ }
      }
      return { rows };
    },
    evaluate: evalTierDrift,
    // Remedy: RESTORE ONLY. We give back access someone has paid for and isn't
    // getting. We never take access away automatically — see evalTierDrift for why
    // (team members and comps legitimately sit above their own Stripe subscription).
    // setUserTier writes an audited tier_log entry, so "why did my plan change?"
    // stays answerable afterwards.
    async fix(ctx, data, res) {
      const notes = [];
      for (const r of (res.restore || [])) {
        const out = await setUserTier(ctx.db, r.uid, r.expected, {
          source: 'watchdog', reason: 'restored access paid for in Stripe', actor: 'auto-pilot', ref: r.sub || null,
        });
        if (out.changed) notes.push(`${r.email || r.uid}: ${out.from} → ${out.to}`);
      }
      if ((res.review || []).length) {
        notes.push(`${res.review.length} over-granted account(s) left alone for you to review — auto-pilot never downgrades anyone.`);
      }
      return { note: notes.length ? notes.join('; ') : 'Nothing needed changing.' };
    },
    hint: 'Under-granted accounts are restored automatically. Over-granted ones are listed for you — check Admin → Users → 🕵️ Account timeline before changing anything, since team members and comped accounts are meant to sit above their own Stripe record.',
  },

  {
    id: 'share_hygiene',
    title: 'Old share records are piling up',
    severity: 'warn',
    autoFix: true,
    async gather(ctx) {
      const maxAgeDays = Number(process.env.SHARE_TTL_DAYS || 30);
      const cutoff = Date.now() - maxAgeDays * 86400000;
      const snap = await ctx.db.ref('shares').get();
      let total = 0, stalePending = 0, settledWithPayload = 0;
      const stale = [], settled = [];
      snap.forEach(c => {
        const v = c.val() || {}; total++;
        if (v.status === 'pending' && (v.at || 0) < cutoff) { stalePending++; stale.push(c.key); }
        else if (v.status !== 'pending' && v.payload) { settledWithPayload++; settled.push(c.key); }
      });
      return { total, stalePending, settledWithPayload, maxAgeDays, _stale: stale, _settled: settled };
    },
    evaluate: evalShareHygiene,
    /* Two safe, non-destructive-to-users remedies:
     *   • drop the deck snapshot from a share that has already been accepted or
     *     declined — it has done its job and the copy already exists
     *   • expire a pending share nobody claimed, so a mistyped address doesn't keep
     *     someone's quiz forever
     * Neither touches a deck anyone actually owns. */
    async fix(ctx, data) {
      const updates = {};
      (data._settled || []).forEach(k => { updates[`shares/${k}/payload`] = null; });
      (data._stale || []).forEach(k => { updates[`shares/${k}`] = null; });
      if (Object.keys(updates).length) await ctx.db.ref().update(updates);
      return { note: `Dropped ${(data._settled || []).length} spent snapshot(s) and expired ${(data._stale || []).length} unclaimed share(s).` };
    },
    hint: 'Nothing to do — this tidies itself. Raise SHARE_TTL_DAYS if 30 days is too short for your users to claim a share.',
  },

  {
    id: 'qid_backfill',
    title: 'Some decks still key answers by question position',
    severity: 'high',
    autoFix: true,
    async gather(ctx) {
      // Sampled, not exhaustive: this runs every 15 minutes and only needs to know
      // whether any remain. The remedy fixes whatever it finds, so repeated runs
      // converge on zero.
      const snap = await ctx.db.ref('users').limitToFirst(200).get();
      let decksChecked = 0, decksNeedingIds = 0;
      const need = [];
      snap.forEach(u => {
        const uid = u.key, decks = (u.val() || {}).presentations || {};
        Object.entries(decks).forEach(([pid, d]) => {
          if (!d) return;
          const qs = Array.isArray(d.questions) ? d.questions : (d.questions ? Object.values(d.questions) : []);
          if (!qs.length) return;
          decksChecked++;
          if (qs.some(q => q && typeof q === 'object' && !q.id)) { decksNeedingIds++; need.push({ uid, pid }); }
        });
      });
      return { decksChecked, decksNeedingIds, _need: need.slice(0, 50) };
    },
    evaluate: evalQidBackfill,
    /* The same backfill the browser does on open, applied server-side so a deck
     * nobody has opened is protected too. The id assigned is `q<index>_stable`, which
     * makes the derived response bucket byte-identical to the existing key — so this
     * moves no data and cannot orphan an answer. See qid.js. */
    async fix(ctx, data) {
      let fixed = 0;
      for (const { uid, pid } of (data._need || [])) {
        try {
          const ref = ctx.db.ref(`users/${uid}/presentations/${pid}/questions`);
          const snap = await ref.get();
          if (!snap.exists()) continue;
          const v = snap.val();
          const qs = Array.isArray(v) ? v : Object.values(v);
          let changed = false;
          qs.forEach((q, i) => { if (q && typeof q === 'object' && !q.id) { q.id = 'q' + i + '_stable'; changed = true; } });
          if (changed) { await ref.set(qs); fixed++; }
        } catch (e) { /* one unreadable deck must not stop the sweep */ }
      }
      return { note: `Backfilled stable question ids on ${fixed} deck(s).` };
    },
  },

  {
    id: 'orphan_grants',
    title: 'Collaboration grants point at deleted decks',
    severity: 'warn',
    autoFix: true,
    async gather(ctx) {
      const snap = await ctx.db.ref('deckGrants').get();
      let grantsChecked = 0, orphans = 0;
      const dead = [];
      const owners = [];
      snap.forEach(o => { owners.push([o.key, o.val() || {}]); });
      for (const [ownerUid, decks] of owners) {
        for (const presId of Object.keys(decks)) {
          grantsChecked++;
          try {
            const d = await ctx.db.ref(`users/${ownerUid}/presentations/${presId}`).get();
            if (!d.exists()) { orphans++; dead.push({ ownerUid, presId, collabs: Object.keys(decks[presId] || {}) }); }
          } catch (e) { /* skip */ }
        }
      }
      return { grantsChecked, orphans, _dead: dead };
    },
    evaluate: evalOrphanGrants,
    async fix(ctx, data) {
      const updates = {};
      (data._dead || []).forEach(({ ownerUid, presId, collabs }) => {
        updates[`deckGrants/${ownerUid}/${presId}`] = null;
        (collabs || []).forEach(cu => { updates[`collabIndex/${cu}/${ownerUid}_${presId}`] = null; });
      });
      if (Object.keys(updates).length) await ctx.db.ref().update(updates);
      return { note: `Cleared ${(data._dead || []).length} grant(s) for decks that no longer exist.` };
    },
  },

  {
    id: 'endpoints_down',
    title: 'A core endpoint is not responding',
    severity: 'high',
    autoFix: false,
    async gather() {
      const targets = [
        { name: '/api/status', url: APP_URL + '/api/status' },
        { name: 'answer page', url: APP_URL + '/answer.html' },
        { name: 'presenter page', url: APP_URL + '/presenter.html' },
      ];
      const results = [];
      for (const t of targets) {
        try {
          const r = await fetchWithTimeout(t.url, { method: 'GET' }, 8000);
          results.push({ name: t.name, status: r.status, ok: r.status < 500 });
        } catch (e) { results.push({ name: t.name, status: 'no response', ok: false }); }
      }
      return { results };
    },
    evaluate: evalProbe,
    hint: 'Check the Vercel dashboard for a failed deploy — a bad build serves the last good one, but a runtime error shows up here.',
  },

  {
    id: 'ai_unavailable',
    title: 'Polly has no working model',
    severity: 'high',
    autoFix: false,
    async gather() {
      let localOk = false;
      const base = process.env.LOCAL_LLM_URL;
      if (base) {
        try {
          const r = await fetchWithTimeout(base.replace(/\/v1\/?.*$/, '') + '/api/tags', {
            headers: process.env.CF_ACCESS_CLIENT_ID ? {
              'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
              'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET || '',
            } : {},
          }, 6000);
          localOk = r.ok;
        } catch (e) { localOk = false; }
      }
      return { localOk, cloudConfigured: !!process.env.OPENAI_API_KEY };
    },
    evaluate: evalAiReachable,
    hint: 'Either bring the Mac back online, or set OPENAI_API_KEY in Vercel so the cloud fallback covers it.',
  },
];

/* ── Events: things that page you once and have no open/closed lifecycle ────── */
async function notifyNewTickets(db, sinceMs) {
  const snap = await db.ref('admin/tickets').orderByChild('createdAt').startAt(sinceMs + 1).get();
  const fresh = [];
  snap.forEach(s => { const v = s.val() || {}; fresh.push({ id: s.key, ...v }); });
  if (!fresh.length) return 0;
  const list = fresh.map(t =>
    `<li><b>${esc(t.subject || t.type || 'Support request')}</b> — ${esc(t.email || 'unknown sender')}<br>
     <span style="color:#666;">${esc(String(t.message || '').slice(0, 220))}</span></li>`).join('');
  await sendAlert(
    `🎫 ${fresh.length} new support ticket${fresh.length > 1 ? 's' : ''}`,
    'New support request',
    `<ul>${list}</ul><p>Reply from <a href="${APP_URL}/admin.html">Admin → Support tickets</a>.</p>`
  );
  return fresh.length;
}

/* ── Runner ─────────────────────────────────────────────────────────────────── */
async function runAll(db, trigger) {
  const now = Date.now();
  const out = [];
  const state = (await db.ref('admin/watchdog/state').get()).val() || {};

  for (const c of CHECKS) {
    const row = { id: c.id, title: c.title, severity: c.severity };
    try {
      const prev = (await db.ref('admin/watchdog/incidents/' + c.id).get()).val() || null;

      let data = await c.gather({ db });
      let res = c.evaluate({ ...data, now });
      let selfHealed = false, fixNote = null;

      if (!res.ok && c.autoFix && c.fix && (!c.canFix || c.canFix(res))) {
        try {
          const f = await c.fix({ db }, data, res);
          fixNote = f && f.note;
          // Confirm. Running the remedy is not evidence it worked.
          data = await c.gather({ db });
          const after = c.evaluate({ ...data, now: Date.now() });
          if (after.ok) { selfHealed = true; res = after; }
        } catch (e) { fixNote = 'Remedy failed: ' + e.message; }
      }

      const decision = decideNotification(prev, res, selfHealed, now);
      const status = decision ? decision.status : (res.ok ? 'resolved' : 'open');

      const inc = {
        id: c.id, title: c.title, severity: c.severity, status,
        detail: res.detail || '', firstAt: (prev && prev.status === 'open' && prev.firstAt) || now,
        lastAt: now, occurrences: ((prev && prev.occurrences) || 0) + (res.ok ? 0 : 1),
        lastFixAt: fixNote ? now : (prev && prev.lastFixAt) || null,
        lastFixNote: fixNote || (prev && prev.lastFixNote) || null,
        autoFixed: selfHealed || false,
        notified: Object.assign({}, prev && prev.notified),
      };
      if (status === 'resolved') inc.resolvedAt = now;

      if (decision && decision.kind) {
        const k = decision.kind;
        const subj = {
          self_healed: `🔧 Fixed automatically — ${c.title}`,
          opened:      `🔴 Needs you — ${c.title}`,
          escalated:   `🔴 Still broken after 24h — ${c.title}`,
          resolved:    `✅ Resolved — ${c.title}`,
        }[k];
        const body =
          `<p><b>${esc(res.detail || '')}</b></p>` +
          (fixNote ? `<p>Auto-pilot ran a remedy: ${esc(fixNote)}</p>` : '') +
          (k === 'self_healed' ? '<p>Re-checked afterwards and it is healthy again. No action needed — this is a record, not a to-do.</p>' : '') +
          (k === 'resolved' ? '<p>This had been open; the latest check passed.</p>' : '') +
          (c.hint && (k === 'opened' || k === 'escalated') ? `<p><b>What to do:</b> ${esc(c.hint)}</p>` : '') +
          `<p style="color:#666;font-size:13px;">Auto-pilot check <code>${c.id}</code> · <a href="${APP_URL}/admin.html">Admin → Auto-pilot</a></p>`;
        const sent = await sendAlert(subj, c.title, body);
        if (sent) inc.notified[k] = now;
        row.notified = k;
      }

      await db.ref('admin/watchdog/incidents/' + c.id).set(inc);
      // Append-only history so "has this been flapping?" is answerable.
      if (!res.ok || selfHealed || (prev && prev.status === 'open')) {
        await db.ref('admin/watchdog/history').push({
          at: now, id: c.id, ok: res.ok, selfHealed, detail: res.detail || '', fix: fixNote || null, trigger,
        });
      }
      Object.assign(row, { ok: res.ok, detail: res.detail, selfHealed, fix: fixNote, status });
    } catch (e) {
      Object.assign(row, { ok: null, detail: 'Check crashed: ' + e.message });
    }
    out.push(row);
  }

  let newTickets = 0;
  try { newTickets = await notifyNewTickets(db, state.lastRunAt || (now - 3600000)); } catch (e) {}

  await db.ref('admin/watchdog/state').set({
    lastRunAt: now, trigger,
    open: out.filter(r => r.status === 'open').map(r => r.id),
    healed: out.filter(r => r.selfHealed).map(r => r.id),
  });
  // Trim history — this runs 96×/day forever and nobody reads month-old rows.
  try {
    const hist = await db.ref('admin/watchdog/history').orderByKey().get();
    const keys = []; hist.forEach(s => keys.push(s.key));
    if (keys.length > 300) {
      const drop = {};
      keys.slice(0, keys.length - 300).forEach(k => { drop[k] = null; });
      await db.ref('admin/watchdog/history').update(drop);
    }
  } catch (e) { /* trimming is housekeeping, never fatal */ }

  return { ranAt: now, trigger, newTickets, checks: out };
}

module.exports = async (req, res) => {
  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase Admin not configured' });

  // Vercel cron, or an admin pressing "Run now".
  let trigger = null;
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization === 'Bearer ' + secret) trigger = 'cron';
  else {
    try {
      const decoded = await verifyToken(tokenFrom(req));
      if (decoded && ADMIN_EMAILS.includes((decoded.email || '').toLowerCase())) trigger = 'admin:' + decoded.email;
    } catch (e) { /* falls through to 401 */ }
  }
  if (!trigger) return res.status(401).json({ error: 'Unauthorized' });

  // Config self-check. A missing env var makes a feature degrade to a SILENT no-op —
  // which is the worst failure mode, because everything looks like it's working.
  // Reports presence only; a value is never returned, logged or echoed.
  if ((req.query && req.query.action === 'config') || (req.body && req.body.action === 'config')) {
    const has = (k) => !!process.env[k];
    return res.status(200).json({
      env: [
        { key: 'CRON_SECRET',        set: has('CRON_SECRET'),        needed: 'Vercel cron auth. Missing → every scheduled job (backups, comp sweep, Auto-pilot) is rejected 401 and silently never runs.' },
        { key: 'INTERNAL_API_KEY',   set: has('INTERNAL_API_KEY'),   needed: 'Server-to-server email auth. Missing → /api/send-email refuses internal calls, so NO alert email is ever delivered.' },
        { key: 'OPS_ALERT_EMAIL',    set: has('OPS_ALERT_EMAIL'),    needed: 'Where Auto-pilot alerts go. Optional — falls back to help@pollslide.com.', optional: true },
        { key: 'RESEND_API_KEY',     set: has('RESEND_API_KEY'),     needed: 'The actual email sender. Missing → nothing can be emailed at all.' },
        { key: 'FIREBASE_PROJECT_ID',   set: has('FIREBASE_PROJECT_ID'),   needed: 'Admin SDK. Missing → client error reports and Auto-pilot state are silently discarded.' },
        { key: 'FIREBASE_CLIENT_EMAIL', set: has('FIREBASE_CLIENT_EMAIL'), needed: 'Admin SDK credential.' },
        { key: 'FIREBASE_PRIVATE_KEY',  set: has('FIREBASE_PRIVATE_KEY'),  needed: 'Admin SDK credential.' },
        { key: 'FIREBASE_DATABASE_URL', set: has('FIREBASE_DATABASE_URL'), needed: 'Which database to write to.' },
        { key: 'BACKUP_BUCKET',      set: has('BACKUP_BUCKET'),      needed: 'Where nightly backups are stored. Missing → the cron still runs and builds the export, then throws it away. You have NO off-site copy. Set it to your Firebase Storage bucket.' },
        { key: 'BACKUP_MAX_AGE_HOURS', set: has('BACKUP_MAX_AGE_HOURS'), needed: 'How stale a backup may get before alerting. Optional — defaults to 48h.', optional: true },
        { key: 'STRIPE_SECRET_KEY',  set: has('STRIPE_SECRET_KEY'),  needed: 'Missing → the plan-vs-Stripe drift check is skipped entirely.' },
        { key: 'OPENAI_API_KEY',     set: has('OPENAI_API_KEY'),     needed: 'Polly\'s cloud fallback. Missing → Polly fails whenever the Mac is offline.' },
        { key: 'LOCAL_LLM_URL',      set: has('LOCAL_LLM_URL'),      needed: 'The local model on the Mac. Optional if the cloud key is set.', optional: true },
        { key: 'NEXT_PUBLIC_APP_URL',set: has('NEXT_PUBLIC_APP_URL'),needed: 'Optional — defaults to https://app.pollslide.com.', optional: true },
      ],
      checkedAt: Date.now(),
    });
  }

  try {
    const result = await runAll(db, trigger);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports.runAll = runAll;
module.exports.CHECKS = CHECKS;
