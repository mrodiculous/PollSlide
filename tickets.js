/* PollSlide — support tickets: one reading of a conversation.
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * A ticket is stored twice (users/$uid/tickets/$id for the person who asked,
 * admin/tickets/$id for us) and read in two places (the user's Support Chat and
 * Admin → Tickets). Each side used to decide for itself what the conversation was —
 * and the admin side decided it was ONLY the first message. openTicket rendered
 * t.message and never looked at t.replies, so every answer was written blind to what
 * had already been said. It also rendered that message raw into innerHTML, inside the
 * one session that has write access to the whole database.
 *
 * So the shape of a conversation — who spoke, in what order, who spoke last, whether a
 * reply was emailed — lives here once. Loaded by presenter.html and admin.html, by
 * api/watchdog.js through lib/tickets.js, and by the tests: the same file everywhere.
 *
 * STORED SHAPE. Everything after `createdAt` is optional — tickets written before
 * 2026-09-15 carry none of it and must still render:
 *   { uid, email, subject, message, category, status: 'open'|'resolved', createdAt,
 *     lang, replies: { <key>: { text, at, from: 'admin'|'user', by?,
 *                               emailedAt?, emailTo?, emailLang?, emailError? } },
 *     replied, awaiting: 'admin'|'user', lastUserReplyAt, lastAdminReplyAt }
 *
 * A reply with no `from` is an ADMIN reply: until user follow-ups existed, the admin
 * panel was the only thing that ever wrote one.
 * --------------------------------------------------------------------------- */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PSTickets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_TEXT = 5000;                    // matches the rule on admin/tickets/$id/replies
  const LANGS = ['en', 'es', 'de', 'fr', 'pt', 'it'];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* Ticket ids end up in a database path, in a URL (?support=<id> from the reply email)
     and in the admin panel's markup. The only ones we mint are ticket_<ms>, and the rules
     refuse any other shape from a non-admin — so anything else is not a ticket. */
  function validTicketId(id) {
    return typeof id === 'string' && id.length <= 40 && /^ticket_[0-9]+$/.test(id);
  }

  // A ticket with no status at all is open: the badge always counted it that way.
  function isOpen(t) { return !!t && t.status !== 'resolved'; }

  function emailLang(t) { return t && LANGS.indexOf(t.lang) !== -1 ? t.lang : 'en'; }

  /* The conversation, oldest first. The original message is always first — it IS the
     start, even on a legacy ticket with no createdAt to sort it by. */
  function thread(t) {
    if (!t || typeof t !== 'object') return [];
    const out = [{ key: null, from: 'user', original: true,
                   text: String(t.message == null ? '' : t.message), at: Number(t.createdAt) || 0 }];
    const replies = t.replies && typeof t.replies === 'object' ? t.replies : {};
    const rest = [];
    Object.keys(replies).forEach(key => {
      const r = replies[key];
      if (!r || typeof r !== 'object') return;
      rest.push({
        key, original: false,
        from: r.from === 'user' ? 'user' : 'admin',
        text: String(r.text == null ? '' : r.text),
        // Reply keys are the write timestamp, so they stand in for a missing `at`.
        at: Number(r.at) || Number(String(key).replace(/\D/g, '')) || 0,
        by: r.by || '',
        emailedAt: r.emailedAt || null, emailTo: r.emailTo || null,
        emailLang: r.emailLang || null, emailError: r.emailError || null,
      });
    });
    rest.sort((a, b) => a.at - b.at);
    return out.concat(rest);
  }

  function lastSpeaker(t) {
    const th = thread(t);
    return th.length ? th[th.length - 1].from : null;
  }

  // Someone is waiting on us: the user said the last thing and it is not closed.
  function needsResponse(t) { return isOpen(t) && lastSpeaker(t) === 'user'; }

  function replyCounts(t) {
    let admin = 0, user = 0;
    thread(t).slice(1).forEach(e => { if (e.from === 'user') user++; else admin++; });
    return { admin, user, total: admin + user };
  }

  function lastActivity(t) {
    return thread(t).reduce((m, e) => Math.max(m, e.at || 0), 0);
  }

  /* Was this admin reply emailed? 'none' is every reply written before email-on-reply
     existed, and any reply whose email never came back (tab closed mid-send). A failure
     is a state of its own so it can be shown — the user only sees that reply if they
     happen to open PollSlide, and nobody should have to guess whether they were told. */
  function emailStatus(e) {
    if (!e || e.from !== 'admin') return null;
    if (e.emailedAt) return { state: 'sent', at: e.emailedAt, to: e.emailTo, lang: e.emailLang };
    if (e.emailError) return { state: 'failed', error: String(e.emailError), lang: e.emailLang };
    return { state: 'none' };
  }

  /* The admin panel's thread. Every value from the ticket goes through escapeHtml — the
     message, the replies, the sender, the stored email error and the reply key on the
     retry button — because a ticket is typed by whoever filed it and read by the account
     that can write anywhere. `white-space:pre-wrap` keeps the line breaks people typed. */
  function threadHtml(t, opts) {
    opts = opts || {};
    const fmt = opts.fmt || (ts => ts ? new Date(ts).toLocaleString() : '—');
    return thread(t).map(e => {
      const user = e.from === 'user';
      const who = user ? (e.original ? 'User · original request' : 'User · follow-up')
                       : ('Admin' + (e.by ? ' · ' + e.by : ''));
      const em = emailStatus(e);
      let mail = '';
      if (em && em.state === 'sent') {
        mail = '<div style="margin-top:6px;font-size:10.5px;color:var(--accent3);">✉ Emailed ' +
          escapeHtml(fmt(em.at)) + (em.to ? ' to ' + escapeHtml(em.to) : '') +
          (em.lang ? ' · ' + escapeHtml(em.lang) : '') + '</div>';
      } else if (em && em.state === 'failed') {
        mail = '<div style="margin-top:6px;font-size:11px;font-weight:600;color:var(--accent2);">⚠ Email FAILED: ' +
          escapeHtml(em.error) + ' — they have only been told in PollSlide. ' +
          '<button class="btn btn-sm btn-ghost" data-retry-reply="' + escapeHtml(e.key) + '">Retry email</button></div>';
      } else if (em) {
        mail = '<div style="margin-top:6px;font-size:10.5px;color:var(--muted);">In-app only — not emailed</div>';
      }
      return '<div data-from="' + (user ? 'user' : 'admin') + '" style="border-radius:8px;padding:9px 11px;font-size:13px;line-height:1.55;' +
          (user ? 'background:var(--surface2);border:1px solid var(--border2);margin-right:18px;'
                : 'background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.3);margin-left:18px;') + '">' +
        '<div style="font-size:10.5px;color:var(--muted);margin-bottom:4px;">' +
          '<b style="color:' + (user ? 'var(--text)' : 'var(--accent)') + ';">' + escapeHtml(who) + '</b> · ' + escapeHtml(fmt(e.at)) +
        '</div>' +
        '<div style="white-space:pre-wrap;word-break:break-word;">' + (e.text ? escapeHtml(e.text) : '<i style="color:var(--muted);">(empty)</i>') + '</div>' +
        mail +
      '</div>';
    }).join('');
  }

  /* A user answering back. Returned as two separate path maps rather than one, because
     they must not be one atomic write: the user's own copy is the write they are
     guaranteed to own, and the admin mirror is the one the rules can refuse (for a
     ticket whose original mirror never landed). Folding them together would let a
     refused mirror throw away the reply the user just typed. */
  function followUpWrites(uid, ticketId, text, now) {
    const body = String(text == null ? '' : text).trim().slice(0, MAX_TEXT);
    if (!uid) throw new Error('not signed in');
    if (!validTicketId(ticketId)) throw new Error('not a ticket id');
    if (!body) throw new Error('empty reply');
    // Prefixed so it can never collide with (and be refused as overwriting) an admin
    // reply written in the same millisecond, which is keyed by the bare timestamp.
    const key = 'u' + now;
    const reply = { text: body, at: now, from: 'user' };
    const u = 'users/' + uid + '/tickets/' + ticketId;
    const a = 'admin/tickets/' + ticketId;
    const user = {}, admin = {};
    user[u + '/replies/' + key] = reply;
    user[u + '/status'] = 'open';                // replying re-opens a resolved ticket
    admin[a + '/replies/' + key] = reply;
    admin[a + '/status'] = 'open';
    admin[a + '/awaiting'] = 'admin';
    admin[a + '/lastUserReplyAt'] = now;         // what the watchdog queries on
    return { key, user, admin };
  }

  /* Follow-ups the watchdog has not paged about yet. A ticket CREATED in the same window
     is left out — the new-ticket email already carries it — and so is one the admin has
     already answered by the time the run happens: that is no longer waiting on anyone. */
  function followUpsSince(tickets, sinceMs) {
    const out = [];
    Object.keys(tickets || {}).forEach(id => {
      const t = tickets[id];
      if (!t || !(Number(t.lastUserReplyAt) > sinceMs)) return;
      if (Number(t.createdAt) > sinceMs) return;
      const th = thread(t);
      const last = th[th.length - 1];
      if (!last || last.from !== 'user' || last.original) return;
      out.push({ id, subject: t.subject || '', email: t.email || '', text: last.text, at: last.at });
    });
    return out;
  }

  return {
    MAX_TEXT, LANGS,
    escapeHtml, validTicketId, isOpen, emailLang,
    thread, lastSpeaker, needsResponse, replyCounts, lastActivity, emailStatus,
    threadHtml, followUpWrites, followUpsSince,
  };
});
