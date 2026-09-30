# Account support — standard procedures

For anyone answering help@pollslide.com. Each section is one kind of request: what the
customer can do themselves, and exactly what we do when they can't.

**Tools:** Admin → **Accounts** (find, password reset, change email, move content, undo).
Every action there is logged under "Recent account changes" with who did it and why.
**Customer guide to send:** https://pollslide.com/account-help (includes a 2-minute video).

---

## 0. The one rule: prove it's them before changing anything

An email change or content move on request is the most common way accounts get stolen.
Anyone can email us claiming to be a teacher. **Before any change, get ONE of these:**

1. **The request comes from the account's current email address** (check the From: of the
   actual message, not a name or signature in the body). Best.
2. If they've lost that mailbox (left a school, etc.): **two** of —
   - the name and approximate date of a presentation in the account
   - the last 4 digits of the card on their Stripe subscription, or the date of their last invoice
   - the team name and owner's email, if they're in a team
   - a reply from the old address is impossible, *and* an IT admin at their school confirms
     from the school's domain

Write what you checked in the **"How you verified it's them"** box — Admin won't make the
change without it. If in doubt, don't: reply asking for more, and send them the self-service
guide instead.

---

## 1. "How do I change my password?"

**Self-service — reply with this:**
> Click your avatar (top right) → **⚙️ Account settings** → **Password**. Enter your current
> password and the new one. Forgotten the current one? Use **"Email me a reset link"** on the
> same page, or **"Forgot password?"** on the sign-in screen.
> Guide + video: https://pollslide.com/account-help

**Signs in with Google?** There is no PollSlide password — they change it in their Google
account (myaccount.google.com → Security).

**Reset email not arriving:** ask them to check spam/Promotions and search for
"noreply@echonest-live-survey.firebaseapp.com". Then Admin → Accounts → find them →
**Send password reset email**. Still nothing: their school may block it — ask their IT to
allow that sender, or move their content to a personal address (§5).

---

## 2. "How do I change my email address?"

**Self-service (email + password accounts) — reply with this:**
> Avatar → **⚙️ Account settings** → **Change email address**. Enter the new address and your
> current password, then open the new inbox and click the link we send. Your presentations,
> results and plan all stay. Guide + video: https://pollslide.com/account-help

What happens: the address only changes when they click the link at the NEW address; the OLD
address is told. On their next sign-in, team membership, waiting invites, waiting shared
decks and the billing email are all updated automatically.

**We do it for them** (they can't — e.g. lost the old mailbox, or can't receive the link):
1. Verify (§0). 2. Admin → Accounts → find by the OLD address → **Change their sign-in
email** → new address + how you verified → **Change email**. Both addresses are emailed.
They sign in with the new address and the **same password**.

**Won't work if** another account already uses the new address — that's §5.
**Google sign-in accounts:** the email comes from Google. Changing it in Admin does NOT change
their Google login. Usually the right answer is §5: they sign up with the new address, and we
move their content.

---

## 3. "I can't sign in / I'm locked out"

1. Which way do they sign in — Google or email + password? (Admin → Accounts shows it.)
   Many "locked out" cases are someone using the password box for a Google account.
2. Email + password: send a reset (§1).
3. "Too many attempts": sign-in is paused for a while after repeated wrong passwords — ask them to wait, then use a reset link.
4. Lost access to the email itself: verify (§0, option 2), then change the email (§2).
5. Admin → Accounts shows **DISABLED**: the sign-in was switched off in Firebase on purpose
   (abuse / moderation) — check the Compliance log before switching it back on in the Firebase console.

---

## 4. "Please delete my account" / "Send me my data"

**Self-service — reply with this:**
> Avatar → **⚙️ Account settings**. **Download my data** gives you everything (presentations,
> questions and answers). **Delete account** removes it permanently. A paid plan stops
> renewing — no further charges.

**We do it for them:** verify (§0), then Admin → Users → their detail → **⚠ Delete account**.
Deletion first sets any paid subscription to end at the close of the period already paid for
(no further charges, no partial refund — as the Terms say). If Stripe can't be reached,
nothing is deleted — try again. A team **member**'s seat is freed; a team **owner**'s team
ends with their plan, and members move to Free with all their work.

**Data request under GDPR/CCPA:** verify, then ask them to use Download my data, or run it
while viewing as them (Admin → Users → their detail → **View as this user**) and send the file. Reply within 30 days.

---

## 5. Moving everything to another account

Typical cases: left a school and wants their decks on a personal address; signed up twice
(once with Google, once with email) and wants one account; changing to an address that
already has an account.

1. Verify **both** accounts are theirs (§0 for each — ideally a message from each address).
2. The destination must have signed in at least once.
3. Admin → Accounts → **Move everything to another account** → FROM + TO → **Preview**.
   Read the preview with them in mind:
   - ✓ decks, folders, classes, trash, images and slideshow decks **move**. Decks keep their
     session codes, so QR codes on slides, results, reports and class sign-in keep working.
   - ⏸ **shared decks** ("Build it together") stay — the owner stops sharing, you move again,
     then they re-share from the new account.
   - **LoopSlide games** stay (they use the old account's TV slots) — recreate if needed.
   - **Plan / billing / AI credits / team membership do NOT move.** Plan: cancel in the old
     account's Billing and buy on the new one, or ask Stripe support to reassign; team:
     the owner invites the new address.
4. Type the verification in the box, type **MOVE**, **Move now**.
5. Tell them: sign in with the new account; everything is there. The old account can be
   deleted (§4) once they've checked.

**Mistake?** "Recent account changes" → **Undo** puts everything back (while nothing in the
new account has been edited in between).

---

## 6. Team owner is leaving

The team, its seats and the bill belong to the owner's account.
- Owner still reachable: they either **change their email** to a colleague's (§2 — the team
  and billing follow), or buy a new team plan on the colleague's account and invite members.
- Owner unreachable, school pays: verify with the school's IT (§0, option 2), then change the
  owner account's email to the new owner's address (§2). The Stripe billing email follows.

---

## 7. Things that are NOT support requests

- "Change my name" — the name shown to students is typed per session; nothing to change.
- A student asking about a teacher's account — never discuss another person's account.
- Someone asking which email a person used — never confirm whether an account exists.

---

*Tools and procedures introduced 2026-09-30. Code: `api/account.js`, `lib/account.js`,
`api/delete-account.js`; tests: `scripts/tests/account.test.js`.*
