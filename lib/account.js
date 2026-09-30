/* PollSlide — account changes: email address and moving everything to another account.
 * ---------------------------------------------------------------------------
 * Used by api/account.js (Account settings in the presenter, and Admin → Accounts).
 * Kept apart from the handler so it can be tested against an in-memory database
 * (scripts/tests/account.test.js) — every rule below is one a customer's data depends on.
 *
 * EMAIL CHANGE — WHAT HOLDS A COPY OF THE ADDRESS
 * Firebase Auth is the source of truth; the rest are copies written at the time:
 *   users/$uid/email, admin/users_index/$uid/email   refreshed on every sign-in anyway
 *   workspaces/$ws/members/$uid/email                 what Team admin shows
 *   Stripe customer email                             where receipts go
 *   team_invites/<emailKey>, workspaces/$ws/invites   an invite WAITING for the old address
 *   shares/* with toEmailKey                          a deck WAITING for the old address
 * History (tickets, the compliance register, deleted-account logs) is deliberately NOT
 * rewritten: it records what was true then. The change itself is appended to
 * admin/account_audit so the trail stays whole.
 *
 * MOVING AN ACCOUNT'S CONTENT (support tool, admin only)
 * Decks are MOVED, never copied: a deck keeps its id and its session code, so every QR
 * code, link, result, report and class sign-in keeps working. Nothing in quiz_builder or
 * sessions is keyed by the account — except quiz_builder/$code/ownerUid, which tells the
 * class sign-in whose roster to check, and is re-pointed here.
 * NOT moved, and reported instead (each needs a decision a script shouldn't make):
 *   decks shared with collaborators ("Build it together") — the grants name the owner
 *   LoopSlide games — they occupy the owner's TV/loop slots
 *   plan, billing, AI credits, team membership — billing, handled separately
 * A full copy of what moves is written to admin/account_transfers/$id BEFORE anything
 * changes, so any transfer can be put back.
 * --------------------------------------------------------------------------- */
'use strict';

const emailKey = e => String(e || '').toLowerCase().trim().replace(/[.#$/\[\]@]/g, '_');
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

/* What a transfer moves: the user's own content. Everything else under users/$uid is
   account state (plan, credits, policy acceptance, inbox…) and stays with the account. */
const CONTENT = ['presentations', 'trash', 'archives', 'classes', 'images', 'presentDecks', 'study', 'folders'];

const val = async (db, p) => { const s = await db.ref(p).get(); return s.exists() ? s.val() : null; };

/* ── Email ────────────────────────────────────────────────────────────────── */

/* Bring every copy of this account's address in line with `newEmail`.
 * `oldEmails` — addresses the account may have had (the one we recorded at the request,
 * and whatever the uid-keyed copies still say). Idempotent: running it twice is harmless.
 * `stripeUpdate(customerId, email)` is injected so tests never touch Stripe; it may throw,
 * and a failure there is reported, never fatal (the sign-in change already happened). */
async function syncEmail(db, { uid, newEmail, oldEmails = [], stripeUpdate }) {
  const to = String(newEmail || '').toLowerCase().trim();
  if (!uid || !isEmail(to)) throw new Error('syncEmail: uid and a valid new email are required');
  const done = [], problems = [];
  const user = (await val(db, 'users/' + uid)) || {};

  // Every address this account has been known by, from the uid-keyed copies.
  const olds = new Set(oldEmails.map(e => String(e || '').toLowerCase().trim()).filter(Boolean));
  if (user.email) olds.add(String(user.email).toLowerCase());
  if (user.pendingEmailFrom) olds.add(String(user.pendingEmailFrom).toLowerCase());
  const wsId = user.workspaceId || null;
  const ws = wsId ? await val(db, 'workspaces/' + wsId) : null;
  const member = ws && ws.members && ws.members[uid];
  if (member && member.email) olds.add(String(member.email).toLowerCase());
  olds.delete(to);

  const upd = {};
  upd['users/' + uid + '/email'] = to;
  upd['users/' + uid + '/pendingEmail'] = null;
  upd['users/' + uid + '/pendingEmailFrom'] = null;
  upd['admin/users_index/' + uid + '/email'] = to;
  if (member) { upd['workspaces/' + wsId + '/members/' + uid + '/email'] = to; done.push('team membership'); }

  // Invites and shares waiting for an old address now wait for the new one.
  const newKey = emailKey(to);
  for (const old of olds) {
    const k = emailKey(old);
    const inv = await val(db, 'team_invites/' + k);
    if (inv && !(await val(db, 'team_invites/' + newKey))) {
      upd['team_invites/' + k] = null;
      upd['team_invites/' + newKey] = inv;
      if (inv.wsId) {
        const wi = await val(db, 'workspaces/' + inv.wsId + '/invites/' + k);
        if (wi) {
          upd['workspaces/' + inv.wsId + '/invites/' + k] = null;
          upd['workspaces/' + inv.wsId + '/invites/' + newKey] = Object.assign({}, wi, { email: to });
        }
      }
      done.push('a waiting team invite');
    }
    const sh = await db.ref('shares').orderByChild('toEmailKey').equalTo(k).get();
    if (sh.exists()) sh.forEach(c => {
      const v = c.val();
      if (v && !v.acceptedBy && v.status !== 'accepted') {
        upd['shares/' + c.key + '/toEmail'] = to;
        upd['shares/' + c.key + '/toEmailKey'] = newKey;
        done.push('a waiting shared deck');
      }
    });
  }
  await db.ref('/').update(upd);
  done.unshift('account record');

  const cust = user.stripeCustomerId;
  if (cust && stripeUpdate) {
    try { await stripeUpdate(cust, to); done.push('billing email'); }
    catch (e) { problems.push('billing email not updated: ' + (e && e.message || e)); }
  }
  return { email: to, previous: [...olds], done, problems };
}

/* ── Moving content between accounts ─────────────────────────────────────── */

async function sharedDeckIds(db, uid) {
  const g = (await val(db, 'deckGrants/' + uid)) || {};
  return new Set(Object.keys(g).filter(pid => g[pid] && Object.keys(g[pid]).length));
}

/* What WOULD happen. Reads only. */
async function transferPlan(db, fromUid, toUid) {
  if (!fromUid || !toUid) throw new Error('Both accounts are required');
  if (fromUid === toUid) throw new Error('That is the same account');
  const from = await val(db, 'users/' + fromUid), to = await val(db, 'users/' + toUid);
  if (!from) throw new Error('The account to move FROM has no data');
  if (!to) throw new Error('The account to move TO has never signed in — ask them to sign in once first');

  const shared = await sharedDeckIds(db, fromUid);
  const decks = Object.entries(from.presentations || {}).map(([id, p]) => ({
    id, name: (p && p.name) || 'Untitled', code: (p && p.sessionCode) || null,
    questions: Array.isArray(p && p.questions) ? p.questions.length : Object.keys((p && p.questions) || {}).length,
    shared: shared.has(id), clash: !!(to.presentations && to.presentations[id]),
  }));
  const moving = decks.filter(d => !d.shared && !d.clash);
  const counts = {};
  for (const k of CONTENT) {
    const v = from[k];
    counts[k] = k === 'presentations' ? moving.length
      : k === 'folders' ? (Array.isArray(v) ? v.length : 0)
      : (v && typeof v === 'object') ? Object.keys(v).length : 0;
  }
  const loops = [];
  const slots = (await val(db, 'loop_slots/' + fromUid)) || {};
  Object.values(slots).forEach(c => { if (c) loops.push(String(c)); });

  const warnings = [];
  if (decks.some(d => d.shared)) warnings.push(`${decks.filter(d => d.shared).length} deck(s) are shared with collaborators and stay where they are. Stop sharing them first, then move again, and share them from the new account.`);
  if (decks.some(d => d.clash)) warnings.push(`${decks.filter(d => d.clash).length} deck(s) already exist in the destination and are skipped.`);
  if (loops.length) warnings.push(`${loops.length} LoopSlide game(s) stay with the old account (they use its TV slots).`);
  if (from.tier && from.tier !== 'free') warnings.push(`The old account is on the "${from.tier}" plan. Plans and billing do not move — handle them in Stripe / Admin separately.`);
  if (from.workspaceId) warnings.push('The old account is in a team. Team membership does not move — invite the new address from Team admin.');
  return {
    from: { uid: fromUid, email: from.email || '' }, to: { uid: toUid, email: to.email || '', tier: to.tier || 'free' },
    decks, moving: moving.map(d => d.id), counts, loops, warnings,
  };
}

/* Do it. Backup first, then copy, then verify the copy, and only then remove from the old
 * account. If anything fails before the removal, the old account is untouched. */
async function transferRun(db, fromUid, toUid, { now = Date.now(), actor = '' } = {}) {
  const plan = await transferPlan(db, fromUid, toUid);
  const from = await val(db, 'users/' + fromUid);
  const to = (await val(db, 'users/' + toUid)) || {};
  const id = 't' + now + '_' + fromUid.slice(0, 6);

  // What moves, section by section.
  const move = {};
  for (const k of CONTENT) {
    const v = from[k];
    if (v == null) continue;
    if (k === 'presentations') {
      const keep = {};
      plan.moving.forEach(pid => { keep[pid] = v[pid]; });
      if (Object.keys(keep).length) move[k] = keep;
    } else if (k === 'folders') {
      if (Array.isArray(v) && v.length) move[k] = v;
    } else if (typeof v === 'object') {
      const keep = {};
      Object.keys(v).forEach(key => { if (!(to[k] && to[k][key] !== undefined)) keep[key] = v[key]; });
      if (Object.keys(keep).length) move[k] = keep;
    }
  }

  // 1. Backup — the exact data about to move, and the class links about to change.
  const classLinks = {};
  for (const pid of plan.moving) {
    const code = from.presentations[pid] && from.presentations[pid].sessionCode;
    if (!code) continue;
    const owner = await val(db, 'quiz_builder/' + code + '/ownerUid');
    if (owner === fromUid) classLinks[code] = owner;
  }
  await db.ref('admin/account_transfers/' + id).set({
    at: now, actor, fromUid, toUid, fromEmail: plan.from.email, toEmail: plan.to.email,
    backup: move, classLinks, status: 'started',
  });

  // 2. Copy into the new account (merge — never overwrite what is already there).
  const add = {};
  for (const k of Object.keys(move)) {
    if (k === 'folders') {
      const merged = [...new Set([...(Array.isArray(to.folders) ? to.folders : []), ...move.folders])];
      add['users/' + toUid + '/folders'] = merged;
    } else {
      Object.keys(move[k]).forEach(key => { add['users/' + toUid + '/' + k + '/' + key] = move[k][key]; });
    }
  }
  Object.keys(classLinks).forEach(code => { add['quiz_builder/' + code + '/ownerUid'] = toUid; });
  if (Object.keys(add).length) await db.ref('/').update(add);

  // 3. Verify every moved deck is readable in the new account before removing anything.
  for (const pid of plan.moving) {
    const got = await val(db, 'users/' + toUid + '/presentations/' + pid);
    if (!got) {
      await db.ref('admin/account_transfers/' + id + '/status').set('failed-verify');
      throw new Error('Copy could not be verified — nothing was removed from the old account. Transfer id ' + id);
    }
  }

  // 4. Remove from the old account. A class that a deck STAYING behind still uses (a shared
  //    deck, or one that clashed) is copied rather than moved — removing it would break
  //    that deck's class sign-in.
  const staying = Object.keys(from.presentations || {}).filter(pid => !plan.moving.includes(pid));
  const keepClasses = new Set(staying.map(pid => from.presentations[pid] && from.presentations[pid].classId).filter(Boolean));
  const rem = {};
  for (const k of Object.keys(move)) {
    if (k === 'folders') rem['users/' + fromUid + '/folders'] = null;
    else Object.keys(move[k]).forEach(key => {
      if (k === 'classes' && keepClasses.has(key)) return;
      rem['users/' + fromUid + '/' + k + '/' + key] = null;
    });
  }
  if (Object.keys(rem).length) await db.ref('/').update(rem);
  await db.ref('admin/account_transfers/' + id + '/status').set('done');

  const moved = {};
  Object.keys(move).forEach(k => { moved[k] = k === 'folders' ? move[k].length : Object.keys(move[k]).length; });
  return { id, moved, classLinks: Object.keys(classLinks).length, warnings: plan.warnings };
}

/* Put a transfer back, from its backup. Only while the new account still holds the
 * moved items unchanged in place — it moves them back and restores the class links. */
async function transferUndo(db, id) {
  const t = await val(db, 'admin/account_transfers/' + id);
  if (!t) throw new Error('No such transfer');
  if (t.status === 'undone') throw new Error('Already undone');
  const upd = {};
  for (const k of Object.keys(t.backup || {})) {
    if (k === 'folders') {
      upd['users/' + t.fromUid + '/folders'] = t.backup.folders;
      continue;
    }
    Object.keys(t.backup[k]).forEach(key => {
      upd['users/' + t.fromUid + '/' + k + '/' + key] = t.backup[k][key];
      upd['users/' + t.toUid + '/' + k + '/' + key] = null;
    });
  }
  Object.keys(t.classLinks || {}).forEach(code => { upd['quiz_builder/' + code + '/ownerUid'] = t.fromUid; });
  await db.ref('/').update(upd);
  await db.ref('admin/account_transfers/' + id + '/status').set('undone');
  return { id, restored: true };
}

module.exports = { emailKey, isEmail, CONTENT, syncEmail, transferPlan, transferRun, transferUndo };
