# database-rules.json — notes

The rules file itself carries **no comments**. Firebase's rules parser accepts only
`.read`, `.write`, `.validate` and `.indexOn` as dot-keys — a `".comment"` is valid
JSON but is rejected on paste with a message that points at a line number and says
`Expected '{'`, which does not obviously mean "you used a key I don't know". So the
explanations live here.

Checked automatically by `scripts/qa-rules.js`, which runs as part of `node scripts/qa.js`.

## How to publish

Firebase Console → Realtime Database → **Rules** → select all → paste
`database-rules.json` → **Publish**.

Nothing under a node is readable or writable until a rule says so — RTDB is
default-deny — so a new feature that writes to a new path silently fails until this is
published.

---

## `users/$uid/classes` — where student secrets live

Student PIN hashes are at `users/$uid/classes/$classId/students/$studentId/pinHash`,
and issued codes at `…/code`.

**RTDB rules cascade DOWNWARD and cannot be revoked by a descendant.** A `".read": false`
on `classes` would be inert: the `.read` grant on `users/$uid` already applies to
everything beneath it. Adding one would look like a security control while doing
nothing — worse than leaving it out, because the next person would trust it.

The real boundary is twofold:

1. The subtree is **owner-only** — only the teacher who owns the account, and the
   admin address, can read it.
2. The hash and the code are **never published to `quiz_builder`**, which is the node
   the audience can read. `quiz_builder/$code` gets only first-name-plus-initial and
   the verification *mode*.

`api/student-claim.js` (Admin SDK, which bypasses rules entirely) does the comparison
server-side. The browser never sees either secret.

## `sessions/$sessionCode/attempts` — retake history

Added Aug 2026 with second attempts. World-writable in the same way as `responses`,
because an anonymous student on a phone has to be able to write their own answer.

`responses/$qid/$pid` remains **the answer that counts**; `attempts/$qid/$pid/$n` is
the history beside it. Losing a history write is survivable and never fails a
submission — see the comment in `answer.html`'s submit path.

## `presentations` and `shares` are `false` / `false`

Deliberate. Both are legacy or server-only nodes; all real access goes through
`users/$uid/presentations` and the Admin SDK. Leaving them explicitly denied is
clearer than deleting them, which would look like an oversight.
