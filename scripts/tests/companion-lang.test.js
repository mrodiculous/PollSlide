#!/usr/bin/env node
/* Mac companion in six languages (1.3.5, 2026-10-01). The app follows the Mac's language,
 * or the one picked in its Language menu, and passes it to the page it shows (companion.html)
 * as &lang=. Without lang — app 1.3.4 and older, a browser, OBS — the page must stay English
 * exactly as before. Run: node scripts/tests/companion-lang.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
const C = fs.readFileSync(path.join(ROOT, 'companion.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 400) : '')));
const LANGS = ['es', 'de', 'fr', 'pt', 'it', 'nl', 'ja', 'zh', 'ar', 'hi'];   // 11 with English (2026-10-10)

// Load the page's own language code with a given address.
function load(search) {
  const start = C.indexOf('const UI_LANG_C'), end = C.indexOf('if (UI_LANG_C !== \'en\') {');
  const ctx = { location: { search }, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(C.slice(start, end) + ';this.T=T;this.D=COMP_I18N;this.L=UI_LANG_C;', ctx);
  return ctx;
}

console.log('\nCompanion page: English stays English');
const en = load('?cb=1');
ok('no lang (app 1.3.4, browser, OBS) → English', en.L === 'en' && en.T('Reveal in') === 'Reveal in' && en.T('Player {n}', { n: 3 }) === 'Player 3');
ok('an unknown lang → English', load('?cb=1&lang=xx').L === 'en' && load('?lang=EN').L === 'en');
ok('the static labels are only rewritten when a language was asked for', /if \(UI_LANG_C !== 'en'\) \{\s*document\.documentElement\.lang/.test(C));
const de = load('?cb=1&v=1.3.5&lang=de');
ok('lang=de → German, placeholders filled', de.T('Player {n}', { n: 2 }) === 'Spieler 2' && de.T('Reveal in') === 'Aufdecken in');

console.log('\nCompanion page: every string it shows exists in every language');
const used = [...new Set([...C.matchAll(/\bT\('((?:[^'\\]|\\.)*)'/g)].map(m => m[1]))];
const labelKeys = ['Leaderboard', 'Podium', 'Score Card', 'Explainer', 'Post-Reveal', 'response', 'responses'];   // looked up through a variable
const missing = [];
for (const l of LANGS) for (const k of [...used, ...labelKeys]) if (!de.D[l] || !de.D[l][k]) missing.push(l + ': ' + k);
ok(`${used.length} strings, all translated in ${LANGS.join('/')}`, used.length > 40 && missing.length === 0, missing);
ok('a question, option, name or answer is never passed through T()', !/T\((curQ|q|opt|r)\.(text|name|answer)/.test(C) && !/T\(escapeHtml/.test(C));

console.log('\nCompanion page: house register (ui-lang.js is the anchor)');
const all = l => Object.values(de.D[l]).join(' | ');
ok('German says du, never Sie', !/\b(Sie|Ihre?n?)\b/.test(all('de')));
ok('French says tu, never vous', !/\bvous\b/i.test(all('fr')));
ok('Spanish says tú, never usted', !/\busted(es)?\b/i.test(all('es')));
ok('Portuguese is European (no você, ecrã/telemóvel not tela/celular)', !/\b(você|tela|celular)\b/i.test(all('pt')));

// The Mac app's source lives outside this repo (Rod's Mac); checked when it is there.
const MAC = path.resolve(os.homedir(), 'Downloads', 'PollSlide', 'xCode App Companion Pollslide', 'PollSlideCompanion', 'PollSlideCompanion');
if (fs.existsSync(path.join(MAC, 'L10n.swift'))) {
  console.log('\nMac app (1.3.5)');
  const L = fs.readFileSync(path.join(MAC, 'L10n.swift'), 'utf8');
  const A = fs.readFileSync(path.join(MAC, 'PollSlideCompanionApp.swift'), 'utf8');
  const P = fs.readFileSync(path.join(MAC, 'PairingView.swift'), 'utf8');
  const block = l => { const i = L.indexOf(`"${l}": [`); const j = L.indexOf('\n        ],', i); return L.slice(i, j); };
  const uses = [...new Set([...(A + P).matchAll(/L10n\.(?:t|long)\("((?:[^"\\]|\\.)*)"/g)].map(m => m[1]))];
  const gaps = [];
  for (const l of LANGS) { const b = block(l); for (const k of uses) if (!b.includes(`"${k}":`)) gaps.push(l + ': ' + k); }
  ok(`every app string (${uses.length}) is in all five languages`, uses.length > 30 && gaps.length === 0, gaps);
  ok('no English left hard-coded in the menu, dialogs or pairing window',
    !/NSMenuItem\(title: "[A-Za-z]/.test(A) && !/messageText = "(?!PollSlide Companion \\\()/.test(A) && !/addButton\(withTitle: "/.test(A) && !/Text\("(?!PollSlide")[A-Za-z0-9]/.test(P) && !/statusMessage = "[A-Za-z]/.test(P));
  ok('follows the Mac unless the user picks a language (Language menu, Automatic first)', /Locale\.preferredLanguages/.test(L) && /static var current: String \{ choice \?\? system \}/.test(L) && /Automatic \(this Mac’s language\)/.test(A) && /@objc func chooseLanguage/.test(A));
  ok('a change applies at once (menu rebuilt, window reloaded on the same question)', /buildMenu\(\)\s*\n\s*if L10n\.current != before \{ refreshFloatingContent\(\) \}/.test(A));
  ok('the page gets the same language as the app', /&lang=\\\(L10n\.current\)#/.test(P));
  ok('the status colour no longer depends on the English word "Connected!"', !/statusMessage == "Connected!"/.test(P) && /statusIsSuccess = true/.test(P));
  ok('the pairing steps no longer show a garbled emoji', !/ð|Ã|Â/.test(P));
  ok('new-tab links in the window open in the browser (http/https only)', /webView\.uiDelegate = context\.coordinator/.test(P) && /createWebViewWith[\s\S]{0,400}scheme == "https" \|\| scheme == "http"[\s\S]{0,80}NSWorkspace\.shared\.open\(url\)/.test(P));
  // The page tells a user without an account to use the app's menu — it must quote the
  // app's own (translated) labels, or the instructions name a button that is not there.
  const quoted = { es: ['Desconectar cuenta (volver a conectar)', 'Conectar con PollSlide'], de: ['Konto trennen (neu verbinden)', 'Mit PollSlide verbinden'],
    fr: ['Déconnecter le compte (reconnecter)', 'Se connecter à PollSlide'], pt: ['Desligar conta (voltar a ligar)', 'Ligar ao PollSlide'], it: ['Scollega account (ricollega)', 'Collegati a PollSlide'] };
  const noAcct = Object.keys(de.D.de).find(k => k.startsWith('No account linked.'));
  const bad = [];
  for (const l of LANGS) for (const lab of quoted[l]) { if (!block(l).includes(`: "${lab}"`)) bad.push(l + ' app lacks ' + lab); if (!de.D[l][noAcct].includes(lab)) bad.push(l + ' page lacks ' + lab); }
  ok('the page quotes the app\'s menu and window names exactly, in every language', bad.length === 0, bad);
  // The website and the presenter quote the same labels (translated / English) — they must
  // be the app's exact words, or a help page names a menu item that is not there.
  const SITEI = path.resolve(ROOT, '..', 'pollslide-website', 'i18n.js');
  if (fs.existsSync(SITEI)) {
    const si = fs.readFileSync(SITEI, 'utf8');
    const lab = JSON.parse(si.slice(si.indexOf('const APP_LABELS = ') + 19, si.indexOf(';\n  const Q = {')));
    const off = [];
    for (const l of LANGS) for (const [en, tr] of Object.entries(lab[l])) if (!block(l).includes(`"${en}": "${tr}"`)) off.push(`${l}: ${en} → ${tr}`);
    ok('the website\'s Mac-app labels match the app word for word', Object.keys(lab.de).length >= 10 && off.length === 0, off);
  }
  global.window = { PS_UI: {} }; require(path.join(ROOT, 'ui-lang.js'));
  const pk = 'Nothing opens by itself: in the menu bar (top right of your screen), click the bar-chart icon, then "Disconnect Account (Re-pair)" — that opens the "Connect to PollSlide" window.';
  const pbad = LANGS.filter(l => !(window.PS_UI[l][pk] || '').includes(quoted[l][0]) || !(window.PS_UI[l][pk] || '').includes('Disconnect Account (Re-pair)'));
  ok('the presenter\'s "Connect Mac App" box names both: the translated label and the English one (1.3.4)', pbad.length === 0, pbad);
} else console.log('  (Mac app source not on this machine — skipped)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
