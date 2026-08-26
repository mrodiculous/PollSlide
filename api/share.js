/* PollSlide — share a deck with another user.
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 * Send someone a copy of a poll / survey / quiz / study set. They get their own
 * independent deck in their own library and can edit it freely; your original is
 * never touched. Works whether or not they're on your team, and whether or not
 * they've signed up yet — an unclaimed share waits in their inbox keyed by email,
 * exactly like team invites already do.
 *
 * WHY THIS IS A SERVER ENDPOINT
 * users/$uid is readable only by that uid, so a browser simply cannot read someone
 * else's deck — and Realtime Database rules can't filter queries, so a recipient
 * could never list what's been shared with them either. Both problems disappear if
 * the Admin SDK does the reading and writing.
 *
 * The alternative — copying the deck into a world-readable node — is what
 * sharedDecks/$sid does for PresentSlide today, and it means anyone holding the id
 * can read the deck JSON including quiz answers. Deliberately not repeated here:
 * shares/ is not client-readable at all.
 *
 * Env: FIREBASE_*, INTERNAL_API_KEY (notification email), NEXT_PUBLIC_APP_URL.
 * --------------------------------------------------------------------------- */
const admin = require('firebase-admin');
const { verifyToken, tokenFrom, ADMIN_EMAILS } = require('../lib/quota');
const { limitsFor } = require('../lib/limits');
const { rateLimit, clientIp, sweepRateLimits } = require('../lib/guard');

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.pollslide.com';

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

// Identical to api/team.js and presenter.html — an email flattened into an RTDB key.
function emailKey(e) { return (e || '').toLowerCase().trim().replace(/[.#$/\[\]@]/g, '_'); }
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
const s = (v, n) => String(v == null ? '' : v).slice(0, n);

function genCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1 — read aloud in a room
  let out = ''; for (let i = 0; i < 6; i++) out += A[Math.floor(Math.random() * A.length)];
  return out;
}

async function notify(to, subject, heading, body) {
  try {
    await fetch(APP_URL + '/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify({ type: 'notify', to, data: { subject, heading, body } }),
    });
  } catch (e) { /* the share still exists in-app; email is a courtesy */ }
}

const esc = (v) => String(v == null ? '' : v)
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// What a recipient is allowed to see about a share before accepting it. Never the
// deck contents — a pending share must not leak questions to an unintended address.
function publicShare(id, v) {
  return {
    id,
    from: v.fromEmail, fromName: v.fromName || null,
    title: v.title, productType: v.productType, questionCount: v.questionCount,
    role: v.role || 'copy',
    note: v.note || null, at: v.at, status: v.status,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getDb();
  if (!db) return res.status(500).json({ error: 'Firebase Admin not configured' });

  let me;
  try { me = await verifyToken(tokenFrom(req)); } catch (e) { me = null; }
  if (!me || !me.uid) return res.status(401).json({ error: 'Sign in to share.' });
  const myEmail = String(me.email || '').toLowerCase();
  const myKey = emailKey(myEmail);

  const { action } = req.body || {};

  try {
    switch (action) {

      /* ── Send a copy of one deck to an email address ───────────────────── */
      case 'send': {
        const { presId, toEmail, note } = req.body || {};
        // 'copy'  → they get their own independent duplicate (default)
        // 'edit'  → they work on YOUR deck with you; you stay the owner and can revoke
        const role = req.body && req.body.role === 'edit' ? 'edit' : 'copy';
        if (!presId) return res.status(400).json({ error: 'Which deck?' });
        if (!isEmail(toEmail)) return res.status(400).json({ error: 'That doesn\'t look like an email address.' });
        const to = String(toEmail).toLowerCase().trim();
        if (emailKey(to) === myKey) return res.status(400).json({ error: 'That\'s your own address.' });

        // Sharing sends email on someone else's behalf, so it is rate limited per
        // sender — an open share endpoint is a spam relay.
        const rl = await rateLimit(db, 'share_' + me.uid, 30, 3600000);
        if (!rl.allowed) return res.status(429).json({ error: 'You\'ve sent a lot of shares this hour. Try again shortly.' });
        sweepRateLimits(db);

        const snap = await db.ref(`users/${me.uid}/presentations/${presId}`).get();
        if (!snap.exists()) return res.status(404).json({ error: 'That deck no longer exists.' });
        const deck = snap.val();

        const questions = Array.isArray(deck.questions) ? deck.questions
                        : deck.questions ? Object.values(deck.questions) : [];

        const shareId = 'sh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const rec = {
          fromUid: me.uid, fromEmail: myEmail, fromName: s(me.name, 80) || null,
          toEmail: to, toEmailKey: emailKey(to),
          presId, title: s(deck.name, 120) || 'Untitled',
          productType: s(deck.productType, 16) || 'poll',
          questionCount: questions.length,
          note: s(note, 300) || null,
          role,
          // A COPY carries a snapshot taken now — later edits by the sender
          // deliberately don't reach an already-sent copy. A COLLABORATION carries no
          // payload at all: it's a pointer to the live deck, which is the whole point.
          payload: role === 'copy'
            ? JSON.stringify({ name: deck.name, productType: deck.productType,
                               language: deck.language || 'en', questions })
            : null,
          at: Date.now(), status: 'pending',
        };
        await db.ref('shares/' + shareId).set(rec);

        const noteHtml = rec.note ? `<p style="border-left:3px solid #6c63ff;padding-left:12px;color:#555;">${esc(rec.note)}</p>` : '';
        await notify(to,
          role === 'edit'
            ? `🤝 ${esc(myEmail)} invited you to build “${esc(rec.title)}” together`
            : `📤 ${esc(myEmail)} shared “${esc(rec.title)}” with you`,
          role === 'edit' ? 'You were invited to collaborate' : 'A deck was shared with you',
          role === 'edit'
            ? `<p><b>${esc(myEmail)}</b> wants to build <b>${esc(rec.title)}</b> with you — ${rec.questionCount} question${rec.questionCount === 1 ? '' : 's'} so far.</p>` + noteHtml +
              `<p>Open PollSlide and accept under <b>Shared with me</b>. You'll both edit the same deck and see each other's changes as they happen.</p>` +
              `<p style="color:#666;font-size:13px;">${esc(myEmail)} stays the owner and can end the collaboration at any time.</p>` +
              `<p><a href="${APP_URL}/presenter.html">Open PollSlide →</a></p>`
            : `<p><b>${esc(myEmail)}</b> sent you a copy of <b>${esc(rec.title)}</b> — ${rec.questionCount} question${rec.questionCount === 1 ? '' : 's'}.</p>` + noteHtml +
              `<p>Open PollSlide and you'll find it under <b>Shared with me</b>. Accepting puts your own copy in your library — you can change it however you like, and the original stays with ${esc(myEmail)}.</p>` +
              `<p><a href="${APP_URL}/presenter.html">Open PollSlide →</a></p>`);

        return res.status(200).json({ ok: true, shareId });
      }

      /* ── What has been shared WITH me ──────────────────────────────────── */
      case 'inbox': {
        const q = await db.ref('shares').orderByChild('toEmailKey').equalTo(myKey).get();
        const out = [];
        q.forEach(c => { const v = c.val(); if (v && v.status === 'pending') out.push(publicShare(c.key, v)); });
        out.sort((a, b) => b.at - a.at);
        return res.status(200).json({ ok: true, shares: out });
      }

      /* ── What I have shared with others ────────────────────────────────── */
      case 'sent': {
        const q = await db.ref('shares').orderByChild('fromUid').equalTo(me.uid).get();
        const out = [];
        q.forEach(c => {
          const v = c.val(); if (!v) return;
          out.push({ id: c.key, to: v.toEmail, title: v.title, at: v.at, status: v.status,
                     acceptedAt: v.acceptedAt || null });
        });
        out.sort((a, b) => b.at - a.at);
        return res.status(200).json({ ok: true, shares: out });
      }

      /* ── Accept: the copy lands in MY library ──────────────────────────── */
      case 'accept': {
        const { shareId } = req.body || {};
        const ref = db.ref('shares/' + s(shareId, 60));
        const snap = await ref.get();
        if (!snap.exists()) return res.status(404).json({ error: 'That share is gone.' });
        const v = snap.val();
        if (v.toEmailKey !== myKey) return res.status(403).json({ error: 'That share isn\'t addressed to you.' });
        if (v.status !== 'pending') return res.status(409).json({ error: 'That share was already ' + v.status + '.' });

        /* ── Collaboration: no copy at all ────────────────────────────────
         * Write a grant and an index entry. The deck stays in the owner's tree and
         * they remain the owner — database rules read deckGrants on every request, so
         * revoking takes effect on the very next write with no session to expire.
         * No plan check: the deck doesn't count against the collaborator's library,
         * because it isn't in it. */
        if (v.role === 'edit') {
          const ownerStill = await db.ref(`users/${v.fromUid}/presentations/${v.presId}`).get();
          if (!ownerStill.exists()) {
            await ref.update({ status: 'gone', at: Date.now() });
            return res.status(404).json({ error: 'That deck has since been deleted by its owner.' });
          }
          await db.ref(`deckGrants/${v.fromUid}/${v.presId}/${me.uid}`).set('edit');
          await db.ref(`collabIndex/${me.uid}/${v.fromUid}_${v.presId}`).set({
            ownerUid: v.fromUid, ownerEmail: v.fromEmail, presId: v.presId,
            title: v.title, productType: v.productType, role: 'edit', at: Date.now(),
          });
          await ref.update({ status: 'accepted', acceptedAt: Date.now(), acceptedBy: me.uid });

          notify(v.fromEmail, `🤝 ${esc(myEmail)} joined “${esc(v.title)}”`, 'Collaboration started',
            `<p><b>${esc(myEmail)}</b> can now edit <b>${esc(v.title)}</b> with you. You'll see each other's changes as they happen.</p>
             <p style="color:#666;font-size:13px;">You're still the owner — end it any time from the deck's ⋯ menu.</p>`);

          return res.status(200).json({ ok: true, collab: true, ownerUid: v.fromUid, presId: v.presId, name: v.title });
        }

        // The recipient's own plan decides whether they can hold another deck —
        // otherwise sharing would be a way around the free-tier cap.
        const meSnap = await db.ref(`users/${me.uid}`).get();
        const meVal = meSnap.val() || {};
        const lim = limitsFor(meVal.tier);
        const have = Object.keys(meVal.presentations || {}).length;
        if (have >= lim.maxPresentations) {
          return res.status(402).json({
            error: `Your ${lim.name} plan holds ${lim.maxPresentations} decks. Free up a slot or upgrade, then accept this.`,
            limitReached: true,
          });
        }

        let payload;
        try { payload = JSON.parse(v.payload); } catch (e) { return res.status(500).json({ error: 'That share is corrupted.' }); }

        const newId = 'pres_' + Date.now();
        const copy = {
          id: newId,
          name: payload.name || v.title || 'Shared deck',
          sessionCode: genCode(),          // its own room — never share a session code
          createdAt: Date.now(),
          lastOpenedAt: Date.now(),
          productType: payload.productType || v.productType || 'poll',
          language: payload.language || 'en',
          questions: payload.questions || [],
          sharedFrom: { email: v.fromEmail, at: Date.now() },   // provenance, for the UI
        };
        await db.ref(`users/${me.uid}/presentations/${newId}`).set(copy);
        await ref.update({ status: 'accepted', acceptedAt: Date.now(), acceptedBy: me.uid });

        notify(v.fromEmail, `✅ ${esc(myEmail)} accepted “${esc(v.title)}”`, 'Share accepted',
          `<p><b>${esc(myEmail)}</b> now has their own copy of <b>${esc(v.title)}</b>.</p>
           <p>Changes they make are theirs alone — your original is untouched.</p>`);

        return res.status(200).json({ ok: true, presId: newId, name: copy.name });
      }

      case 'decline': {
        const { shareId } = req.body || {};
        const ref = db.ref('shares/' + s(shareId, 60));
        const snap = await ref.get();
        if (!snap.exists()) return res.status(404).json({ error: 'That share is gone.' });
        if (snap.val().toEmailKey !== myKey) return res.status(403).json({ error: 'That share isn\'t addressed to you.' });
        await ref.update({ status: 'declined', declinedAt: Date.now() });
        return res.status(200).json({ ok: true });
      }

      /* ── Revoke: only meaningful while still pending ───────────────────── */
      case 'revoke': {
        const { shareId } = req.body || {};
        const ref = db.ref('shares/' + s(shareId, 60));
        const snap = await ref.get();
        if (!snap.exists()) return res.status(404).json({ error: 'That share is gone.' });
        const v = snap.val();
        if (v.fromUid !== me.uid) return res.status(403).json({ error: 'That isn\'t your share.' });
        if (v.status === 'accepted') {
          // Be honest rather than pretend: the copy is already theirs.
          return res.status(409).json({ error: 'Already accepted — they have their own copy now, and revoking can\'t take it back.' });
        }
        await ref.remove();
        return res.status(200).json({ ok: true });
      }

      /* ── Who can edit one of MY decks ──────────────────────────────────── */
      case 'collaborators': {
        const { presId } = req.body || {};
        const snap = await db.ref(`deckGrants/${me.uid}/${s(presId, 60)}`).get();
        const out = [];
        snap.forEach(c => { out.push({ uid: c.key, role: c.val() }); });
        // Grants store only a uid; the readable email lives on the share that created it.
        const shares = await db.ref('shares').orderByChild('fromUid').equalTo(me.uid).get();
        const emailByUid = {};
        shares.forEach(c => { const v = c.val(); if (v && v.acceptedBy) emailByUid[v.acceptedBy] = v.toEmail; });
        out.forEach(o => { o.email = emailByUid[o.uid] || null; });
        return res.status(200).json({ ok: true, collaborators: out });
      }

      /* ── End a collaboration. The owner revokes; a collaborator leaves. ──── */
      case 'revokeCollab': {
        const { presId, collabUid } = req.body || {};
        const pid = s(presId, 60), cu = s(collabUid, 128);
        if (!pid || !cu) return res.status(400).json({ error: 'Which deck, and whose access?' });
        const g = await db.ref(`deckGrants/${me.uid}/${pid}/${cu}`).get();
        if (!g.exists()) return res.status(404).json({ error: 'They already have no access to this deck.' });
        await db.ref(`deckGrants/${me.uid}/${pid}/${cu}`).remove();
        await db.ref(`collabIndex/${cu}/${me.uid}_${pid}`).remove().catch(() => {});
        return res.status(200).json({ ok: true });
      }

      case 'leaveCollab': {
        const { ownerUid, presId } = req.body || {};
        const ou = s(ownerUid, 128), pid = s(presId, 60);
        if (!ou || !pid) return res.status(400).json({ error: 'Which deck?' });
        await db.ref(`deckGrants/${ou}/${pid}/${me.uid}`).remove().catch(() => {});
        await db.ref(`collabIndex/${me.uid}/${ou}_${pid}`).remove().catch(() => {});
        return res.status(200).json({ ok: true });
      }

      /* ── Decks other people have let ME edit ──────────────────────────────── */
      case 'shared_with_me': {
        const snap = await db.ref(`collabIndex/${me.uid}`).get();
        const out = [];
        snap.forEach(c => { const v = c.val() || {}; out.push(Object.assign({ key: c.key }, v)); });
        return res.status(200).json({ ok: true, decks: out });
      }

      /* ── ADMIN: support tooling ───────────────────────────────────────────
       * "I shared a quiz with Jane and she never got it" is unanswerable without
       * being able to look a share up from either side. Admin-gated. */
      case 'admin_lookup': {
        if (!ADMIN_EMAILS.includes(myEmail)) return res.status(403).json({ error: 'Admins only.' });
        const q = String((req.body || {}).email || '').toLowerCase().trim();
        if (!isEmail(q)) return res.status(400).json({ error: 'Give me an email address to look up.' });
        const key = emailKey(q);

        const [toThem, fromThem] = await Promise.all([
          db.ref('shares').orderByChild('toEmailKey').equalTo(key).get(),
          db.ref('shares').get(),
        ]);
        const received = [], sent = [];
        toThem.forEach(c => { const v = c.val() || {};
          received.push({ id: c.key, from: v.fromEmail, title: v.title, role: v.role || 'copy',
                          status: v.status, at: v.at, acceptedAt: v.acceptedAt || null }); });
        fromThem.forEach(c => { const v = c.val() || {};
          if ((v.fromEmail || '').toLowerCase() !== q) return;
          sent.push({ id: c.key, to: v.toEmail, title: v.title, role: v.role || 'copy',
                      status: v.status, at: v.at, acceptedAt: v.acceptedAt || null }); });
        received.sort((a, b) => b.at - a.at); sent.sort((a, b) => b.at - a.at);

        // Live collaborations, both directions.
        const uid = (await db.ref('admin/users_index').orderByChild('email').equalTo(q).get()).val();
        const theirUid = uid ? Object.keys(uid)[0] : null;
        const grantsOut = [], grantsIn = [];
        if (theirUid) {
          const g = await db.ref(`deckGrants/${theirUid}`).get();
          g.forEach(d => {
            Object.keys(d.val() || {}).forEach(cu => grantsOut.push({ presId: d.key, collabUid: cu }));
          });
          const ci = await db.ref(`collabIndex/${theirUid}`).get();
          ci.forEach(c => { const v = c.val() || {}; grantsIn.push({ ownerEmail: v.ownerEmail, presId: v.presId, title: v.title }); });
        }
        return res.status(200).json({ ok: true, uid: theirUid, received, sent, grantsOut, grantsIn });
      }

      /* Support can end a collaboration on a user's behalf — "someone is editing my
       * deck and I can't get them off". */
      case 'admin_revoke': {
        if (!ADMIN_EMAILS.includes(myEmail)) return res.status(403).json({ error: 'Admins only.' });
        const { ownerUid, presId, collabUid } = req.body || {};
        if (!ownerUid || !presId || !collabUid) return res.status(400).json({ error: 'Need ownerUid, presId and collabUid.' });
        await db.ref(`deckGrants/${s(ownerUid,128)}/${s(presId,60)}/${s(collabUid,128)}`).remove();
        await db.ref(`collabIndex/${s(collabUid,128)}/${s(ownerUid,128)}_${s(presId,60)}`).remove().catch(() => {});
        return res.status(200).json({ ok: true });
      }

      /* Counts for the admin overview — cheap enough to read on page load. */
      case 'admin_stats': {
        if (!ADMIN_EMAILS.includes(myEmail)) return res.status(403).json({ error: 'Admins only.' });
        const snap = await db.ref('shares').get();
        const byStatus = {}, byRole = {};
        let total = 0, withPayload = 0;
        snap.forEach(c => { const v = c.val() || {}; total++;
          byStatus[v.status || '?'] = (byStatus[v.status || '?'] || 0) + 1;
          byRole[v.role || 'copy'] = (byRole[v.role || 'copy'] || 0) + 1;
          if (v.payload) withPayload++; });
        const g = await db.ref('deckGrants').get();
        let liveCollabs = 0;
        g.forEach(o => { Object.values(o.val() || {}).forEach(d => { liveCollabs += Object.keys(d || {}).length; }); });
        return res.status(200).json({ ok: true, total, byStatus, byRole, withPayload, liveCollabs });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports.emailKey = emailKey;
module.exports.publicShare = publicShare;
module.exports.isEmail = isEmail;
