/* The Microsoft submission folder can't drift from the real add-in.
 * Run: node scripts/tests/appsource-package.test.js */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..'), D = path.join(ROOT, 'SUBMIT-TO-MICROSOFT');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x) : '')));
console.log('\nThe AppSource package matches the add-in');
const m = read('powerpoint-content/manifest.xml');
ok('the manifest in the folder is identical to the one the add-in uses', fs.existsSync(path.join(D, 'manifest.xml')) && read('SUBMIT-TO-MICROSOFT/manifest.xml') === m);
const name = (m.match(/<DisplayName DefaultValue="([^"]*)"/) || [])[1];
const cp = f => fs.readFileSync(path.join(D, 'copy-paste', f), 'utf8').trim();
ok('the store name matches the manifest name exactly', cp('1-name.txt') === name, [cp('1-name.txt'), name]);
ok('name ≤ 50 chars, no "free", no Microsoft product name', name.length <= 50 && !/free/i.test(name) && !/PowerPoint|Microsoft|Office/i.test(name));
ok('summary ≤ 100 characters', cp('2-summary.txt').length <= 100, cp('2-summary.txt').length);
ok('description ≤ 4,000 characters', cp('3-description.txt').length <= 4000);
const desc = (m.match(/<Description DefaultValue="([^"]*)"/) || [])[1];
ok('manifest description ≤ 250 characters', desc.length <= 250, desc.length);
ok('the support link points at the add-in\'s own help page', /<SupportUrl DefaultValue="https:\/\/pollslide\.com\/powerpoint-live" \/>/.test(m));
ok('the help page exists in the website repo', (() => { try { return fs.existsSync(path.join(ROOT, '..', 'pollslide-website', 'powerpoint-live.html')); } catch (e) { return true; } })());
ok('this is the content add-in, with its own Id', /xsi:type="ContentApp"/.test(m) && /<Id>6a2cf181-7fbf-4d5e-8dfc-690b55082599<\/Id>/.test(m));
ok('icons are the sizes Microsoft requires', /icon-32\.png/.test(m) && /icon-64\.png/.test(m));
const notes = cp('6-notes-for-certification.txt');
ok('notes give the test account and say it is not enterprise-only', /appsource-review@pollslide\.com/.test(notes) && /NOT an enterprise-only/.test(notes));
const shots = fs.readdirSync(path.join(D, 'screenshots')).filter(f => f.endsWith('.png'));
ok('1–5 screenshots, each under 1 MB', shots.length >= 1 && shots.length <= 5 && shots.every(f => fs.statSync(path.join(D, 'screenshots', f)).size <= 1024 * 1024), shots);
const png = f => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
ok('every screenshot is exactly 1366×768', shots.every(f => { const [w, h] = png(path.join(D, 'screenshots', f)); return w === 1366 && h === 768; }));
const [lw, lh] = png(path.join(D, 'logo-300x300.png'));
ok('logo is a 216–350 px square', lw === lh && lw >= 216 && lw <= 350);
ok('the folder is never deployed publicly (it holds the reviewer login)', /^SUBMIT-TO-MICROSOFT\/$/m.test(read('.vercelignore')) && /^\*\.md$/m.test(read('.vercelignore')));
const pages = [...fs.readdirSync(ROOT).filter(x => x.endsWith('.html')).map(x => path.join(ROOT, x)),
  ...(fs.existsSync(path.join(ROOT, '..', 'pollslide-website')) ? fs.readdirSync(path.join(ROOT, '..', 'pollslide-website')).filter(x => x.endsWith('.html')).map(x => path.join(ROOT, '..', 'pollslide-website', x)) : [])];
const stale = pages.filter(p => /Windows companion|Windows soon|macOS only for now\. PowerPoint support on Windows/i.test(fs.readFileSync(p, 'utf8')));
ok('no page promises a "Windows companion" — Windows users get the PowerPoint add-in', !stale.length, stale.map(p => path.basename(p)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
