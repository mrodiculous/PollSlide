#!/usr/bin/env node
/* Account changes (lib/account.js) against an in-memory database shaped like the real one.
 * Email change: every copy follows, history doesn't, nothing else moves.
 * Moving an account: decks keep their ids and session codes (so QR codes, results and class
 * sign-in keep working), backup first, nothing lost, shared decks and billing stay, undo works.
 * Run: node scripts/tests/account.test.js */
const path = require('path');
const A = require(path.join(__dirname, '..', '..', 'lib', 'account.js'));
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')));

/* A tiny RTDB: get/set/update/remove/push, multi-path update at '/', orderByChild().equalTo(). */
function fakeDb(init) {
  const root = JSON.parse(JSON.stringify(init || {}));
  const parts = p => String(p).split('/').filter(Boolean);
  const read = p => parts(p).reduce((o, k) => (o && typeof o === 'object') ? o[k] : undefined, root);
  const prune = (o, ks) => { if (!ks.length) return; const k = ks[0]; if (!o || typeof o !== 'object' || !(k in o)) return;
    prune(o[k], ks.slice(1)); if (o[k] && typeof o[k] === 'object' && !Object.keys(o[k]).length) delete o[k]; };
  const write = (p, v) => { const ks = parts(p); let o = root;
    for (let i = 0; i < ks.length - 1; i++) { if (!o[ks[i]] || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) { delete o[last]; prune(root, ks.slice(0, -1)); } else o[last] = JSON.parse(JSON.stringify(v)); };
  const snap = (key, v) => ({ key, exists: () => v !== undefined && v !== null, val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))),
    forEach(fn) { if (v && typeof v === 'object') Object.keys(v).forEach(k => fn(snap(k, v[k]))); } });
  let n = 0;
  const ref = p => ({
    get: async () => snap(parts(p).pop(), read(p)),
    set: async v => write(p, v),
    remove: async () => write(p, null),
    update: async o => { Object.keys(o).forEach(k => write((p === '/' ? '' : p + '/') + k, o[k])); },
    push: async v => { const k = 'k' + (++n); write(p + '/' + k, v); return { key: k }; },
    orderByChild: c => ({ equalTo: x => ({ get: async () => { const all = read(p) || {}; const out = {};
      Object.keys(all).forEach(k => { if (all[k] && all[k][c] === x) out[k] = all[k]; }); return snap(parts(p).pop(), Object.keys(out).length ? out : null); } }) }),
  });
  return { ref, root, read };
}

(async () => {
  console.log('\nAccount: changing the sign-in email');
  const db = fakeDb({
    users: { u1: { email: 'old@school.edu', pendingEmailFrom: 'old@school.edu', pendingEmail: 'new@me.com', workspaceId: 'w1', stripeCustomerId: 'cus_1', tier: 'team_small',
      presentations: { p1: { name: 'Bio', sessionCode: 'ABC123' } } } },
    admin: { users_index: { u1: { email: 'old@school.edu', tier: 'team_small' } }, tickets: { t1: { uid: 'u1', email: 'old@school.edu' } } },
    workspaces: { w1: { ownerUid: 'u9', members: { u1: { email: 'old@school.edu', role: 'member' }, u9: { email: 'boss@school.edu', role: 'owner' } },
      invites: { old_school_edu: { email: 'old@school.edu', role: 'member' } } } },
    team_invites: { old_school_edu: { wsId: 'w1', role: 'member' } },
    shares: { s1: { toEmail: 'old@school.edu', toEmailKey: 'old_school_edu', status: 'pending', title: 'Deck' },
              s2: { toEmail: 'old@school.edu', toEmailKey: 'old_school_edu', status: 'accepted', acceptedBy: 'u1' } },
  });
  let billed = null;
  const r = await A.syncEmail(db, { uid: 'u1', newEmail: 'New@Me.com', oldEmails: [], stripeUpdate: async (c, e) => { billed = [c, e]; } });
  ok('account record and admin list show the new address', db.read('users/u1/email') === 'new@me.com' && db.read('admin/users_index/u1/email') === 'new@me.com');
  ok('the "pending" markers are cleared', db.read('users/u1/pendingEmail') === undefined && db.read('users/u1/pendingEmailFrom') === undefined);
  ok('Team admin shows the new address', db.read('workspaces/w1/members/u1/email') === 'new@me.com');
  ok('the team owner is untouched', db.read('workspaces/w1/members/u9/email') === 'boss@school.edu');
  ok('billing (Stripe) email updated', billed && billed[0] === 'cus_1' && billed[1] === 'new@me.com', billed);
  ok('a waiting team invite now waits for the new address', !db.read('team_invites/old_school_edu') && db.read('team_invites/new_me_com/wsId') === 'w1'
    && db.read('workspaces/w1/invites/new_me_com/email') === 'new@me.com' && !db.read('workspaces/w1/invites/old_school_edu'));
  ok('a waiting shared deck now waits for the new address', db.read('shares/s1/toEmailKey') === 'new_me_com' && db.read('shares/s1/toEmail') === 'new@me.com');
  ok('an already-accepted share is history — unchanged', db.read('shares/s2/toEmail') === 'old@school.edu');
  ok('support tickets are history — unchanged', db.read('admin/tickets/t1/email') === 'old@school.edu');
  ok('decks, plan and everything else untouched', db.read('users/u1/presentations/p1/sessionCode') === 'ABC123' && db.read('users/u1/tier') === 'team_small');
  ok('reports what it did and the previous address', r.previous.includes('old@school.edu') && r.done.includes('billing email'), r);
  const r2 = await A.syncEmail(db, { uid: 'u1', newEmail: 'new@me.com', oldEmails: [] });
  ok('running it again is harmless', db.read('users/u1/email') === 'new@me.com' && r2.previous.length === 0, r2);
  const db2 = fakeDb({ users: { u2: { email: 'a@b.co', stripeCustomerId: 'cus_2' } } });
  const r3 = await A.syncEmail(db2, { uid: 'u2', newEmail: 'c@d.co', oldEmails: ['a@b.co'], stripeUpdate: async () => { throw new Error('stripe down'); } });
  ok('if Stripe is down the change still completes, and says so', db2.read('users/u2/email') === 'c@d.co' && /billing email not updated/.test(r3.problems[0] || ''), r3);
  let threw = false; try { await A.syncEmail(db2, { uid: 'u2', newEmail: 'not-an-email' }); } catch (e) { threw = true; }
  ok('refuses a malformed address', threw);

  console.log('\nAccount: moving everything to another account');
  const t = fakeDb({
    users: {
      old: { email: 'me@school.edu', tier: 'pro', stripeCustomerId: 'cus_9', aiCredits: 40,
        presentations: { d1: { name: 'Unit 1', sessionCode: 'CODE1', questions: [{ id: 'qa' }, { id: 'qb' }] },
                         d2: { name: 'Unit 2', sessionCode: 'CODE2', questions: [] },
                         d3: { name: 'Shared', sessionCode: 'CODE3', questions: [], classId: 'c2' } },
        classes: { c1: { name: '7B', students: { s1: { name: 'Ana' } } }, c2: { name: '8A' } }, folders: ['Biology'], trash: { d9: { name: 'old' } },
        presentDecks: { pd1: { title: 'Slides' } } },
      neu: { email: 'me@gmail.com', presentations: { x1: { name: 'Mine', sessionCode: 'CODEX' } }, folders: ['Home'] },
    },
    quiz_builder: { CODE1: { ownerUid: 'old', classId: 'c1', questions: [] }, CODE2: { questions: [] }, CODE3: { ownerUid: 'old' } },
    sessions: { CODE1: { responses: { qa_CODE1: { r1: { answer: '"0"' } } } } },
    deckGrants: { old: { d3: { someone: 'edit' } } },
    loop_slots: { old: { 0: 'LOOPA' } },
  });
  const plan = await A.transferPlan(t, 'old', 'neu');
  ok('preview lists the decks and what moves', plan.decks.length === 3 && plan.moving.sort().join() === 'd1,d2', plan.moving);
  ok('preview warns: shared deck stays, LoopSlide stays, plan/billing stays', plan.warnings.length === 3, plan.warnings);
  ok('preview changes nothing', t.read('users/old/presentations/d1/name') === 'Unit 1' && !t.read('users/neu/presentations/d1'));
  let bad = false; try { await A.transferPlan(t, 'old', 'old'); } catch (e) { bad = true; }
  ok('refuses moving an account into itself', bad);
  let unseen = false; try { await A.transferPlan(t, 'old', 'nobody'); } catch (e) { unseen = /signed in/.test(e.message); }
  ok('refuses a destination that has never signed in', unseen);

  const run = await A.transferRun(t, 'old', 'neu', { now: 1700000000000, actor: 'help@pollslide.com' });
  ok('decks moved with the SAME id and session code (QR codes keep working)', t.read('users/neu/presentations/d1/sessionCode') === 'CODE1' && t.read('users/neu/presentations/d2/sessionCode') === 'CODE2');
  ok('results untouched (they live under the session code)', t.read('sessions/CODE1/responses/qa_CODE1/r1/answer') === '"0"');
  ok('class sign-in now finds the roster in the new account', t.read('quiz_builder/CODE1/ownerUid') === 'neu' && t.read('users/neu/classes/c1/students/s1/name') === 'Ana');
  ok('folders merged, nothing of the destination lost', JSON.stringify(t.read('users/neu/folders')) === '["Home","Biology"]' && t.read('users/neu/presentations/x1/name') === 'Mine');
  ok('trash and slideshow decks moved too', !!t.read('users/neu/trash/d9') && !!t.read('users/neu/presentDecks/pd1'));
  ok('moved items are gone from the old account', !t.read('users/old/presentations/d1') && !t.read('users/old/classes/c1'));
  ok('a class still used by a deck that stays is copied, not moved (its sign-in keeps working)', t.read('users/old/classes/c2/name') === '8A' && t.read('users/neu/classes/c2/name') === '8A');
  ok('the shared deck stayed with the old account, still shared', t.read('users/old/presentations/d3/name') === 'Shared' && t.read('quiz_builder/CODE3/ownerUid') === 'old');
  ok('plan, billing and credits stayed with the account', t.read('users/old/tier') === 'pro' && t.read('users/old/stripeCustomerId') === 'cus_9' && t.read('users/old/aiCredits') === 40 && !t.read('users/neu/tier'));
  const bk = t.read('admin/account_transfers/' + run.id);
  ok('a full backup was written first, and marked done', bk && bk.status === 'done' && bk.backup.presentations.d1.name === 'Unit 1' && bk.classLinks.CODE1 === 'old', bk && bk.status);

  await A.transferUndo(t, run.id);
  ok('undo puts everything back where it was', t.read('users/old/presentations/d1/sessionCode') === 'CODE1' && !t.read('users/neu/presentations/d1')
    && t.read('users/old/classes/c1/name') === '7B' && t.read('quiz_builder/CODE1/ownerUid') === 'old' && t.read('users/neu/presentations/x1/name') === 'Mine');
  let twice = false; try { await A.transferUndo(t, run.id); } catch (e) { twice = true; }
  ok('an undo cannot be applied twice', twice);

  console.log('\nAccount: the endpoint takes identity from the token, never the body');
  const src = require('fs').readFileSync(path.join(__dirname, '..', '..', 'api', 'account.js'), 'utf8');
  ok('self email sync uses the verified token email only', /newEmail: callerEmail/.test(src) && /email_verified !== true/.test(src) && !/body\.email\b/.test(src));
  ok('every admin action sits behind the admin check', src.indexOf("if (!isAdmin) return res.status(403)") < src.indexOf("action === 'adminFind'"));
  ok('admin email change requires a recorded verification reason', /Record how you verified the request/.test(src));
  ok('a transfer requires typing MOVE and a reason', /body\.confirm !== 'MOVE'/.test(src) && /Record how you verified both accounts/.test(src));
  const del = require('fs').readFileSync(path.join(__dirname, '..', '..', 'api', 'delete-account.js'), 'utf8');
  ok('deleting an account stops its subscription first, or deletes nothing', /cancel_at_period_end: true/.test(del)
    && del.indexOf('cancel_at_period_end: true') < del.indexOf('deleteUser(uid)') && /nothing was deleted/.test(del));

  ok('deleting an account whose Stripe customer no longer exists still works (nothing to bill)', /e\.code === 'resource_missing'/.test(del) && /Any OTHER failure still blocks the deletion/.test(del));
  ok('Google users: Route A switches to email + password on the SAME account (unlinks google.com)', /providersToUnlink: \['google\.com'\]/.test(src) && /isGoogle && !toPassword\) return res\.status\(400\)/.test(src));
  const mailSrc = require('fs').readFileSync(path.join(__dirname, '..', '..', 'api', 'send-email.js'), 'utf8');
  ok('a switched Google user is told to SET a password (not "your password stays the same")', /data\.switchedToPassword[\s\S]{0,120}set your password/.test(mailSrc));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
