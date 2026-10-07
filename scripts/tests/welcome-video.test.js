/* The welcome video reaches new users, and the GIPHY package is complete.
 * Run: node scripts/tests/welcome-video.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), SITE = path.resolve(ROOT, '..', 'pollslide-website');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
const hasSite = fs.existsSync(SITE);

console.log('\nThe welcome email shows the video');
const T = require(path.join(ROOT, 'api', 'send-email.js')).TEMPLATES.welcome({});
ok('it links to the getting-started page', /https:\/\/pollslide\.com\/getting-started/.test(T.html));
ok('it shows the animated preview from the site', /https:\/\/pollslide\.com\/videos\/getting-started-email\.gif/.test(T.html));
ok('the preview has alt text (images are often blocked in email)', /alt="Watch: your first quiz in 2 minutes"/.test(T.html));

console.log('\nThe video, its page and its captions');
if (!hasSite) console.log('  (website repo not beside this one — site checks skipped)');
else {
  const V = path.join(SITE, 'videos');
  const mp4 = path.join(V, 'getting-started.mp4');
  ok('the video is on the site', fs.existsSync(mp4));
  ok('…small enough to stream comfortably (< 30 MB)', fs.existsSync(mp4) && fs.statSync(mp4).size < 30 * 1024 * 1024);
  const gif = path.join(V, 'getting-started-email.gif');
  ok('the email preview is under 1.5 MB', fs.existsSync(gif) && fs.statSync(gif).size < 1.5 * 1024 * 1024);
  const langs = ['en', 'es', 'de', 'fr', 'pt', 'it'];
  const counts = langs.map(l => { const f = path.join(V, `getting-started.${l}.vtt`); return fs.existsSync(f) ? (fs.readFileSync(f, 'utf8').match(/-->/g) || []).length : 0; });
  ok('captions exist in all six site languages', counts.every(n => n > 0), counts);
  const page = fs.readFileSync(path.join(SITE, 'getting-started.html'), 'utf8');
  ok('the page offers every caption track', langs.every(l => page.includes(`getting-started.${l}.vtt`)));
  ok('captions follow the site language', /attributeFilter:\['lang'\]/.test(page));
  const help = fs.readFileSync(path.join(SITE, 'help.html'), 'utf8');
  ok('the help centre explainer plays the new video', /\/videos\/getting-started\.mp4/.test(help) && !/howto_full_walkthrough\.mp4/.test(help));
  ok('the page is in the sitemap', /pollslide\.com\/getting-started</.test(fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8')));
}
const pres = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
ok('the app welcome screen links to the video', /href="https:\/\/pollslide\.com\/getting-started"[^>]*>(\$\{tr\(')?▶ 2-min video('\)\})?</.test(pres));
const scenes = require(path.join(ROOT, 'scripts', 'video', 'getting-started.js')).scenes;
const caps = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'video', 'getting-started.captions.json'), 'utf8')).cues;
ok('every narrated scene has its translations', caps.length === scenes.length, [caps.length, scenes.length]);

console.log('\nThe team video');
if (hasSite) {
  const V = path.join(SITE, 'videos');
  ok('the team video, poster and email preview are on the site', ['team-setup.mp4', 'team-setup-poster.jpg', 'team-setup-email.gif'].every(f => fs.existsSync(path.join(V, f))));
  ok('team captions in all six languages', ['en', 'es', 'de', 'fr', 'pt', 'it'].every(l => fs.existsSync(path.join(V, `team-setup.${l}.vtt`))));
  const help = fs.readFileSync(path.join(SITE, 'help.html'), 'utf8');
  const teams = help.slice(help.indexOf('<section id="teams">'), help.indexOf('<section id="privacy">'));
  ok('the help centre Teams section plays it', /\/videos\/team-setup\.mp4/.test(teams));
  ok('…and names the real menu item, not the old "account menu → Team"', /Team admin/.test(teams) && !/account menu → Team/.test(teams));
  ok('…and no longer promises a shared presentation library', !/shared home for presentations/.test(teams));
  ok('the team page is in the sitemap', /pollslide\.com\/team-setup</.test(fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8')));
}
const tscenes = require(path.join(ROOT, 'scripts', 'video', 'team-setup.js')).scenes;
ok('every team scene has its translations', JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'video', 'team-setup.captions.json'), 'utf8')).cues.length === tscenes.length);
const presT = fs.readFileSync(path.join(ROOT, 'presenter.html'), 'utf8');
ok('Team admin links to the team video', /href="https:\/\/pollslide\.com\/team-setup"/.test(presT));

console.log('\nGIPHY Production-key package');
const G = path.join(ROOT, 'SUBMIT-TO-GIPHY');
const vid = path.join(G, '1-app-demo-video.mp4');
ok('the demo video is under GIPHY\'s 25 MB limit', fs.existsSync(vid) && fs.statSync(vid).size < 25 * 1024 * 1024);
ok('both screenshots are there', ['2-screenshot-app-with-giphy.png', '3-screenshot-powered-by-giphy.png'].every(f => fs.existsSync(path.join(G, f))));
const gs = require(path.join(ROOT, 'scripts', 'video', 'giphy-review.js')).scenes.map(s => s.run.toString()).join('\n');
ok('the demo covers the question picker, answers, whole deck, audience and LoopSlide',
  /updateQ\(0,/.test(gs) && /updateOptImg\(0,2,/.test(gs) && /openGifModal/.test(gs) && /answer\?signedout/.test(gs) && /mediaFor\(0,0/.test(gs));
ok('it zooms in on the attribution', /focus\('#gifPickerCredit'/.test(gs) && /GIFs via GIPHY/.test(gs) && /focus\('#gattr'/.test(gs));
ok('the package is never deployed publicly', /^SUBMIT-TO-GIPHY\/$/m.test(fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
