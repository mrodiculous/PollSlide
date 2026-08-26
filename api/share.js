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
const { verifyToken, tokenFrom } = require('../lib/quota');
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
          // The snapshot is taken NOW. A copy-share is a point-in-time send: later
          // edits by the sender deliberately do not reach an already-sent share.
          payload: JSON.stringify({ name: deck.name, productType: deck.productType,
                                    language: deck.language || 'en', questions }),
          at: Date.now(), status: 'pending',
        };
        await db.ref('shares/' + shareId).set(rec);

        await notify(to,
          `📤 ${esc(myEmail)} shared “${esc(rec.title)}” with you`,
          'A deck was shared with you',
          `<p><b>${esc(myEmail)}</b> sent you a copy of <b>${esc(rec.title)}</b> — ${rec.questionCount} question${rec.questionCount === 1 ? '' : 's'}.</p>` +
          (rec.note ? `<p style="border-left:3px solid #6c63ff;padding-left:12px;color:#555;">${esc(rec.note)}</p>` : '') +
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
