#!/usr/bin/env node
/* Legal safeguards from the 9 Oct 2026 review — guards the fixes so they cannot quietly
 * regress. Each block names the risk it closes. None of this certifies compliance.
 * Run: node scripts/tests/legal-safeguards.test.js */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.resolve(ROOT, '..', 'pollslide-website');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };
const htmlIn = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => path.join(dir, f)) : [];

/* Customer-facing pages. powerpoint-content/ (PollSlide LIVE) is frozen during Microsoft
   review and still loads Google Fonts — fix it after approval; it is in its own folder so
   it is not in these lists. google-slides-addon/ runs inside Google's own Apps Script. */
const APP_PAGES = htmlIn(ROOT);
const SITE_PAGES = htmlIn(SITE).concat(htmlIn(path.join(SITE, 'blog')));

console.log('\nGDPR — no visitor IP sent to Google Fonts');
for (const [label, pages] of [['app', APP_PAGES], ['site', SITE_PAGES]]) {
  const leaks = pages.filter(p => /fonts\.(googleapis|gstatic)\.com/.test(read(p))).map(p => path.basename(p));
  ok(`${label}: no page loads fonts from Google (${pages.length} pages)`, leaks.length === 0, leaks);
}
for (const [label, base] of [['app', ROOT], ['site', SITE]]) {
  const css = read(path.join(base, 'fonts', 'fonts.css'));
  const files = [...css.matchAll(/url\(\/fonts\/([^)]+)\)/g)].map(m => m[1]);
  ok(`${label}: fonts.css is local and every font file it names exists`, files.length >= 3 && files.every(f => fs.existsSync(path.join(base, 'fonts', f))), files.filter(f => !fs.existsSync(path.join(base, 'fonts', f))));
  const h = crypto.createHash('sha1').update(fs.readFileSync(path.join(base, 'fonts', 'fonts.css'))).digest('hex').slice(0, 8);
  const pages = label === 'app' ? APP_PAGES : SITE_PAGES;
  const stale = pages.filter(p => { const m = read(p).match(/\/fonts\/fonts\.css\?v=([a-z0-9]+)/); return m && m[1] !== h; }).map(p => path.basename(p));
  ok(`${label}: every fonts.css link carries the file's current version`, stale.length === 0, stale);
}

console.log('\nCalifornia auto-renewal — terms beside every subscribe button, and in the emails');
const P = read(path.join(ROOT, 'presenter.html'));
ok('app: one shared renewal sentence (price, renews until you cancel, where to cancel)', /function psRenewNote\(annual, monthly, annualMonthly\)/.test(P) && /Renews automatically every month until you cancel\. Cancel anytime in Plan & billing\./.test(P) && /Renews automatically every year until you cancel\. Cancel anytime in Plan & billing\./.test(P));
ok('app: shown under every Upgrade / Switch button in the plan picker', /\(\(!isCurrent && !isEnterprise && !isDowngradeToFree && price > 0\)\n\s*\? '<div.*psRenewNote\(pickerBilling === 'annual', price, p\.yr\)/.test(P));
ok('app: shown in the older checkout modal too', /info\.innerHTML = [\s\S]{0,400}psRenewNote\(annual, p\.m, p\.a\)/.test(P));
ok('the plan picker stays ONE picker across Monthly/Annual toggles (it duplicated on the 2nd toggle)', /box\.dataset\.ppBox = '1';\n\s*const existing = overlay\.querySelector\('\[data-pp-box\]'\);/.test(P));
const PR = read(path.join(SITE, 'pricing.html'));
ok('pricing page: renewal line under each paid button (script and prerendered HTML)', /Renews every month until you cancel\. Cancel anytime\./.test(PR) && (PR.match(/class="renew-note"/g) || []).length >= 3);
ok('pricing page: full renewal + cancellation terms under the plans', /<p class="renew-terms">Paid plans renew automatically/.test(PR));
const E = require(path.join(ROOT, 'api', 'send-email.js')).TEMPLATES;
ok('plan-confirmation email states renewal and how to cancel', /About renewal:[\s\S]*Plan &amp; billing → Manage billing/.test(E.upgrade({ plan: 'Pro', planKey: 'pro' }).html));
ok('every payment receipt restates it', /About renewal:/.test(E.receipt({ plan: 'Pro', amount: '$12' }).html));

console.log('\nCAN-SPAM — postal address in the email footer, never a placeholder');
const S = read(path.join(ROOT, 'api', 'send-email.js'));
ok('footer prints PS_POSTAL_ADDRESS only when it is set', /const POSTAL_ADDRESS = \(process\.env\.PS_POSTAL_ADDRESS \|\| ''\)\.trim\(\);/.test(S) && /\$\{POSTAL_ADDRESS \? esc\(POSTAL_ADDRESS\) \+ '<br>' : ''\}/.test(S));
ok('marketing announcements still carry the one-click unsubscribe', /Unsubscribe fro/.test(S) && /function unsubUrl|unsubUrl\(/.test(S));

console.log('\nAge — every new account confirms 16+ and the Terms');
ok('the gate runs on every sign-in, for accounts created from 9 Oct 2026', /checkPolicyConsent\(userId\);\n\s*checkSignupConsent\(userId\);/.test(P) && /const SIGNUP_GATE_FROM = Date\.UTC\(2026, 9, 9\);/.test(P));
ok('ticking the box at email signup or Google-on-Create-account is recorded, not asked twice', /_signupConsentGiven = 'email';/.test(P) && /if \(authMode === 'signup'\) _signupConsentGiven = 'google';/.test(P));
ok('Google sign-in that silently creates an account now meets a blocking dialog', /function showSignupConsentGate\(uid\)/.test(P) && /if \(!snap\.exists\(\)\) showSignupConsentGate\(uid\);/.test(P));
ok('the confirmation is stored as evidence (age16, termsAndPrivacy, at, via)', /signupConsent'\] = \{ age16: true, termsAndPrivacy: true, at: now, via: via \}/.test(P));
ok('declining deletes the new account fully (server-side deletion, not just sign-out)', /showSignupConsentGate[\s\S]{0,4000}fetch\('\/api\/delete-account'/.test(P));

console.log('\nCOPPA positioning — nothing that reads as marketing to under-13s');
const LEGAL = new Set(['privacy.html', 'terms.html', 'dpa.html', 'cookies.html', 'subprocessors.html', 'trust-safety.html', 'vpat.html', 'accessibility.html']);
const KIDS = /\b(kids?|kiddos?|elementary|primary[- ]school|kindergarten|preschool|pre-k|nursery|young learners?|little ones|toddlers?|tweens?|K-?(5|6|8|12)|[1-6](st|nd|rd|th) grade|grade [1-6]|ages? [3-9]\b|ages? 1[0-2]\b)\b/i;
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
const kidHits = SITE_PAGES.filter(p => !LEGAL.has(path.basename(p))).filter(p => KIDS.test(strip(read(p)))).map(p => path.basename(p) + ': ' + strip(read(p)).match(KIDS)[0]);
ok('no marketing or help page uses child-directed wording', kidHits.length === 0, kidHits);
const IDX = read(path.join(SITE, 'index.html'));
ok('the homepage says plainly who PollSlide is for — and that it is not for under-13s', /Who is PollSlide for\?/.test(IDX) && /PollSlide is not designed for, or marketed to, children under 13\./.test(IDX));
const noAge = SITE_PAGES.filter(p => /"@type":\s*"SoftwareApplication"/.test(read(p)) && !/"suggestedMinAge":\s*13/.test(read(p))).map(p => path.basename(p));
ok('every product schema tells search engines the minimum audience age is 13', noAge.length === 0, noAge);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
