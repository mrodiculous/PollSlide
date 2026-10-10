/* PollSlide — Team hub: the three Team-plan features that were sold before they existed.
 * ---------------------------------------------------------------------------
 * Built 2026-10-10. The pricing page, the in-app plan picker and the upgrade email all
 * promised these; none had a line of code behind it:
 *
 *   • Shared question & deck library   (Team Small and up)
 *   • Usage analytics                   (Team Small) / Org-wide usage analytics (Team Large)
 *   • Bulk member management            (Team Large)
 *
 * Kept apart from api/team.js so it can be tested against an in-memory database
 * (scripts/tests/team-hub.test.js) and run by the stage server exactly as production does.
 *
 * RULES THAT KEEP IT SAFE
 *   1. ADDITIVE ONLY. Nothing here changes an existing team action, record or rule. The
 *      workspace node keeps its shape; a bulk invite writes exactly the records the
 *      one-at-a-time invite writes.
 *   2. NO DATABASE-RULE CHANGES. The library lives at team_library/<wsId>, which no rule
 *      opens, so every read and write goes through this file with the Admin SDK. Nothing
 *      has to be published in the Firebase console before or after the code ships.
 *   3. THE LIBRARY HOLDS COPIES. Adding a deck stores a snapshot; using one creates an
 *      independent deck with its own session code — the same rule as deck sharing
 *      (api/share.js), so nobody's results, QR codes or edits ever touch a teammate's.
 *   4. ANALYTICS SHOW COUNTS, NEVER ANSWERS. Managers see how much each member uses
 *      PollSlide — decks, sessions, responses — never what any audience member answered,
 *      nor any participant's name.
 *   5. A member's own plan limit still applies when they take a deck from the library.
 * --------------------------------------------------------------------------- */

const { limitsFor } = require('./limits');

const HUB_ACTIONS = ['inviteMany', 'removeMany', 'revokeMany', 'resendAll', 'usage',
                     'libList', 'libAdd', 'libGet', 'libUse', 'libRemove'];

const SEATS = { team_small: 5, team_large: 25 };
const seatLimit = ws => SEATS[ws && ws.tier] || 5;
// What each tier is sold with — the same lines the pricing page prints.
const BULK_TIERS = ['team_large'];          // "Bulk member management"
const ORG_TIERS  = ['team_large'];          // "Org-wide usage analytics"

const emailKey = e => (e || '').toLowerCase().trim().replace(/[.#$/\[\]@]/g, '_');
const isEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const asArr = q => Array.isArray(q) ? q : (q && typeof q === 'object' ? Object.values(q) : []);

const MAX_PASTE = 200;                       // emails read from one paste
const LIB_MAX_ITEMS = 400;                   // per team
const LIB_MAX_BYTES = 900 * 1024;            // one library item
const USAGE_MAX_DECKS = 30;                  // per member, most recently opened
const USAGE_TTL_MS = 5 * 60 * 1000;
const DAY = 86400000;

function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1 — read aloud in a room
  let out = ''; for (let i = 0; i < 6; i++) out += A[Math.floor(Math.random() * A.length)];
  return out;
}

/* ── Bulk: turn whatever was pasted into a clean list ─────────────────────────
 * People paste from a spreadsheet column, an email "To" line, a Slack message.
 * Accept commas, semicolons, spaces, new lines and "Name <email>" forms. */
function parseEmails(text) {
  const seen = new Set(), valid = [], invalid = [];
  String(text || '').split(/[\s,;<>()"']+/).map(x => x.trim().toLowerCase().replace(/^mailto:/, '')).filter(Boolean).forEach(tok => {
    if (!tok.includes('@')) return;                       // a name, not an address — ignore quietly
    if (seen.has(tok)) return; seen.add(tok);
    (isEmail(tok) ? valid : invalid).push(tok);
  });
  return { valid: valid.slice(0, MAX_PASTE), invalid, truncated: valid.length > MAX_PASTE };
}

/* Decide, without writing anything, what would happen to each address.
 * Returned in the order pasted so the screen can show the same list back. */
function planInvites(ws, emails) {
  const members = ws.members || {}, invites = ws.invites || {};
  const memberEmails = new Set(Object.values(members).map(m => (m.email || '').toLowerCase()));
  let free = seatLimit(ws) - Object.keys(members).length - Object.keys(invites).length;
  return emails.map(e => {
    if (!isEmail(e)) return { email: e, result: 'invalid' };
    if (memberEmails.has(e)) return { email: e, result: 'member' };
    if (invites[emailKey(e)]) return { email: e, result: 'invited' };
    if (free <= 0) return { email: e, result: 'no_seat' };
    free--; return { email: e, result: 'invite' };
  });
}

/* ── Library: what one item looks like in a list (never the full payload) ── */
/* The adder's email is NOT stored on the item — only their uid — and is looked up from the
 * current member list each time. So when someone leaves the team or deletes their account,
 * their address does not linger in the library; the item simply shows no name. */
function publicItem(id, v, ws) {
  const m = ws && ws.members && ws.members[v.addedByUid];
  return { id, kind: v.kind, title: v.title, productType: v.productType || 'poll', qType: v.qType || null,
           questionCount: v.questionCount || 1, preview: v.preview || [], lang: v.lang || 'en',
           by: (m && m.email) || '', byUid: v.addedByUid || '', at: v.at || 0, uses: v.uses || 0, note: v.note || null };
}
/* The database can hand a list back as an object ({0:…,1:…}) — the app normalises that
 * everywhere it reads a deck. A question entering the library is normalised here too, so a
 * library item is always well-formed whoever takes it out. */
function normQ(q) {
  if (!q || typeof q !== 'object') return q;
  const out = Object.assign({}, q);
  if (out.options !== undefined && out.options !== null) out.options = asArr(out.options);
  if (out.correctAnswer && typeof out.correctAnswer === 'object' && !Array.isArray(out.correctAnswer)) out.correctAnswer = Object.values(out.correctAnswer);
  return out;
}
const qTitle = q => str((q && (q.text || q.front || '')) || '', 140).trim() || 'Untitled question';

/* ── Usage: fold raw records into the rows and totals the panel shows ───────── */
function summariseUsage({ ws, perMember, now, orgWide }) {
  const days = orgWide ? 90 : 30;
  const start = now - days * DAY;
  const series = new Array(days).fill(0);
  const rows = [], totals = { decks: 0, questions: 0, sessions: 0, responses: 0, participants: 0, polly: 0, byType: {} };
  const top = [];
  Object.keys(ws.members || {}).forEach(uid => {
    const m = ws.members[uid], d = perMember[uid] || {};
    const decks = d.decks || [];
    const byType = {};
    let questions = 0, responses = 0, participants = 0, sessions = 0, last30 = 0;
    const activeDays = new Set();
    decks.forEach(dk => {
      byType[dk.type] = (byType[dk.type] || 0) + 1;
      questions += dk.questions || 0;
      responses += dk.responses || 0; participants += dk.participants || 0;
      if (dk.responses) sessions++;
      (dk.stamps || []).forEach(t => {
        if (t >= now - 30 * DAY) { last30++; activeDays.add(Math.floor(t / DAY)); }
        if (t >= start && t <= now) { const i = Math.min(days - 1, Math.floor((t - start) / DAY)); series[i]++; }
      });
      if (dk.responses) top.push({ name: dk.name, by: m.email || '', type: dk.type, responses: dk.responses, participants: dk.participants || 0 });
    });
    Object.keys(byType).forEach(t => { totals.byType[t] = (totals.byType[t] || 0) + byType[t]; });
    totals.decks += decks.length; totals.questions += questions; totals.sessions += sessions;
    totals.responses += responses; totals.participants += participants; totals.polly += d.polly || 0;
    rows.push({ uid, email: m.email || '', role: m.role || 'member', lastSeen: d.lastSeen || 0,
                decks: decks.length, byType, questions, sessions, responses, participants,
                polly: d.polly || 0, responses30: last30, activeDays30: activeDays.size });
  });
  rows.sort((a, b) => (b.responses - a.responses) || (b.decks - a.decks) || a.email.localeCompare(b.email));
  top.sort((a, b) => b.responses - a.responses);
  const active = rows.filter(r => r.responses30 > 0 || (r.lastSeen && r.lastSeen >= now - 30 * DAY)).length;
  return { at: now, orgWide: !!orgWide, days, members: rows.length, activeMembers: active, totals, rows, series,
           topDecks: orgWide ? top.slice(0, 8) : [] };
}

/* ── The handler ──────────────────────────────────────────────────────────────
 * ctx: { callerUid, callerEmail, isSiteAdmin, mail(type,to,data), detachMember(wsId,uid,ws), now() }
 * Returns { status, body }, or null when the action is not one of ours. */
async function handle(db, ctx, body) {
  body = body || {};
  const action = body.action;
  if (!HUB_ACTIONS.includes(action)) return null;
  const now = (ctx.now || Date.now)();
  const out = (status, b) => ({ status, body: b });
  const wsId = str(body.wsId, 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(wsId)) return out(400, { error: 'Which team?' });

  const ws = (await db.ref('workspaces/' + wsId).get()).val();
  if (!ws) return out(404, { error: 'Workspace not found' });
  const me = (ws.members || {})[ctx.callerUid];
  const isManager = ctx.isSiteAdmin || (me && ['owner', 'admin'].includes(me.role));
  const isMember = ctx.isSiteAdmin || !!me;
  if (!isMember) return out(403, { error: 'You are not in this team' });
  const needManager = () => isManager ? null : out(403, { error: 'Only owners and admins can do that.' });
  const needBulk = () => (ctx.isSiteAdmin || BULK_TIERS.includes(ws.tier)) ? null
    : out(402, { error: 'Bulk member tools are part of Team Large.', upgrade: 'team_large' });

  switch (action) {

    /* ── Bulk invite: paste a list, see what will happen, send them all ── */
    case 'inviteMany': {
      const deny = needManager() || needBulk(); if (deny) return deny;
      const parsed = Array.isArray(body.emails) ? parseEmails(body.emails.join(' ')) : parseEmails(body.text);
      const role = body.role === 'admin' ? 'admin' : 'member';
      const plan = planInvites(ws, parsed.valid);
      if (body.preview) return out(200, { ok: true, preview: true, plan, invalid: parsed.invalid, truncated: parsed.truncated, seats: seatLimit(ws) });
      const results = [];
      for (const p of plan) {
        if (p.result !== 'invite') { results.push(p); continue; }
        const k = emailKey(p.email);
        const inv = { email: p.email, role, invitedBy: ctx.callerEmail, createdAt: now };
        // Exactly what the one-at-a-time invite writes — the two can never disagree.
        await db.ref('workspaces/' + wsId + '/invites/' + k).set(inv);
        await db.ref('team_invites/' + k).set({ wsId, wsName: ws.name || '', role, invitedBy: ctx.callerEmail, createdAt: now });
        await ctx.mail('team_invite', p.email, { wsName: ws.name || '', invitedBy: ctx.callerEmail, role });
        results.push({ email: p.email, result: 'invited_now' });
      }
      return out(200, { ok: true, results, invalid: parsed.invalid, sent: results.filter(r => r.result === 'invited_now').length });
    }

    /* ── Bulk remove: several members in one go (never the owner, never yourself) ── */
    case 'removeMany': {
      const deny = needManager() || needBulk(); if (deny) return deny;
      const uids = (Array.isArray(body.uids) ? body.uids : []).map(u => str(u, 128)).slice(0, 100);
      const results = [];
      for (const uid of uids) {
        const m = (ws.members || {})[uid];
        if (!m) { results.push({ uid, result: 'not_member' }); continue; }
        if (uid === ws.ownerUid) { results.push({ uid, email: m.email, result: 'owner' }); continue; }
        if (uid === ctx.callerUid) { results.push({ uid, email: m.email, result: 'self' }); continue; }
        // An admin can remove members, but only the owner removes another admin.
        if (m.role === 'admin' && !ctx.isSiteAdmin && (!me || me.role !== 'owner')) { results.push({ uid, email: m.email, result: 'admin_needs_owner' }); continue; }
        await ctx.detachMember(wsId, uid, ws);
        results.push({ uid, email: m.email, result: 'removed' });
      }
      return out(200, { ok: true, results, removed: results.filter(r => r.result === 'removed').length });
    }

    /* ── Bulk revoke pending invites ── */
    case 'revokeMany': {
      const deny = needManager() || needBulk(); if (deny) return deny;
      const keys = (Array.isArray(body.emailKeys) ? body.emailKeys : []).map(k => str(k, 200)).slice(0, 100);
      let n = 0;
      for (const k of keys) {
        if (!(ws.invites || {})[k]) continue;
        await db.ref('workspaces/' + wsId + '/invites/' + k).remove();
        await db.ref('team_invites/' + k).remove();
        n++;
      }
      return out(200, { ok: true, revoked: n });
    }

    /* ── Resend every pending invite (they went to spam, or it has been a week) ── */
    case 'resendAll': {
      const deny = needManager() || needBulk(); if (deny) return deny;
      let n = 0;
      for (const k of Object.keys(ws.invites || {})) {
        const inv = ws.invites[k];
        // Not more than once an hour per person — a button must not become a mail cannon.
        if (inv.resentAt && now - inv.resentAt < 3600000) continue;
        await ctx.mail('team_invite', inv.email, { wsName: ws.name || '', invitedBy: inv.invitedBy || ctx.callerEmail, role: inv.role });
        await db.ref('workspaces/' + wsId + '/invites/' + k + '/resentAt').set(now);
        n++;
      }
      return out(200, { ok: true, resent: n, pending: Object.keys(ws.invites || {}).length });
    }

    /* ── Usage analytics ── */
    case 'usage': {
      const deny = needManager(); if (deny) return deny;
      const orgWide = ctx.isSiteAdmin || ORG_TIERS.includes(ws.tier);
      const cacheRef = db.ref('admin/team_usage/' + wsId);
      if (!body.fresh) {
        const c = (await cacheRef.get()).val();
        if (c && c.at && now - c.at < USAGE_TTL_MS && c.orgWide === orgWide && c.data) {
          try { return out(200, { ok: true, cached: true, usage: JSON.parse(c.data) }); } catch (e) {}
        }
      }
      const perMember = {};
      for (const uid of Object.keys(ws.members || {})) {
        const pres = (await db.ref('users/' + uid + '/presentations').get()).val() || {};
        const month = new Date(now).toISOString().slice(0, 7);
        const quotaMonth = (await db.ref('users/' + uid + '/aiQuotaMonth').get()).val();
        const polly = quotaMonth === month ? Number((await db.ref('users/' + uid + '/aiUsedThisMonth').get()).val()) || 0 : 0;
        const lastSeen = Number((await db.ref('users/' + uid + '/lastSeen').get()).val()) || 0;
        const list = Object.keys(pres).map(id => pres[id]).filter(p => p && typeof p === 'object')
          .sort((a, b) => (b.lastOpenedAt || b.createdAt || 0) - (a.lastOpenedAt || a.createdAt || 0));
        const decks = [];
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const dk = { name: str(p.name, 80) || 'Untitled', type: p.productType || 'poll', questions: asArr(p.questions).length,
                       responses: 0, participants: 0, stamps: [] };
          if (i < USAGE_MAX_DECKS && p.sessionCode && /^[A-Za-z0-9_-]{1,64}$/.test(String(p.sessionCode))) {
            const resp = (await db.ref('sessions/' + p.sessionCode + '/responses').get()).val() || {};
            const people = new Set();
            Object.keys(resp).forEach(qid => { const byP = resp[qid]; if (!byP || typeof byP !== 'object') return;
              Object.keys(byP).forEach(pid => { const r = byP[pid]; if (!r || typeof r !== 'object') return;
                dk.responses++; people.add(pid); if (r.submittedAt) dk.stamps.push(Number(r.submittedAt)); }); });
            dk.participants = people.size;
          }
          decks.push(dk);
        }
        perMember[uid] = { decks, polly, lastSeen };
      }
      const usage = summariseUsage({ ws, perMember, now, orgWide });
      usage.team = { name: ws.name || '', tier: ws.tier, seats: seatLimit(ws), used: Object.keys(ws.members || {}).length, pending: Object.keys(ws.invites || {}).length };
      await cacheRef.set({ at: now, orgWide, data: JSON.stringify(usage) }).catch(() => {});
      return out(200, { ok: true, usage });
    }

    /* ── Library: list ── */
    case 'libList': {
      const all = (await db.ref('team_library/' + wsId).get()).val() || {};
      const items = Object.keys(all).map(id => publicItem(id, all[id], ws)).sort((a, b) => b.at - a.at);
      return out(200, { ok: true, items, canManage: !!isManager, max: LIB_MAX_ITEMS });
    }

    /* ── Library: add one of MY decks, or one question from it ── */
    case 'libAdd': {
      const presId = str(body.presId, 80);
      const snap = await db.ref('users/' + ctx.callerUid + '/presentations/' + presId).get();
      if (!presId || !snap.exists()) return out(404, { error: 'That deck no longer exists.' });
      const deck = snap.val();
      const questions = asArr(deck.questions).map(normQ);
      const count = Object.keys((await db.ref('team_library/' + wsId).get()).val() || {}).length;
      if (count >= LIB_MAX_ITEMS) return out(409, { error: 'The team library is full (' + LIB_MAX_ITEMS + ' items). Remove something first.' });
      const base = { addedByUid: ctx.callerUid, at: now, uses: 0,
                     productType: str(deck.productType, 16) || 'poll', lang: str(deck.language, 8) || 'en', note: str(body.note, 200) || null };
      let item;
      if (body.kind === 'question') {
        const idx = Number(body.qIndex);
        const q = questions[idx];
        if (!Number.isInteger(idx) || !q) return out(404, { error: 'That question no longer exists.' });
        item = Object.assign(base, { kind: 'question', title: qTitle(q), qType: str(q.type, 32) || 'multiple_choice', questionCount: 1,
          preview: asArr(q.options).slice(0, 4).map(o => str(o && o.text, 60)).filter(Boolean),
          payload: JSON.stringify({ question: q }) });
      } else {
        if (!questions.length) return out(400, { error: 'That deck has no questions yet.' });
        item = Object.assign(base, { kind: 'deck', title: str(deck.name, 120) || 'Untitled', questionCount: questions.length,
          preview: questions.slice(0, 3).map(qTitle),
          payload: JSON.stringify({ name: deck.name, productType: deck.productType, language: deck.language || 'en', questions }) });
      }
      if (item.payload.length > LIB_MAX_BYTES) return out(413, { error: 'That is too large for the library. Decks with pictures stored inside them are the usual cause — re-add the pictures as links, then try again.' });
      const id = 'lib_' + now.toString(36) + Math.random().toString(36).slice(2, 8);
      await db.ref('team_library/' + wsId + '/' + id).set(item);
      return out(200, { ok: true, item: publicItem(id, item, ws) });
    }

    /* ── Library: look inside one item before using it ── */
    case 'libGet': {
      const id = str(body.itemId, 60);
      const v = (await db.ref('team_library/' + wsId + '/' + id).get()).val();
      if (!v) return out(404, { error: 'That item was removed from the library.' });
      let payload; try { payload = JSON.parse(v.payload); } catch (e) { return out(500, { error: 'That library item is damaged.' }); }
      const questions = v.kind === 'question' ? [payload.question] : asArr(payload.questions);
      return out(200, { ok: true, item: publicItem(id, v, ws), questions });
    }

    /* ── Library: use it. A deck becomes MY OWN copy; a question is handed back
          for the app to add to the deck I have open. ── */
    case 'libUse': {
      const id = str(body.itemId, 60);
      const ref = db.ref('team_library/' + wsId + '/' + id);
      const v = (await ref.get()).val();
      if (!v) return out(404, { error: 'That item was removed from the library.' });
      let payload; try { payload = JSON.parse(v.payload); } catch (e) { return out(500, { error: 'That library item is damaged.' }); }
      if (v.kind === 'question') {
        await ref.update({ uses: (v.uses || 0) + 1, lastUsedAt: now });
        return out(200, { ok: true, kind: 'question', question: payload.question, title: v.title });
      }
      // The member's own plan decides whether they can hold another deck.
      const meVal = (await db.ref('users/' + ctx.callerUid).get()).val() || {};
      const lim = limitsFor(meVal.tier);
      if (Object.keys(meVal.presentations || {}).length >= lim.maxPresentations) {
        return out(402, { error: `Your ${lim.name} plan holds ${lim.maxPresentations} decks. Free up a slot or upgrade, then try again.`, limitReached: true });
      }
      const newId = 'pres_' + now + Math.random().toString(36).slice(2, 5);
      const copy = { id: newId, name: payload.name || v.title || 'Team deck', sessionCode: genCode(),   // its own room — never share a session code
        createdAt: now, lastOpenedAt: now, productType: payload.productType || v.productType || 'poll',
        language: payload.language || 'en', questions: payload.questions || [],
        fromTeamLibrary: { at: now, itemId: id } };
      await db.ref('users/' + ctx.callerUid + '/presentations/' + newId).set(copy);
      await ref.update({ uses: (v.uses || 0) + 1, lastUsedAt: now });
      return out(200, { ok: true, kind: 'deck', presId: newId, name: copy.name });
    }

    /* ── Library: remove (whoever added it, or a manager) ── */
    case 'libRemove': {
      const id = str(body.itemId, 60);
      const ref = db.ref('team_library/' + wsId + '/' + id);
      const v = (await ref.get()).val();
      if (!v) return out(200, { ok: true });
      if (!isManager && v.addedByUid !== ctx.callerUid) return out(403, { error: 'Only the person who added it, or a team admin, can remove it.' });
      await ref.remove();
      return out(200, { ok: true });
    }
  }
  return null;
}

module.exports = { HUB_ACTIONS, handle, normQ, parseEmails, planInvites, summariseUsage, publicItem, seatLimit,
                   BULK_TIERS, ORG_TIERS, LIB_MAX_ITEMS, emailKey };
