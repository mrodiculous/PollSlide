/* Tests for the literal scanner that scripts/qa-undefined.js is built on.
 *
 * The scanner exists because a regex version got nested template literals wrong and
 * produced 106 false positives — it blanked real code and exposed CSS, so definitions
 * disappeared and `var(--x)` inside a style string looked like a call to `var`.
 * These tests are mostly that bug and its neighbours.
 *
 * Run: node scripts/tests/blank-literals.test.js
 */
const path = require('path');
const { blankLiterals } = require(path.resolve(__dirname, '../lib/blank-literals.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => cond
  ? (pass++, console.log('  ✓ ' + name))
  : (fail++, console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')));

const keeps = (src, needle) => blankLiterals(src).includes(needle);
const hides = (src, needle) => !blankLiterals(src).includes(needle);

console.log('\nStructure is preserved so offsets still mean something');
const s1 = "const a = 'hello';\nfunction f(){}\n";
ok('same length', blankLiterals(s1).length === s1.length);
ok('same line count', blankLiterals(s1).split('\n').length === s1.split('\n').length);

console.log('\nOrdinary literals are hidden, code is kept');
ok('single quotes hidden',  hides("const a = 'toast(';", 'toast('));
ok('double quotes hidden',  hides('const a = "toast(";', 'toast('));
ok('the declaration survives', keeps("const a = 'x';", 'const a'));
ok('escaped quote does not end the string early',
   hides("const a = 'it\\'s toast(' ; b();", 'toast('));
ok('…and the code after it is still visible',
   keeps("const a = 'it\\'s toast(' ; realCall();", 'realCall('));

console.log('\nTemplate literals');
ok('template text hidden', hides('const a = `toast(`;', 'toast('));
ok('multi-line template hidden', hides('const a = `line1\ntoast(\nline3`;', 'toast('));
ok('code inside ${…} is KEPT — it really is code',
   keeps('const a = `x ${realCall()} y`;', 'realCall('));
ok('…while the text around it is hidden',
   hides('const a = `var(--x) ${realCall()} rgba(`;', 'var(--x)'));

console.log('\nNested templates — the bug that caused every false positive');
const nested = 'const html = `<div style="color:var(--accent)">${ items.map(i => `<b>${i}</b>`).join(``) }</div>`;\nfunction toast(m){}\ntoast(1);';
ok('the CSS inside the outer template is hidden', hides(nested, 'var(--accent)'));
ok('the inner template text is hidden too',       hides(nested, '<b>'));
ok('the code between them survives',              keeps(nested, 'items.map'));
ok('AND the function after it is still visible — this is what broke before',
   keeps(nested, 'function toast'), blankLiterals(nested));
ok('so its call site is still seen',              keeps(nested, 'toast(1)'));

const deep = 'const a = `${ `${ `${ x() }` }` }`;\nfunction after(){}';
ok('three levels deep still closes correctly', keeps(deep, 'function after'), blankLiterals(deep));
ok('…and the innermost call is still code',     keeps(deep, 'x()'));

const braces = 'const a = `${ (function(){ return {k:1}; })() }`;\nfunction after(){}';
ok('braces inside a ${…} hole do not close it early', keeps(braces, 'function after'));

console.log('\nComments');
ok('line comment hidden',  hides('// toast(\ncode();', 'toast('));
ok('block comment hidden', hides('/* toast( */ code();', 'toast('));
ok('code after a block comment survives', keeps('/* x */ code();', 'code('));
ok('a URL is not treated as a comment',
   keeps("const u = 1; http_x(); // real\nkeepMe();", 'keepMe('));
ok('a comment inside a string is not a comment',
   keeps("const a = '// not a comment'; keepMe();", 'keepMe('));

console.log('\nRegex literals');
ok('regex body hidden',            hides('const r = /toast\\(/; code();', 'toast'));
ok('code after a regex survives',  keeps('const r = /x/g; keepMe();', 'keepMe('));
ok('a character class containing / does not end it early',
   keeps('const r = /[/]/; keepMe();', 'keepMe('));
ok('division is not mistaken for a regex',
   keeps('const q = (a) / b; keepMe();', 'keepMe('));
ok('a regex after `return` is a regex',
   hides('function f(){ return /toast\\(/.test(s); }', 'toast'));
ok('an unterminated slash does not eat the file',
   keeps('const a = 1 / 2;\nfunction after(){}', 'function after'));

/* Found by running this on the real answer.html: identifiers were coming back with
 * their first character missing (".replace(" read as "eplace("), because the output
 * buffer was built with Array.from — code POINTS — while every index came from
 * src[j] — code UNITS. One emoji puts the two permanently out of step. These pages
 * are full of emoji, so this was not a corner case; it was most of the file. */
/* Also found on the real answer.html. These pages build HTML inside templates, so
 * template text is full of `"` and `//` — and when quotes and comments were checked
 * BEFORE template text, each attribute quote flipped the scanner into string mode and
 * it never recovered. It blanked `function pickStudent` and most of the file after it. */
console.log('\nQuotes and slashes inside template text are text, not code');
const htmlish = 'const h = `<p style="color:red" class=\'x\'>${name}</p>`;\nfunction afterHtml(){}';
ok('the definition after an HTML template survives', keeps(htmlish, 'function afterHtml'), blankLiterals(htmlish));
ok('the attribute text is still hidden', hides(htmlish, 'color:red'));
ok('the ${…} hole is still code',        keeps(htmlish, '${name}'));
const urlish = 'const u = `see https://x.test/a for more`;\nfunction afterUrl(){}';
ok('a // inside template text is not a comment', keeps(urlish, 'function afterUrl'));
const apos = 'const m = `Not on the list? Ask your teacher.`;\nfunction afterApos(){}';
ok('an apostrophe-free sentence is fine',        keeps(apos, 'function afterApos'));
const apos2 = "const m = `Don't worry — it's fine`;\nfunction afterApos2(){}";
ok('an apostrophe inside template text is not a string', keeps(apos2, 'function afterApos2'), blankLiterals(apos2));
const nestedAttr = 'const h = `<div style="a:${v}">${t(\'k\',\'Not on the list?\')}</div>`;\nfunction afterMix(){}';
ok('quotes in text AND a call in a hole together', keeps(nestedAttr, 'function afterMix'), blankLiterals(nestedAttr));
ok('…and the call in the hole is seen',            keeps(nestedAttr, 't('));

console.log('\nAstral characters do not shift the blanking');
const emoji = "const a = '📋 clipboard'; el.replace(x); const b = '🎉'; el.includes(y);";
ok('an identifier after an emoji string keeps its head',
   keeps(emoji, '.replace(x)'), blankLiterals(emoji));
ok('…and so does one after two of them',
   keeps(emoji, '.includes(y)'), blankLiterals(emoji));
ok('the emoji string content is still hidden', hides(emoji, 'clipboard'));
ok('length is preserved with astral characters',
   blankLiterals(emoji).length === emoji.length);
const emojiFn = "const t = '✓ done — ok…'; function afterEmoji(){}";
ok('a definition after emoji is still visible', keeps(emojiFn, 'function afterEmoji'));

console.log('\nDegenerate input');
ok('empty', blankLiterals('') === '');
ok('unterminated string stops at the newline',
   keeps("const a = 'oops\nfunction after(){}", 'function after'));
ok('unterminated template does not throw',
   typeof blankLiterals('const a = `oops') === 'string');
ok('unterminated block comment does not throw',
   typeof blankLiterals('/* oops') === 'string');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
