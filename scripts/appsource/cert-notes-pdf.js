#!/usr/bin/env node
/* Partner Center → Additional certification info wants a PDF (not shown to customers).
 *   node scripts/appsource/cert-notes-pdf.js  → SUBMIT-TO-MICROSOFT/certification-notes.pdf
 * Built from copy-paste/6-notes-for-certification.txt (the single source of the wording)
 * plus the four English screenshots, so the PDF can never say something the notes don't. */
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const D = path.resolve(__dirname, '..', '..', 'SUBMIT-TO-MICROSOFT');
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find(p => fs.existsSync(p));
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const notes = fs.readFileSync(path.join(D, 'copy-paste', '6-notes-for-certification.txt'), 'utf8').trim();
const img = f => 'data:image/png;base64,' + fs.readFileSync(path.join(D, 'screenshots', f)).toString('base64');
const body = notes.split(/\n\s*\n/).map(p => {
  const lines = p.split('\n');
  const head = lines.length > 1 && /^[A-Z][A-Z ]{3,}(\s*\(|\s*—|$)/.test(lines[0]);
  const rest = (head ? lines.slice(1) : lines).map(l => esc(l).replace(/^\s+/, m => '&nbsp;'.repeat(m.length))).join('<br>');
  return (head ? `<h2>${esc(lines[0])}</h2>` : '') + `<p${/Password:/.test(p) ? ' class="acct"' : ''}>${rest}</p>`;
}).join('\n');
const shots = [['04-first.png', 'Editing view, first run: explains what it does, says how to get a free account, then offers sign-in.'],
  ['01-live.png', 'Linked to a multiple-choice question: bars update as the audience answers from their phones.'],
  ['02-show.png', 'During Slide Show: results keep updating; the answer can be revealed on a countdown or with one click.'],
  ['03-cloud.png', 'Other question types (here a word cloud) render the same way.']];
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4;margin:18mm 16mm}
  body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.45;color:#111}
  h1{font-size:18pt;margin:0 0 2px} .sub{color:#555;margin:0 0 14px}
  h2{font-size:11.5pt;margin:16px 0 4px;color:#3a2fd0;letter-spacing:.3px}
  p{margin:0 0 8px} pre{font-family:inherit;white-space:pre-wrap;margin:0 0 8px}
  .acct{background:#f3f2ff;border:1px solid #d9d6ff;border-radius:6px;padding:8px 12px}
  .shot{page-break-inside:avoid;margin:0 0 14px} .shot img{width:100%;border:1px solid #ddd;border-radius:4px}
  .shot p{font-size:10pt;color:#333;margin:4px 0 0} .pb{page-break-before:always}
</style></head><body>
<h1>PollSlide LIVE — Results on Your Slide</h1>
<p class="sub">Notes for certification · PollSlide Technologies LLC (Wyoming, USA) · help@pollslide.com</p>
${body}
<h2>LANGUAGES</h2>
<p>The listing is offered in English, Spanish (es-ES), German (de-DE), French (fr-FR), Portuguese (pt-PT) and Italian (it-IT). The add-in's own interface follows PowerPoint's display language (Office.context.displayLanguage) in those five languages and uses English for any other. The presenter's questions and answers are their own content and are shown as written.</p>
<div class="pb"></div><h2>WHAT YOU SHOULD SEE</h2>
${shots.map(([f, c]) => `<div class="shot"><img src="${img(f)}"><p>${esc(c)}</p></div>`).join('\n')}
</body></html>`;
const tmp = path.join(os.tmpdir(), 'ps-cert-notes.html'); fs.writeFileSync(tmp, html);
const out = path.join(D, 'certification-notes.pdf');
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=' + out, 'file://' + tmp], { stdio: 'ignore' });
fs.unlinkSync(tmp);
console.log('→', out, Math.round(fs.statSync(out).size / 1024) + ' KB');
