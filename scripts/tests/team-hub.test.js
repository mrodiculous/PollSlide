#!/usr/bin/env node
/* Team hub — shared library, usage analytics, bulk member tools (2026-10-10).
 * Runs the REAL lib/team-hub.js against an in-memory database, the way production and the
 * stage server run it. Every check is a promise the pricing page makes to a paying team.
 * Run: node scripts/tests/team-hub.test.js */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const H = require(path.join(ROOT, 'lib', 'team-hub.js'));
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));

/* A tiny database with the Admin SDK's shape. */
function memDb(seed) {
  const TREE = JSON.parse(JSON.stringify(seed || {}));
  const split = p => String(p).split('/').filter(Boolean);
  const read = p => split(p).reduce((o, k) => (o && typeof o === 'object') ? o[k] : undefined, TREE);
  const write = (p, v) => { const ks = split(p); let o = TREE; for (let i = 0; i < ks.length - 1; i++) { if (!o[ks[i]] || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const snap = v => ({ exists: () => v !== undefined && v !== null, val: () => v === undefined ? null : JSON.parse(JSON.stringify(v)) });
  const ref = p => ({ get: async () => snap(read(p)), set: async v => write(p, v), remove: async () => write(p, null),
    update: async o => { Object.keys(o).forEach(k => write(p + '/' + k, o[k])); } });
  return { ref, TREE, read };
}
const NOW = Date.UTC(2026, 9, 10, 12);
const DAY = 86400000;
function world(tier) {
  const mail = [];
  const db = memDb({
    workspaces: { ws1: { name: 'Acme Team', ownerUid: 'own', tier: tier || 'team_large',
      members: { own: { email: 'owner@acme.com', role: 'owner' }, adm: { email: 'admin@acme.com', role: 'admin' }, mem: { email: 'mem@acme.com', role: 'member' }, mem2: { email: 'mem2@acme.com', role: 'member' } },
      invites: { 'old_acme_com': { email: 'old@acme.com', role: 'member', invitedBy: 'owner@acme.com', createdAt: NOW - 9 * DAY } } } },
    users: {
      own: { tier: 'team_large', lastSeen: NOW - DAY, aiQuotaMonth: '2026-10', aiUsedThisMonth: 7, presentations: {
        p1: { name: 'Onboarding quiz', productType: 'quiz', sessionCode: 'AAA111', lastOpenedAt: NOW, language: 'en',
              questions: [{ id: 'q1', text: 'What is our refund window?', type: 'multiple_choice', options: [{ text: '14 days' }, { text: '30 days' }], correctAnswer: 0 },
                          { id: 'q2', text: 'Who approves expenses?', type: 'multiple_choice', options: [{ text: 'Your manager' }, { text: 'Finance' }], correctAnswer: 0 }] },
        p2: { name: 'Empty deck', productType: 'poll', sessionCode: 'BBB222', questions: [] } } },
      mem: { tier: 'team_large', lastSeen: NOW - 40 * DAY, presentations: { m1: { name: 'Weekly pulse', productType: 'poll', sessionCode: 'CCC333', questions: [{ id: 'a', text: 'How was your week?', type: 'rating' }] } } },
      mem2: { tier: 'free', presentations: { a: { name: 'A', questions: [{ text: 'x' }] }, b: { name: 'B', questions: [{ text: 'x' }] }, c: { name: 'C', questions: [{ text: 'x' }] } } },
      adm: { tier: 'team_large' }, out: { tier: 'pro' },
    },
    sessions: {
      AAA111: { responses: { q1_stable_AAA111: { p1: { answer: '0', name: 'Ana Private', submittedAt: NOW - 2 * DAY }, p2: { answer: '1', submittedAt: NOW - 2 * DAY } },
                             q2_stable_AAA111: { p1: { answer: '0', submittedAt: NOW - DAY } } } },
      CCC333: { responses: { a: { z1: { answer: '5', submittedAt: NOW - 50 * DAY } } } },
    },
  });
  const detached = [];
  const ctxFor = (uid, email, extra) => Object.assign({ callerUid: uid, callerEmail: email, isSiteAdmin: false, now: () => NOW,
    mail: async (type, to, data) => { mail.push({ type, to, data }); },
    detachMember: async (wsId, mUid) => { detached.push(mUid); await db.ref('workspaces/' + wsId + '/members/' + mUid).remove(); } }, extra || {});
  return { db, mail, detached, owner: ctxFor('own', 'owner@acme.com'), admin: ctxFor('adm', 'admin@acme.com'), member: ctxFor('mem', 'mem@acme.com'),
           member2: ctxFor('mem2', 'mem2@acme.com'), outsider: ctxFor('out', 'out@else.com'), site: ctxFor('sa', 'help@pollslide.com', { isSiteAdmin: true }) };
}

(async () => {
  console.log('\nPasted lists');
  const pe = H.parseEmails('Ann Lee <Ann@X.com>, bob@y.org; bad@\nann@x.com mailto:cara@z.io "Dee" (dee@w.co)');
  ok('reads commas, semicolons, new lines, "Name <email>" and mailto:', JSON.stringify(pe.valid) === JSON.stringify(['ann@x.com', 'bob@y.org', 'cara@z.io', 'dee@w.co']), pe.valid);
  ok('duplicates collapse, names are ignored, a broken address is reported', pe.invalid.length === 1 && pe.invalid[0] === 'bad@');
  ok('a paste is capped at 200 addresses, and says so', H.parseEmails(Array.from({ length: 260 }, (_, i) => 'u' + i + '@x.com').join(',')).valid.length === 200 && H.parseEmails(Array.from({ length: 260 }, (_, i) => 'u' + i + '@x.com').join(',')).truncated === true);

  console.log('\nBulk invite');
  let w = world('team_large');
  let r = await H.handle(w.db, w.owner, { action: 'inviteMany', wsId: 'ws1', text: 'new1@acme.com, mem@acme.com, old@acme.com, nope@, new2@acme.com', preview: true });
  ok('preview says what will happen to each address and writes nothing', r.status === 200 && r.body.preview && r.body.plan.map(p => p.result).join() === 'invite,member,invited,invite' && r.body.invalid[0] === 'nope@' && !w.db.read('workspaces/ws1/invites/new1_acme_com') && w.mail.length === 0, r.body);
  r = await H.handle(w.db, w.owner, { action: 'inviteMany', wsId: 'ws1', text: 'new1@acme.com, mem@acme.com, new2@acme.com', role: 'admin' });
  ok('sending invites exactly the new ones, with the chosen role', r.body.sent === 2 && w.mail.filter(m => m.type === 'team_invite').length === 2 && w.db.read('workspaces/ws1/invites/new1_acme_com').role === 'admin');
  const inv = w.db.read('workspaces/ws1/invites/new1_acme_com'), idx = w.db.read('team_invites/new1_acme_com');
  ok('it writes the SAME two records the one-at-a-time invite writes', inv.email === 'new1@acme.com' && inv.invitedBy === 'owner@acme.com' && idx.wsId === 'ws1' && idx.wsName === 'Acme Team' && idx.role === 'admin');
  w = world('team_small');   // 5 seats: 4 members + 1 pending = full
  r = await H.handle(w.db, w.site, { action: 'inviteMany', wsId: 'ws1', text: 'a@x.com b@x.com' });
  ok('never goes past the seat limit', r.body.sent === 0 && r.body.results.every(x => x.result === 'no_seat'), r.body.results);
  r = await H.handle(w.db, w.owner, { action: 'inviteMany', wsId: 'ws1', text: 'a@x.com' });
  ok('Team Small is told bulk tools are part of Team Large (as the pricing page says)', r.status === 402 && r.body.upgrade === 'team_large');
  w = world('team_large');
  r = await H.handle(w.db, w.member, { action: 'inviteMany', wsId: 'ws1', text: 'a@x.com' });
  ok('a plain member cannot bulk-invite', r.status === 403);
  r = await H.handle(w.db, w.outsider, { action: 'inviteMany', wsId: 'ws1', text: 'a@x.com' });
  ok('someone outside the team cannot touch it at all', r.status === 403);

  console.log('\nBulk remove / revoke / resend');
  w = world('team_large');
  r = await H.handle(w.db, w.admin, { action: 'removeMany', wsId: 'ws1', uids: ['mem', 'own', 'adm', 'ghost'] });
  const rr = Object.fromEntries(r.body.results.map(x => [x.uid, x.result]));
  ok('removes members; never the owner, never yourself, and reports each', rr.mem === 'removed' && rr.own === 'owner' && rr.adm === 'self' && rr.ghost === 'not_member' && w.detached.join() === 'mem', rr);
  w = world('team_large'); w.db.TREE.workspaces.ws1.members.adm2 = { email: 'a2@acme.com', role: 'admin' };
  r = await H.handle(w.db, w.admin, { action: 'removeMany', wsId: 'ws1', uids: ['adm2'] });
  ok('an admin cannot remove another admin — only the owner can', r.body.results[0].result === 'admin_needs_owner' && w.detached.length === 0);
  r = await H.handle(w.db, w.owner, { action: 'removeMany', wsId: 'ws1', uids: ['adm2'] });
  ok('…and the owner can', r.body.removed === 1);
  r = await H.handle(w.db, w.owner, { action: 'resendAll', wsId: 'ws1' });
  ok('resend-all emails every pending invite', r.body.resent === 1 && w.mail.some(m => m.to === 'old@acme.com'));
  r = await H.handle(w.db, w.owner, { action: 'resendAll', wsId: 'ws1' });
  ok('…but not again within the hour (a button is not a mail cannon)', r.body.resent === 0);
  r = await H.handle(w.db, w.owner, { action: 'revokeMany', wsId: 'ws1', emailKeys: ['old_acme_com', 'nobody'] });
  ok('bulk revoke clears the invite and its lookup entry', r.body.revoked === 1 && !w.db.read('workspaces/ws1/invites/old_acme_com') && !w.db.read('team_invites/old_acme_com'));

  console.log('\nShared library');
  w = world('team_small');   // the library is for every team, Small included
  r = await H.handle(w.db, w.owner, { action: 'libAdd', wsId: 'ws1', presId: 'p1' });
  const deckId = r.body.item && r.body.item.id;
  ok('any member can add one of their own decks', r.status === 200 && r.body.item.kind === 'deck' && r.body.item.questionCount === 2 && r.body.item.preview[0] === 'What is our refund window?');
  const stored = w.db.read('team_library/ws1/' + deckId);
  ok('the stored item carries NO email address — only who added it by id', !/acme\.com/.test(JSON.stringify(stored)) && stored.addedByUid === 'own');
  r = await H.handle(w.db, w.owner, { action: 'libAdd', wsId: 'ws1', presId: 'p1', kind: 'question', qIndex: 1 });
  const qId = r.body.item.id;
  ok('…or a single question from it', r.body.item.kind === 'question' && r.body.item.title === 'Who approves expenses?' && r.body.item.preview.join('|') === 'Your manager|Finance');
  r = await H.handle(w.db, w.owner, { action: 'libAdd', wsId: 'ws1', presId: 'p2' });
  ok('an empty deck is refused', r.status === 400);
  r = await H.handle(w.db, w.member, { action: 'libAdd', wsId: 'ws1', presId: 'p1' });
  ok('you can only add YOUR OWN decks (someone else\'s id finds nothing)', r.status === 404);
  r = await H.handle(w.db, w.member, { action: 'libList', wsId: 'ws1' });
  ok('every member sees the list, with the adder\'s name looked up live', r.body.items.length === 2 && r.body.items.every(i => i.by === 'owner@acme.com') && r.body.items.every(i => i.payload === undefined));
  r = await H.handle(w.db, w.outsider, { action: 'libList', wsId: 'ws1' });
  ok('nobody outside the team can read it', r.status === 403);
  r = await H.handle(w.db, w.member, { action: 'libGet', wsId: 'ws1', itemId: deckId });
  ok('a member can look inside before using it', r.body.questions.length === 2 && r.body.questions[0].options.length === 2);
  r = await H.handle(w.db, w.member, { action: 'libUse', wsId: 'ws1', itemId: deckId });
  const copy = w.db.read('users/mem/presentations/' + r.body.presId);
  ok('using a deck makes an independent copy in MY account', r.body.kind === 'deck' && copy && copy.name === 'Onboarding quiz' && copy.questions.length === 2);
  ok('…with its own session code (never the original\'s room, results or QR)', /^[A-Z2-9]{6}$/.test(copy.sessionCode) && copy.sessionCode !== 'AAA111');
  ok('…and the original deck is untouched', w.db.read('users/own/presentations/p1/sessionCode') === 'AAA111' && w.db.read('users/own/presentations/p1/questions').length === 2);
  ok('use counts go up', w.db.read('team_library/ws1/' + deckId + '/uses') === 1);
  r = await H.handle(w.db, w.member2, { action: 'libUse', wsId: 'ws1', itemId: deckId });
  ok('a member\'s own plan limit still applies (Free holds 3 decks)', r.status === 402 && r.body.limitReached === true, r.body);
  r = await H.handle(w.db, w.member, { action: 'libUse', wsId: 'ws1', itemId: qId });
  ok('using a question hands it back for the open deck, writing nothing to my decks', r.body.kind === 'question' && r.body.question.text === 'Who approves expenses?' && Object.keys(w.db.read('users/mem/presentations')).length === 2);
  // The database can return a list as an object; the library must hand back real lists.
  w.db.TREE.users.own.presentations.p3 = { name: 'Objecty', productType: 'quiz', sessionCode: 'OBJ999',
    questions: { 0: { text: 'Pick one', type: 'multiple_choice', options: { 0: { text: 'A' }, 1: { text: 'B' } }, correctAnswer: 1 } } };
  r = await H.handle(w.db, w.owner, { action: 'libAdd', wsId: 'ws1', presId: 'p3', kind: 'question', qIndex: 0 });
  const got = await H.handle(w.db, w.member, { action: 'libUse', wsId: 'ws1', itemId: r.body.item.id });
  ok('options stored as an object come back out as a real list', Array.isArray(got.body.question.options) && got.body.question.options.length === 2 && r.body.item.preview.join('|') === 'A|B', got.body.question);
  r = await H.handle(w.db, w.owner, { action: 'libAdd', wsId: 'ws1', presId: 'p3' });
  const gotDeck = await H.handle(w.db, w.member, { action: 'libGet', wsId: 'ws1', itemId: r.body.item.id });
  ok('…in a whole deck too', Array.isArray(gotDeck.body.questions) && Array.isArray(gotDeck.body.questions[0].options));
  await H.handle(w.db, w.owner, { action: 'libRemove', wsId: 'ws1', itemId: r.body.item.id });
  for (const it of (await H.handle(w.db, w.owner, { action: 'libList', wsId: 'ws1' })).body.items) if (it.title === 'Pick one') await H.handle(w.db, w.owner, { action: 'libRemove', wsId: 'ws1', itemId: it.id });
  r = await H.handle(w.db, w.member, { action: 'libRemove', wsId: 'ws1', itemId: deckId });
  ok('a member cannot remove someone else\'s item', r.status === 403);
  r = await H.handle(w.db, w.admin, { action: 'libRemove', wsId: 'ws1', itemId: deckId });
  ok('a team admin can', r.status === 200 && !w.db.read('team_library/ws1/' + deckId));
  delete w.db.TREE.workspaces.ws1.members.own;
  r = await H.handle(w.db, w.member, { action: 'libList', wsId: 'ws1' });
  ok('when the adder leaves the team, their items stay but show no name', r.body.items.length === 1 && r.body.items[0].by === '');

  console.log('\nUsage analytics');
  w = world('team_large');
  r = await H.handle(w.db, w.owner, { action: 'usage', wsId: 'ws1' });
  const u = r.body.usage;
  const rowOwn = u.rows.find(x => x.uid === 'own'), rowMem = u.rows.find(x => x.uid === 'mem');
  ok('per member: decks, questions, sessions run, responses, people reached, Polly use', rowOwn.decks === 2 && rowOwn.questions === 2 && rowOwn.sessions === 1 && rowOwn.responses === 3 && rowOwn.participants === 2 && rowOwn.polly === 7, rowOwn);
  ok('team totals add up', u.totals.decks === 6 && u.totals.responses === 4 && u.totals.byType.quiz === 1 && u.members === 4, u.totals);
  ok('"active in the last 30 days" is honest (the member last seen 40 days ago is not)', rowOwn.responses30 === 3 && rowOwn.activeDays30 === 2 && rowMem.responses30 === 0 && u.activeMembers === 1, { active: u.activeMembers });
  ok('Team Large gets the org-wide view: 90-day trend and top decks', u.orgWide === true && u.days === 90 && u.series.length === 90 && u.series.reduce((a, b) => a + b, 0) === 4 && u.topDecks[0].name === 'Onboarding quiz');
  ok('NO answers and NO audience names ever leave the server', !/Ana Private|"answer"/.test(JSON.stringify(r.body)));
  r = await H.handle(w.db, w.owner, { action: 'usage', wsId: 'ws1' });
  ok('a second look within 5 minutes is served from cache', r.body.cached === true && r.body.usage.totals.responses === 4);
  r = await H.handle(w.db, w.member, { action: 'usage', wsId: 'ws1' });
  ok('a plain member cannot see teammates\' usage', r.status === 403);
  w = world('team_small');
  r = await H.handle(w.db, w.owner, { action: 'usage', wsId: 'ws1' });
  ok('Team Small gets usage analytics too — 30 days, without the org-wide extras', r.status === 200 && r.body.usage.orgWide === false && r.body.usage.days === 30 && r.body.usage.topDecks.length === 0 && r.body.usage.rows.length === 4);

  console.log('\nIt leaves everything else alone');
  r = await H.handle(w.db, w.owner, { action: 'invite', wsId: 'ws1', email: 'x@y.com' });
  ok('an existing team action is not intercepted (handled by api/team.js as before)', r === null);
  r = await H.handle(w.db, w.owner, { action: 'usage', wsId: '../users' });
  ok('a malformed team id is refused', r.status === 400);
  const T = require('fs').readFileSync(path.join(ROOT, 'api', 'team.js'), 'utf8');
  ok('api/team.js hands unknown actions to the hub, with its OWN mail and detachMember', /TeamHub\.handle\(db, \{ callerUid, callerEmail, isSiteAdmin, mail, detachMember \}, req\.body \|\| \{\}\)/.test(T));
  ok('deleting a team deletes its library', (T.match(/db\.ref\('team_library\/' \+ wsId\)\.remove\(\)/g) || []).length === 2);
  const rules = require('fs').readFileSync(path.join(ROOT, 'database-rules.json'), 'utf8');
  ok('no database rule opens team_library — it is reachable only through the server', !/team_library/.test(rules));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
