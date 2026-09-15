#!/usr/bin/env node
/* Support tickets: the conversation, the reply email, and who may write what.
 *
 * WHAT WAS WRONG (found 2026-09-15, from a French user's ticket about the Mac app):
 *   • Admin → Tickets showed ONLY the first message. Replies were stored and never
 *     rendered, so the owner answered blind to what had already been said.
 *   • A reply emailed nobody. The panel toasted "Reply sent." and the user was told only if
 *     they happened to open PollSlide again.
 *   • The user could not answer back inside a ticket at all.
 *   • admin/tickets was ".write": "auth != null". Any signed-in account could rewrite any
 *     ticket — forge a reply "from admin", mark someone's ticket resolved — and the admin
 *     panel rendered ticket text raw into innerHTML, in the session with full database
 *     access. Stored XSS aimed at the one account worth attacking.
 *
 * So this checks behaviour where it can be run (tickets.js, the email template and handler,
 * the rules — evaluated, not grepped) and source where it cannot (the two pages).
 *
 * Run: node scripts/tests/tickets.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 300) : '')); }
};
// Comments quote the very bugs being checked for, so source assertions read code only.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* The body of a top-level function in a page, by brace matching from its declaration. */
function fnBody(src, name) {
  const m = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) return '';
  let i = src.indexOf('{', m.index), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1);
  }
  return '';
}

const T = require('../../lib/tickets');
const NOW = 1_760_000_000_000;

/* ── 1. The conversation ──────────────────────────────────────────────────── */
console.log('\nA ticket reads as one conversation, oldest first');
{
  const t = {
    uid: 'u1', email: 'a@b.fr', subject: 'Mac', message: 'Je ne sais pas où entrer le code',
    status: 'open', createdAt: NOW,
    replies: {
      [NOW + 3000]: { text: 'third', at: NOW + 3000, from: 'admin', by: 'help@pollslide.com' },
      ['u' + (NOW + 5000)]: { text: 'fourth', at: NOW + 5000, from: 'user' },
      [NOW + 1000]: { text: 'second', at: NOW + 1000, by: 'help@pollslide.com' },   // legacy: no `from`
    },
  };
  const th = T.thread(t);
  ok('the original message comes first', th[0].original && th[0].text === t.message);
  ok('replies follow in time order, not key order', th.map(e => e.text).join('|') === 'Je ne sais pas où entrer le code|second|third|fourth',
     th.map(e => e.text));
  ok('a legacy reply with no `from` is an admin reply', th[1].from === 'admin');
  ok('a user follow-up is marked as the user', th[3].from === 'user');
  ok('the user spoke last → needs a response', T.lastSpeaker(t) === 'user' && T.needsResponse(t));
  const c = T.replyCounts(t);
  ok('reply counts split by who wrote them', c.total === 3 && c.admin === 2 && c.user === 1, c);
  ok('a resolved ticket never "needs a response"', !T.needsResponse(Object.assign({}, t, { status: 'resolved' })));
  ok('a ticket with no status is open (the badge always counted it so)', T.isOpen({ subject: 'x' }));

  const legacy = { subject: 'old', message: 'hello', status: 'open', createdAt: NOW };
  ok('a ticket with no replies and none of the new fields still reads', T.thread(legacy).length === 1 && T.replyCounts(legacy).total === 0);
  ok('…and a brand-new ticket needs a response', T.needsResponse(legacy));
  ok('garbage does not throw', T.thread(null).length === 0 && T.replyCounts(undefined).total === 0 && T.threadHtml(null) === '');
  ok('email language falls back to en', T.emailLang({ lang: 'fr' }) === 'fr' && T.emailLang({ lang: 'xx' }) === 'en' && T.emailLang({}) === 'en');
}

/* ── 2. The admin render escapes and shows everything ─────────────────────── */
console.log('\nThe admin thread escapes what users typed, and shows every reply');
{
  const evil = '<img src=x onerror="alert(document.cookie)">';
  const t = {
    uid: 'u1', subject: '<script>alert(1)</script>', message: evil + '\nline two', status: 'open', createdAt: NOW,
    replies: {
      [NOW + 1]: { text: 'Try this</div><script>steal()</script>', at: NOW + 1, from: 'admin', by: 'x"><b>', emailedAt: NOW + 2, emailTo: 'a@b.fr', emailLang: 'fr' },
      [NOW + 3]: { text: 'second answer', at: NOW + 3, from: 'admin', emailError: '<svg onload=alert(2)>' },
      [NOW + 4]: { text: 'old one', at: NOW + 4, from: 'admin' },
      ['u' + (NOW + 5)]: { text: 'still broken', at: NOW + 5, from: 'user' },
      ['"><img src=x onerror=alert(3)>']: { text: 'weird key', at: NOW + 6, from: 'admin', emailError: 'boom' },
    },
  };
  const html = T.threadHtml(t, { fmt: () => 'WHEN' });
  ok('no raw <img from the message', !/<img/i.test(html));
  ok('no raw <script from a reply', !/<script/i.test(html));
  ok('no raw <svg from a stored email error', !/<svg/i.test(html));
  ok('the sender cannot break out of its tag', !html.includes('x"><b>') && html.includes('x&quot;&gt;&lt;b&gt;'));
  ok('the message is there, escaped', html.includes('&lt;img src=x onerror=&quot;alert(document.cookie)&quot;&gt;'));
  ok('line breaks are kept (pre-wrap), not collapsed', /white-space:pre-wrap/.test(html) && html.includes('\nline two'));
  ok('every entry is rendered: original + 5 replies', (html.match(/data-from="/g) || []).length === 6);
  ok('user follow-ups and admin replies are told apart', (html.match(/data-from="user"/g) || []).length === 2 &&
     (html.match(/data-from="admin"/g) || []).length === 4);
  ok('an emailed reply says so, with where it went', html.includes('✉ Emailed WHEN to a@b.fr'));
  ok('a FAILED email is shown, not hidden', html.includes('Email FAILED: &lt;svg onload=alert(2)&gt;'));
  ok('a failed email offers a retry', /data-retry-reply="\d+"/.test(html));
  ok('a reply from before email-on-reply says it was in-app only', html.includes('In-app only — not emailed'));
  ok('a hostile reply key cannot escape the retry button attribute', !html.includes('"><img') && html.includes('data-retry-reply="&quot;&gt;&lt;img'));
}

console.log('\nadmin.html uses that render, and escapes the rest');
{
  const src = strip(read('admin.html'));
  const a = src.indexOf('function watchOpenTickets'), b = src.indexOf('function renderComms');
  const section = src.slice(a, b > a ? b : a + 20000);
  ok('admin.html loads /tickets.js', /<script src="\/tickets\.js(\?v=[0-9a-f]+)?"><\/script>/.test(read('admin.html')));
  ok('openTicket renders the whole thread through PSTickets.threadHtml', /threadHtml\(t\)/.test(fnBody(src, 'openTicket')));
  // `${t.subject}` or `${t.subject||'…'}` reaches the markup; `${t.lang?esc(…):…}` only tests it.
  const RAW = /\$\{\s*t\.(message|subject|email|category|lang)\s*(\}|\|\|)/g;
  ok('no ticket field is interpolated raw', !RAW.test(section), section.match(RAW));
  ok('the sender address is escaped', /\$\{esc\(userEmail\)\}/.test(section) && /\$\{esc\(from\)\}/.test(section));
  ok('ticket ids never go inside an onclick string', !/onclick="[^"]*\$\{id\}/.test(section) && /data-ticket-id="\$\{esc\(id\)\}"/.test(section));
  ok('ticket rows show reply counts and a needs-reply flag', /replyCounts\(t\)/.test(section) && /needs reply/.test(section));
  ok('there is a language selector for the email, defaulting to the ticket', /id="ticketReplyLang"/.test(section) && /emailLang\(t\)/.test(section));
}

console.log('\nreplyTicket emails the user and tells the truth about it');
{
  const src = strip(read('admin.html'));
  const reply = fnBody(src, 'replyTicket'), send = fnBody(src, 'sendTicketReplyEmail');
  ok('replyTicket hands the reply to the email step', /sendTicketReplyEmail\(/.test(reply));
  ok('the email step POSTs to /api/send-email with type ticket_reply', /\/api\/send-email/.test(send) && /type:\s*'ticket_reply'/.test(send));
  ok('it sends the subject, the reply, the ticket id and the chosen language', /data:\s*\{[^}]*subject[^}]*reply:\s*text[^}]*ticketId[^}]*lang/.test(send));
  ok('the outcome is recorded on the reply (emailedAt or emailError)', /emailedAt/.test(send) && /emailError/.test(send) &&
     /replies\/\$\{replyKey\}/.test(send));
  ok('the toast reports success and failure differently', /Reply sent · user emailed/.test(reply) && /Reply saved, but the email failed/.test(reply));
  ok('the email is sent only AFTER the reply is saved', reply.indexOf('replies/${replyTs}') > -1 &&
     reply.indexOf('replies/${replyTs}') < reply.indexOf('sendTicketReplyEmail('));
  ok('the thread is re-rendered after sending', /openTicket\(ticketId\)/.test(reply.slice(reply.indexOf('sendTicketReplyEmail('))));
}

/* ── 3. The email ──────────────────────────────────────────────────────────── */
console.log('\nThe ticket_reply email');
{
  process.env.RESEND_API_KEY = 'test-resend';
  process.env.INTERNAL_API_KEY = 'test-internal-key-000';
  /* Stub the auth module so the handler's two browser paths can be driven without Firebase:
     the token decides who is calling. */
  const quotaPath = require.resolve('../../lib/quota');
  let caller = null;
  require.cache[quotaPath] = { id: quotaPath, filename: quotaPath, loaded: true, exports: {
    verifyToken: async () => caller, tokenFrom: (req) => (req.headers.authorization || '').replace('Bearer ', '') || null,
    getApp: () => null, configured: () => true, ADMIN_EMAILS: ['help@pollslide.com'],
  } };
  const mod = require('../../api/send-email');
  const { TEMPLATES, USER_TYPES, TICKET_REPLY_CHROME } = mod;

  ok('the template exists', typeof TEMPLATES.ticket_reply === 'function');
  ok('it is NOT a user-triggerable type', Array.isArray(USER_TYPES) && !USER_TYPES.includes('ticket_reply'), USER_TYPES);

  const out = TEMPLATES.ticket_reply({ subject: 'Mac <b>app</b>\r\nBcc: x@evil', reply: 'Line one\n<script>x()</script>\nLine & three', ticketId: 'ticket_123', lang: 'fr' });
  ok('reply_to is help@pollslide.com', out.replyTo === 'help@pollslide.com');
  ok('the reply is escaped', !/<script>x\(\)/.test(out.html) && out.html.includes('&lt;script&gt;x()&lt;/script&gt;'));
  ok('the reply keeps its line breaks', out.html.includes('Line one<br>&lt;script&gt;') && out.html.includes('<br>Line &amp; three'));
  ok('the subject is escaped in the body', out.html.includes('Mac &lt;b&gt;app&lt;/b&gt;'));
  ok('the subject header cannot carry a line break', !/[\r\n]/.test(out.subject), out.subject);
  ok('the CTA opens that ticket in PollSlide', out.html.includes('href="https://app.pollslide.com/presenter?support=ticket_123"'));
  ok('the chrome is French for a French ticket, in tu', out.subject.startsWith('L’assistance PollSlide t’a répondu') &&
     out.html.includes('Nous avons répondu à ta demande') && out.html.includes('lang="fr"'));
  ok('a hostile ticket id cannot break the link', !TEMPLATES.ticket_reply({ ticketId: '"><script>', reply: 'x' }).html.includes('"><script>'));
  const en = TEMPLATES.ticket_reply({ subject: 's', reply: 'r', ticketId: 'ticket_1', lang: 'klingon' });
  ok('an unknown language falls back to English', en.subject === 'PollSlide Support replied: s' && en.html.includes('lang="en"'));
  ok('the reply text itself is never translated', TEMPLATES.ticket_reply({ reply: 'Hello there', lang: 'de', ticketId: 'ticket_1' }).html.includes('Hello there'));
  const langs = ['en', 'es', 'de', 'fr', 'pt', 'it'];
  ok('chrome exists in all six languages with every part', langs.every(l => TICKET_REPLY_CHROME[l] &&
     ['heading', 'request', 'button', 'note'].every(k => typeof TICKET_REPLY_CHROME[l][k] === 'string' && TICKET_REPLY_CHROME[l][k]) &&
     typeof TICKET_REPLY_CHROME[l].subject === 'function'));
  const chromeText = (l) => { const c = TICKET_REPLY_CHROME[l]; return [c.subject('x'), c.heading, c.request, c.button, c.note].join(' | '); };
  ok('French chrome says tu, never vous', !/\b(vous|votre|vos)\b/i.test(chromeText('fr')), chromeText('fr'));
  ok('German chrome says du, never a Sie imperative', !/\b[A-ZÄÖÜ][a-zäöüß]+en\s+Sie\b/.test(chromeText('de')) && /\bdu\b|deine/.test(chromeText('de')));
  ok('Portuguese chrome is European', !/\b(você|tela|arquivo|usuário|celular|compartilh)/i.test(chromeText('pt')));
  ok('the brand survives in every language', langs.every(l => /PollSlide/.test(chromeText(l))));

  // Drive the real handler with fetch captured.
  const sent = [];
  global.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ id: 'em_1' }) }; };
  const call = async (headers, body) => {
    const res = { code: 0, payload: null, setHeader() {}, status(c) { this.code = c; return this; }, json(p) { this.payload = p; return this; }, end() { return this; } };
    await mod({ method: 'POST', headers, body }, res);
    return res;
  };
  (async () => {
    const payload = { type: 'ticket_reply', to: 'victim@example.com', data: { subject: 'x', reply: 'y', ticketId: 'ticket_1', lang: 'es' } };
    caller = { uid: 'u2', email: 'someone@example.com' };
    let r = await call({ authorization: 'Bearer user-token' }, payload);
    ok('a signed-in NON-admin is refused ticket_reply (403) and nothing is sent', r.code === 403 && sent.length === 0, [r.code, r.payload]);
    caller = { uid: 'admin', email: 'help@pollslide.com' };
    r = await call({ authorization: 'Bearer admin-token' }, payload);
    ok('the admin may send it', r.code === 200 && sent.length === 1, [r.code, r.payload]);
    ok('Resend is asked for reply_to: help@pollslide.com', sent[0] && sent[0].body.reply_to === 'help@pollslide.com', sent[0] && sent[0].body);
    ok('…to the address the admin chose', sent[0] && JSON.stringify(sent[0].body.to) === '["victim@example.com"]');
    sent.length = 0;
    r = await call({ 'x-internal-key': 'test-internal-key-000' }, { type: 'welcome', to: 'a@b.c', data: {} });
    ok('templates without a reply_to still send without one', r.code === 200 && sent[0] && !('reply_to' in sent[0].body));
    rest();
  })().catch(e => { ok('email handler ran', false, e.message); rest(); });
}

function rest() {
/* ── 4. The rules, evaluated ───────────────────────────────────────────────── */
console.log('\ndatabase-rules.json — who may write a ticket (evaluated, not grepped)');
{
  const rules = JSON.parse(read('database-rules.json'));
  /* A small evaluator for the subset of the RTDB rule language these paths use. Semantics
     that matter and are modelled: a write is allowed if ANY `.write` on the path from the
     root down to the written location is true (rules cascade and cannot be revoked below);
     deeper `.write` rules are not consulted; each location of a multi-path update is
     checked on its own against the post-update tree; an expression that throws is false.
     `.validate` is not modelled — asserted below that nothing under admin/tickets has one. */
  if (!String.prototype.matches) {
    Object.defineProperty(String.prototype, 'matches', { value: function (re) { return re.test(String(this)); }, configurable: true });
  }
  const get = (tree, parts) => parts.reduce((n, k) => (n && typeof n === 'object' && Object.prototype.hasOwnProperty.call(n, k)) ? n[k] : null, tree);
  const snap = (tree, parts) => ({
    val() { const v = get(tree, parts); return v === undefined ? null : v; },
    exists() { const v = get(tree, parts); return v != null && !(typeof v === 'object' && !Object.keys(v).length); },
    child(p) { return snap(tree, parts.concat(String(p).split('/').filter(Boolean))); },
    parent() { return snap(tree, parts.slice(0, -1)); },
    isNumber() { return typeof get(tree, parts) === 'number'; },
    isString() { return typeof get(tree, parts) === 'string'; },
    hasChild(p) { return this.child(p).exists(); },
    hasChildren(a) { return a.every(k => this.child(k).exists()); },
  });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const setAt = (tree, parts, value) => {
    let n = tree;
    for (let i = 0; i < parts.length - 1; i++) { if (!n[parts[i]] || typeof n[parts[i]] !== 'object') n[parts[i]] = {}; n = n[parts[i]]; }
    if (value === null) delete n[parts[parts.length - 1]]; else n[parts[parts.length - 1]] = clone(value);
  };
  const evalRule = (expr, ctx) => {
    if (typeof expr === 'boolean') return expr;
    const names = Object.keys(ctx.vars);
    try {
      return new Function('auth', 'data', 'newData', 'root', 'now', ...names, 'return (' + expr + ');')(
        ctx.auth, ctx.data, ctx.newData, ctx.root, NOW, ...names.map(n => ctx.vars[n])) === true;
    } catch (e) { return false; }
  };
  function allowed(before, after, pth, auth) {
    const parts = pth.split('/').filter(Boolean);
    let node = rules.rules; const vars = {};
    const check = (n, depth) => n['.write'] !== undefined && evalRule(n['.write'], {
      auth, vars, data: snap(before, parts.slice(0, depth)), newData: snap(after, parts.slice(0, depth)), root: snap(before, []) });
    if (check(node, 0)) return true;
    for (let i = 0; i < parts.length; i++) {
      const key = Object.prototype.hasOwnProperty.call(node, parts[i]) ? parts[i] : Object.keys(node).find(k => k.startsWith('$'));
      if (!key) return false;
      if (key.startsWith('$')) vars[key] = parts[i];
      node = node[key];
      if (check(node, i + 1)) return true;
    }
    return false;
  }
  // A Firebase update(): every location must be allowed, against the tree after all of them.
  function update(db, map, auth) {
    const after = clone(db);
    Object.entries(map).forEach(([p, v]) => setAt(after, p.split('/').filter(Boolean), v));
    return Object.keys(map).every(p => allowed(db, after, p, auth));
  }
  const set = (db, p, v, auth) => update(db, { [p]: v }, auth);

  const A = { uid: 'alice', token: { email: 'alice@example.com' } };
  const B = { uid: 'bob', token: { email: 'bob@example.com' } };
  const ADMIN = { uid: 'owner', token: { email: 'help@pollslide.com' } };
  const ticket = (uid, email, extra) => Object.assign({ uid, email, subject: 's', message: 'm', category: 'general', status: 'open', createdAt: NOW, lang: 'fr' }, extra || {});
  const db = { admin: { tickets: {
    ticket_1: ticket('alice', 'alice@example.com', { replies: { [NOW + 1]: { text: 'hi', at: NOW + 1, from: 'admin' } } }),
    ticket_2: ticket('bob', 'bob@example.com'),
    ticket_3: ticket('alice', 'alice@example.com', { status: 'resolved' }),
  } }, users: { alice: { tickets: { ticket_1: ticket('alice', 'alice@example.com') } } } };

  (function noValidate(n, at) {
    for (const [k, v] of Object.entries(n || {})) {
      if (k === '.validate') ok('no .validate under admin/tickets (the evaluator does not model it)', false, at);
      else if (v && typeof v === 'object') noValidate(v, at + '/' + k);
    }
  })(rules.rules.admin.tickets, 'admin/tickets');

  // Submission — what presenter.html submitChatTicket writes.
  const fresh = { uid: 'alice', email: 'alice@example.com', subject: 'Mac', message: 'where does the code go', category: 'general', status: 'open', createdAt: NOW, lang: 'fr' };
  ok('a user can create their own ticket', set(db, 'admin/tickets/ticket_9', fresh, A));
  ok('…and their own copy under users/<uid>/tickets', set(db, 'users/alice/tickets/ticket_9', fresh, A));
  ok('a user with no email on the account can still file', set(db, 'admin/tickets/ticket_9', Object.assign({}, fresh, { email: '' }), A));
  ok('signed-out cannot create a ticket', !set(db, 'admin/tickets/ticket_9', fresh, null));
  ok('cannot create a ticket in someone else\'s name (uid)', !set(db, 'admin/tickets/ticket_9', Object.assign({}, fresh, { uid: 'bob' }), A));
  ok('cannot create a ticket with someone else\'s email (the reply email would go there)', !set(db, 'admin/tickets/ticket_9', Object.assign({}, fresh, { email: 'bob@example.com' }), A));
  ok('cannot create a ticket pre-filled with an "admin" reply', !set(db, 'admin/tickets/ticket_9', Object.assign({}, fresh, { replies: { 1: { text: 'refund approved', from: 'admin' } } }), A));
  ok('cannot create a ticket already resolved', !set(db, 'admin/tickets/ticket_9', Object.assign({}, fresh, { status: 'resolved' }), A));
  ok('cannot create one marked replied', !set(db, 'admin/tickets/ticket_9', Object.assign({}, fresh, { replied: true }), A));
  ok('cannot create a ticket under a key that is not ticket_<ms> (ids reach markup and URLs)',
     !set(db, "admin/tickets/x');alert(1)//", fresh, A) && !set(db, 'admin/tickets/ticket_1a', fresh, A));
  ok('cannot overwrite an existing ticket, even their own', !set(db, 'admin/tickets/ticket_1', fresh, A));
  ok('cannot delete their own ticket', !set(db, 'admin/tickets/ticket_1', null, A));
  ok('cannot overwrite someone else\'s ticket', !set(db, 'admin/tickets/ticket_2', fresh, A));

  // Follow-ups — exactly the maps presenter.html sends, from tickets.js.
  const mine = T.followUpWrites('alice', 'ticket_1', 'still not working', NOW + 50);
  ok('a user can append a follow-up to their own ticket (both copies)', update(db, mine.user, A) && update(db, mine.admin, A));
  const reopen = T.followUpWrites('alice', 'ticket_3', 'it broke again', NOW + 60);
  ok('a follow-up re-opens their own RESOLVED ticket', update(db, reopen.admin, A));
  const theirs = T.followUpWrites('alice', 'ticket_2', 'hijack', NOW + 70);
  ok('cannot append a reply to someone else\'s ticket', !update(db, theirs.admin, A));
  ok('cannot append a follow-up to a ticket whose mirror never landed', !update(db, T.followUpWrites('alice', 'ticket_404', 'x', NOW).admin, A));
  ok('cannot write a reply from:"admin"', !set(db, 'admin/tickets/ticket_1/replies/' + (NOW + 80), { text: 'refund approved', at: NOW, from: 'admin' }, A));
  ok('cannot write a reply with no from', !set(db, 'admin/tickets/ticket_1/replies/' + (NOW + 81), { text: 'x', at: NOW }, A));
  ok('cannot pass off a user reply as signed by the admin (by)', !set(db, 'admin/tickets/ticket_1/replies/' + (NOW + 82), { text: 'x', at: NOW, from: 'user', by: 'help@pollslide.com' }, A));
  ok('cannot fake an "emailed" marker', !set(db, 'admin/tickets/ticket_1/replies/' + (NOW + 83), { text: 'x', at: NOW, from: 'user', emailedAt: NOW }, A));
  ok('cannot overwrite an existing (admin) reply', !set(db, 'admin/tickets/ticket_1/replies/' + (NOW + 1), { text: 'edited', at: NOW, from: 'user' }, A));
  ok('cannot post an empty reply', !set(db, 'admin/tickets/ticket_1/replies/u1', { text: '', at: NOW, from: 'user' }, A));
  ok('cannot post a reply over 5000 characters', !set(db, 'admin/tickets/ticket_1/replies/u2', { text: 'x'.repeat(5001), at: NOW, from: 'user' }, A));
  ok('cannot mark their ticket resolved', !set(db, 'admin/tickets/ticket_1/status', 'resolved', A));
  ok('cannot set status on someone else\'s ticket, even "open"', !set(db, 'admin/tickets/ticket_2/status', 'open', A));
  ok('cannot mark it awaiting the USER (only the admin says that)', !set(db, 'admin/tickets/ticket_1/awaiting', 'user', A));
  ok('cannot flip replied', !set(db, 'admin/tickets/ticket_1/replied', true, A));
  ok('cannot rewrite the uid or email of their ticket', !set(db, 'admin/tickets/ticket_1/uid', 'bob', A) && !set(db, 'admin/tickets/ticket_1/email', 'x@y.z', A));
  ok('cannot rewrite the original message', !set(db, 'admin/tickets/ticket_1/message', 'changed', A));
  ok('cannot write another user\'s ticket copy', !set(db, 'users/alice/tickets/ticket_1/replies/u9', { text: 'x', from: 'user' }, B));

  // The admin keeps full write — replies, status, email outcome, delete.
  ok('the admin can reply', set(db, 'admin/tickets/ticket_2/replies/' + (NOW + 90), { text: 'ok', at: NOW, from: 'admin', by: 'help@pollslide.com' }, ADMIN));
  ok('the admin can resolve and record the email outcome', update(db, { 'admin/tickets/ticket_2/status': 'resolved', 'admin/tickets/ticket_1/replies/1/emailedAt': NOW }, ADMIN));
  ok('the admin can delete a ticket', set(db, 'admin/tickets/ticket_2', null, ADMIN));
  ok('the admin can write the user\'s copy (reply mirror)', set(db, 'users/alice/tickets/ticket_1/replies/' + (NOW + 91), { text: 'ok', from: 'admin' }, ADMIN));
  ok('lastUserReplyAt is indexed for the watchdog query', (rules.rules.admin.tickets['.indexOn'] || []).includes('lastUserReplyAt'));
}

/* ── 5. The watchdog pages on follow-ups ──────────────────────────────────── */
console.log('\nA user follow-up reaches the owner like a new ticket does');
{
  const since = NOW;
  const tickets = {
    old_followup: { subject: 'a', email: 'a@x', createdAt: NOW - 9e6, lastUserReplyAt: NOW + 10, replies: { 1: { text: 'q', at: NOW - 5e6, from: 'admin' }, u2: { text: 'still broken', at: NOW + 10, from: 'user' } } },
    answered_since: { subject: 'b', createdAt: NOW - 9e6, lastUserReplyAt: NOW + 10, replies: { u1: { text: 'x', at: NOW + 10, from: 'user' }, 2: { text: 'fixed', at: NOW + 20, from: 'admin' } } },
    brand_new: { subject: 'c', createdAt: NOW + 5, lastUserReplyAt: NOW + 8, replies: { u1: { text: 'more', at: NOW + 8, from: 'user' } } },
    before_last_run: { subject: 'd', createdAt: NOW - 9e6, lastUserReplyAt: NOW - 1, replies: { u1: { text: 'old', at: NOW - 1, from: 'user' } } },
  };
  const f = T.followUpsSince(tickets, since);
  ok('a follow-up since the last run is picked up', f.length === 1 && f[0].id === 'old_followup' && f[0].text === 'still broken', f);
  ok('one the admin already answered is not', !f.some(x => x.id === 'answered_since'));
  ok('a ticket created in the same window is left to the new-ticket email', !f.some(x => x.id === 'brand_new'));
  ok('a follow-up already paged on the previous run is not paged again', !f.some(x => x.id === 'before_last_run'));
  const wd = strip(read('api/watchdog.js'));
  const nf = fnBody(wd, 'notifyFollowUps');
  ok('api/watchdog.js queries admin/tickets by lastUserReplyAt and filters with followUpsSince',
     /orderByChild\('lastUserReplyAt'\)/.test(nf) && /followUpsSince\(/.test(nf));
  ok('it runs on every watchdog pass, after new tickets', /notifyFollowUps\(db,/.test(fnBody(wd, 'runAll')));
  ok('what users typed is escaped in the alert', /esc\(f\.subject/.test(nf) && /esc\(String\(f\.text/.test(nf));
}

/* ── 6. The user side ─────────────────────────────────────────────────────── */
console.log('\npresenter.html — follow-ups, ?support=, and where the Mac code goes');
{
  const raw = read('presenter.html');
  const src = strip(raw);
  ok('presenter.html loads /tickets.js', /<script src="\/tickets\.js(\?v=[0-9a-f]+)?"><\/script>/.test(raw));
  ok('a new ticket records the interface language', /lang:\s*UI_LANG/.test(fnBody(src, 'submitChatTicket')));
  const fu = fnBody(src, 'sendChatFollowUp');
  ok('a follow-up is built by PSTickets.followUpWrites', /PSTickets\.followUpWrites\(userId,\s*ticketId/.test(fu));
  ok('the user copy is written before the admin mirror', fu.indexOf('w.user') > -1 && fu.indexOf('w.user') < fu.indexOf('w.admin'));
  ok('a refused mirror is not reported as sent — it hands off to email', /mailto:help@pollslide\.com/.test(fu) && /if \(mirrored\)/.test(fu));
  ok('the thread view has a reply box wired to it', /data-action="send-reply"/.test(raw) && /send-reply"\]'\)\.onclick = sendChatFollowUp/.test(src));
  ok('the user thread renders follow-ups on their side, escaped', /PSTickets\.thread\(t\)/.test(fnBody(src, 'loadChatThread')) &&
     /escapeHtml\(txt\)/.test(fnBody(src, 'loadChatThread')));
  ok('?support= is read at load and held for after sign-in', /params\.get\('support'\)/.test(src) && /ps_open_support/.test(src));
  ok('…and opens that thread, only for a valid ticket id', /validTicketId\(supportId\)/.test(src) && /openSupportThread\(supportId\)/.test(src));

  const modal = fnBody(src, 'showPairingCodeModal');
  const trKeys = [...modal.matchAll(/\bt\('((?:[^'\\]|\\.)*)'\)/g)].map(m => m[1].replace(/\\'/g, "'"));
  const fuKeys = [...fu.matchAll(/\btr\('((?:[^'\\]|\\.)*)'\)/g)].map(m => m[1].replace(/\\'/g, "'"));
  // "Disconnect Account (Re-pair)" replaced "Show / Hide Poll Window" a second time,
  // 2026-09-15 — see the comment above showPairingCodeModal. It forces the pairing
  // screen unconditionally; the other only shows whatever the window already contains.
  ok('the modal says where the code goes on the Mac', trKeys.some(k => k.includes('"Connect to PollSlide"')) &&
     trKeys.some(k => k.includes('"Disconnect Account (Re-pair)"')) && trKeys.some(k => k.includes('"Enter code"') && k.includes('"Connect"')));
  // Phrasing-independent: checks the two concepts are both named, not their word order —
  // the order changed on 2026-09-15 when "opens on its own" (untrue; see PollSlideCompanionApp.swift)
  // was corrected to say nothing shows the window but the menu-bar item.
  ok('…names the bar-chart icon in the menu bar', trKeys.some(k => /bar-chart icon/.test(k) && /menu bar/.test(k)));
  ok('…and does NOT claim the window opens on its own — it doesn\'t (see applicationDidFinishLaunching)',
     !trKeys.some(k => /window opens\b/.test(k) && !/nothing opens|doesn.t open/i.test(k)));
  ok('…and still says the code expires in 10 minutes', trKeys.includes('Expires in 10 minutes · single use'));

  const win = {};
  new Function('window', read('ui-lang.js'))(win);
  const D = win.PS_UI, LANGS = ['es', 'de', 'fr', 'pt', 'it'];
  const tagged = ['Send reply', 'Replying reopens this request.', 'Reply to this request…'];
  const need = [...new Set([...trKeys, ...fuKeys, ...tagged, 'You', 'PollSlide Support', '✓ Copied to clipboard', 'Press Cmd+C to copy'])];
  const missing = need.filter(k => LANGS.some(l => !(D[l] && D[l][k])));
  ok(`every new string (${need.length}) is translated in es/de/fr/pt/it`, missing.length === 0, missing);
  const LABELS = ['Connect to PollSlide', 'Show / Hide Poll Window', 'Enter code', 'Connect'];
  const lost = [];
  need.forEach(k => LABELS.forEach(lbl => {
    if (!k.includes('"' + lbl + '"')) return;
    LANGS.forEach(l => { if (D[l][k] && !new RegExp('[«„“" ]\\s?' + lbl.replace(/[/]/g, '\\/') + '\\s?[»“”" ]').test(D[l][k])) lost.push(l + ': ' + lbl); });
  }));
  ok('Mac-app labels stay in English, quoted, inside every translation', lost.length === 0, lost);
  ok('"Connect Mac App" uses the web app\'s existing translation', LANGS.every(l => D[l]['Connect Mac App']) && trKeys.includes('Connect Mac App'));
}

console.log('\nNothing tells anyone to click a "Connect Account" menu item — there is none');
{
  const offenders = ['presenter.html', 'companion.html', 'ui-lang.js', 'admin.html', 'api/send-email.js']
    .filter(f => /Connect Account(?! \(Re-pair\))/.test(strip(read(f)).replace(/Disconnect Account/g, '')));
  ok('no "Connect Account" anywhere in the app', offenders.length === 0, offenders);
  ok('companion.html names the real re-pair route', /Disconnect Account \(Re-pair\)/.test(read('companion.html')));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
}
