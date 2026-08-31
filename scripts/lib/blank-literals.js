/* Blank out every string, template, comment and regex literal in JS source, keeping
 * the file's exact length and line structure so offsets still line up.
 *
 * WHY A SCANNER AND NOT A REGEX
 * The obvious `/`(?:\\.|[^`\\])*`/g` for template literals is wrong the moment one
 * template contains another inside `${…}` — the match ends at the INNER backtick, and
 * every literal after that is off by one. The result is worse than useless: real code
 * gets blanked (so definitions vanish) while CSS inside strings gets exposed (so
 * `var(--x)` looks like a call to a function named `var`). A first attempt at the
 * caller of this file reported 106 problems, every one of them false, for exactly
 * this reason.
 *
 * Nesting is a stack, so it needs a stack. This is about sixty lines and is right.
 */

/* Deciding whether `/` opens a regex or means division is the one genuinely ambiguous
 * bit of JS lexing. The standard heuristic: a regex can only START where a value
 * cannot have just ended. Getting it wrong costs us one mis-scanned literal, never
 * a wrong verdict about a whole file. */
const VALUE_ENDERS = /[\w$)\]]$/;
const KEYWORD_BEFORE_REGEX = /\b(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function blankLiterals(src) {
  /* split(''), NOT Array.from(). Array.from splits by CODE POINT, but every index in
   * this scanner comes from src[j], which is a UTF-16 CODE UNIT. One emoji — and these
   * pages are full of them — is two code units but one code point, so the two index
   * spaces drift apart and every blank after the first emoji lands short of its
   * target, chopping the head off real identifiers while leaving literal text exposed. */
  const out = src.split('');
  const n = src.length;
  // Each template literal we are inside pushes a frame; `${` inside one pushes a
  // brace depth we must unwind before the template can close.
  const templates = [];
  let i = 0;
  let lastSignificant = '';          // last non-space char of real code, for the regex test
  let lastWord = '';

  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  while (i < n) {
    const c = src[i], c2 = src[i + 1];

    /* ---- template literals, with ${ } holes that contain real code ----
     * This is FIRST, and the order matters twice over.
     *
     * Before comments and strings: inside template TEXT, a quote or a slash is just
     * text. These pages build HTML in templates, so that text is full of
     * `<p style="…">` and `http://` — and treating those quotes as string delimiters
     * puts the scanner permanently out of phase with reality. That is what blanked
     * `function pickStudent` and about half of answer.html with it.
     *
     * Before the opening-backtick branch: `` (an empty template, e.g. .join(``))
     * leaves i on the CLOSING backtick, and opening a second frame there means the
     * stack never unwinds. */
    if (templates.length && templates[templates.length - 1].braces === 0) {
      // Inside template TEXT (not inside a ${…} hole): blank until ` or ${
      const top = templates[templates.length - 1];
      let j = i;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') break;
        j++;
      }
      blank(i, j);
      if (j >= n) { i = n; break; }
      if (src[j] === '`') { templates.pop(); i = j + 1; lastSignificant = '`'; lastWord = ''; continue; }
      top.braces = 1;                 // entered ${ … }
      i = j + 2; continue;            // the code inside is scanned normally
    }
    // ---- comments ----
    if (c === '/' && c2 === '/') {
      let j = i; while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n); blank(i, j); i = j; continue;
    }

    // ---- quoted strings ----
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c || src[j] === '\n') break;      // unterminated at EOL: stop, don't run away
        j++;
      }
      blank(i + 1, j); i = Math.min(j + 1, n);
      lastSignificant = c; lastWord = ''; continue;
    }

    if (c === '`') {                  // opens a template (we are not inside one's text)
      templates.push({ braces: 0 });
      i++; lastSignificant = '`'; lastWord = '';
      continue;
    }
    if (templates.length && templates[templates.length - 1].braces > 0) {
      const top = templates[templates.length - 1];
      if (c === '{') top.braces++;
      else if (c === '}') { top.braces--; if (top.braces === 0) { i++; continue; } }
    }

    // ---- regex literals ----
    if (c === '/') {
      const canBeRegex = !(VALUE_ENDERS.test(lastSignificant) && !KEYWORD_BEFORE_REGEX.test(lastWord));
      if (canBeRegex) {
        let j = i + 1, inClass = false, ok = false;
        while (j < n) {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '\n') break;                 // regexes don't span lines — it was division
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) { ok = true; break; }
          j++;
        }
        if (ok) {
          while (j + 1 < n && /[dgimsuvy]/.test(src[j + 1])) j++;   // flags
          blank(i + 1, j); i = j + 1;
          lastSignificant = '/'; lastWord = ''; continue;
        }
      }
    }

    if (!/\s/.test(c)) {
      lastSignificant = c;
      lastWord = /[\w$]/.test(c) ? (lastWord + c) : '';
    }
    i++;
  }
  return out.join('');
}

module.exports = { blankLiterals };
