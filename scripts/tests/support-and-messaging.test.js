/* 2026-09-25 support & messaging fixes. Each block names the report it guards.
 * Run: node scripts/tests/support-and-messaging.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n));

console.log('\nRespondent language controls are never hidden behind the question card');
{
  const a = read('answer.html');
  const appZ = +(a.match(/#app \{[\s\S]*?z-index: (\d+)/) || [])[1];
  const langZ = +(a.match(/viewerLangWrap';\s*\n\s*wrap\.style\.cssText = 'position:fixed;top:10px;right:10px;z-index:(\d+)/) || [])[1];
  const origZ = +(a.match(/top:47px;right:10px;z-index:(\d+)/) || [])[1];
  ok('language selector sits above the card', langZ > appZ);
  ok('"See original" sits above the card', origZ > appZ);
  ok('the card reserves the top strip (starts ≥ 92px down)', /top: calc\(50% \+ 42px\) !important;/.test(a) && /max-height: calc\(100dvh - 100px\) !important;/.test(a));
}

console.log('\nNo admin link in any email to a customer');
{
  process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-key';
  const m = require(path.join(ROOT, 'api', 'send-email.js'));
  const data = { subject: 'Shared', heading: 'A deck was shared', body: '<p>x</p>' };
  const cust = m.stripAdminLinks(m.TEMPLATES.notify(data, { staff: m.isStaffRecipient('someone@gmail.com') }).html);
  const staff = m.TEMPLATES.notify(data, { staff: m.isStaffRecipient('help@pollslide.com') }).html;
  ok('collaboration email has no admin link or "Open admin"', !/\/admin/i.test(cust) && !/Open admin/i.test(cust));
  ok('it points customers at PollSlide instead', /Open PollSlide/.test(cust));
  ok('staff alerts keep "Open admin"', /Open admin/.test(staff));
  ok('safety net strips a stray admin link', !/admin/i.test(m.stripAdminLinks('<a href="https://app.pollslide.com/admin.html">Open admin</a>')));

  const t = m.TEMPLATES.announcement({ text: 'Hi\n<b>x</b>', type: 'info', unsubUrl: 'https://app.pollslide.com/api/unsubscribe?u=a&s=' + m.unsubSig('a') });
  ok('broadcast email escapes admin text', /&lt;b&gt;/.test(t.html) && !/<b>x/.test(t.html));
  ok('broadcast email carries an unsubscribe link', /Unsubscribe from announcements/.test(t.html));
  ok('broadcast email type is admin-only', !m.USER_TYPES.includes('announcement'));
  ok('unsubscribe signature is per-account', m.unsubSig('a') !== m.unsubSig('b'));
  const se = read('api/send-email.js');
  ok('an unsubscribed user is skipped server-side', /emailPrefs\/announcements[\s\S]{0,200}skipped: 'unsubscribed'/.test(se));
}

console.log('\nAdmin messages stay until the user dismisses them');
{
  const p = read('presenter.html');
  ok('no more 3.5s toast for admin messages', !/toast\('📬 Message from PollSlide: '/.test(p));
  ok('messages open in a dismissable card', /function showAdminMessages\(list\)/.test(p) && /textContent = 'Got it'/.test(p));
  ok('marked read only on dismissal', /btn\.onclick = \(\) => \{[\s\S]{0,200}inbox\/\$\{id\}\/read`\] = true/.test(p));
  ok('admin text is rendered as text, never HTML', /row\.textContent = m\.text/.test(p));
}

console.log('\nMasquerade is admin-only, logged, and isolated');
{
  const api = read('api/masquerade.js');
  ok('caller must be a verified admin', /verifyToken\(tok\)/.test(api) && /ADMIN_EMAILS\.includes\(who\.email\)/.test(api));
  ok('an admin account can never be impersonated', /Admin accounts cannot be impersonated/.test(api));
  ok('every use is logged BEFORE the token is issued', api.indexOf("masquerade_log") < api.indexOf('createCustomToken'));
  const p = read('presenter.html');
  ok('the session lives in a separate app (admin sign-in untouched)', /initializeApp\(FIREBASE_CONFIG, 'ps-masquerade'\)/.test(p));
  ok('in-memory only — dies with the window', /_MASQ\) \{\s*\n\s*auth\.setPersistence\(firebase\.auth\.Auth\.Persistence\.NONE\)/.test(p));
  ok('token only accepted from the admin window, same origin', /e\.origin !== location\.origin \|\| e\.source !== window\.opener/.test(p));
  ok('normal visits are exactly the default app', /: firebase\.app\(\);/.test(p));
  ok('viewing does not rewrite the user\'s last login', /if \(!_MASQ\) \{\s*\n\s*db\.ref\(`users\/\$\{userId\}`\)\.update\(loginMeta\)/.test(p));
  const ad = read('admin.html');
  ok('token never travels in a URL', /window\.open\('\/presenter\.html\?masquerade=1'/.test(ad) && !/masquerade=1[^'"]*token/.test(ad));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
