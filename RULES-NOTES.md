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

## `admin/tickets` — who may write a support ticket (2026-09-15)

**Was** `".write": "auth != null"`: any signed-in account could rewrite any ticket —
forge a reply `from: 'admin'`, mark someone else's ticket resolved, change the email a
reply would be sent to — and Admin → Tickets rendered ticket text raw into `innerHTML`,
inside the one session with write access to the whole database. The panel now escapes
everything (see `tickets.js`); the rules now close the write side too.

**Now:**

| Who | May write |
|---|---|
| `help@pollslide.com` | everything under `admin/tickets` (granted at `tickets`, so it cascades) |
| the user who filed it | **create** `admin/tickets/$ticketId` once — only if `$ticketId` is `ticket_<digits>`, `uid` is their own, `email` is their token's email (or empty), `status` is `open`, and it carries no `replies`, `replied` or `awaiting` |
| the user who filed it | **append** `replies/$replyId` — a new key only, `from: 'user'`, non-empty `text` ≤ 5000 chars, no `by` / `emailedAt` / `emailError` |
| the user who filed it | set `status` to `'open'` (a follow-up re-opens), `awaiting` to `'admin'`, `lastUserReplyAt` to a number |
| anyone else | nothing |

Everything else on a ticket — the original message, `uid`, `email`, `replied`, `status:
'resolved'`, any admin reply — is the admin's alone. Deeper `.write` rules can only *add*
permissions, so the admin grant sits at `tickets` and the user grants sit on the specific
children; there is deliberately no `.validate` here, because `.validate` applies to the
admin too and would block the fields only the admin writes.

The user's own copy under `users/$uid/tickets` is unchanged (owner-writable, as the whole
`users/$uid` subtree is). Forging an "admin" reply there fools only yourself: the admin
panel reads `admin/tickets`.

`lastUserReplyAt` is in `.indexOn` because `api/watchdog.js` queries on it to page the
owner about follow-ups.

Evaluated — not grepped — by `scripts/tests/tickets.test.js`, which simulates the cascade
against these exact rule strings: ~35 allow/deny cases, and they fail against the old rule.
**Publish by hand** (Firebase Console → Realtime Database → Rules) — until then the live
database still has the old open rule, and a user follow-up works but so does everything
above.
