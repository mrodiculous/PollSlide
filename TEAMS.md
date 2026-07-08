# PollSlide Teams — How the Plan & Workspace Infrastructure Works

The single reference for how paid plans, team workspaces, roles, invites, and
billing interact. Everything here is already built; file paths point at the
code that does it.

## Plans

| Plan | Key | Price (mo / yr) | Seats | Presentations | Participants | Polly AI / mo |
|---|---|---|---|---|---|---|
| Free | `free` | $0 | 1 | 3 | 25 | 5 |
| Pro | `pro` | $12 / $120 | 1 | ∞ | ∞ | 20 |
| Team Small | `team_small` | $39 / $384 | 5 | ∞ | ∞ | 100 |
| Team Large | `team_large` | $199 / $1,980 | 25 | ∞ | ∞ | 300 |

Source of truth for limits: `TIERS` in `presenter.html` (~line 951). Seat caps
are duplicated server-side in `api/team.js` (`SEATS`) because the client can be
tampered with. Legacy keys `team` → `team_small`, `white` → `team_large`
(`normalizeTier`).

**Only the owner pays.** Members never have their own Stripe subscription —
they inherit the workspace tier (see "Member joins" below).

## Data model (Firebase RTDB)

```
workspaces/<wsId> = {
  name, ownerUid, tier, createdAt,
  members:  { <uid>:      { email, role: owner|admin|member, joinedAt } },
  invites:  { <emailKey>: { email, role, invitedBy, createdAt } }
}
users/<uid>/workspaceId = <wsId>     ← each user belongs to at most ONE workspace
users/<uid>/tier        = plan key   ← written by Stripe webhook (owner) or invite acceptance (member)
team_invites/<emailKey> = { wsId, wsName, role, invitedBy, createdAt }
                                     ← global index so an invitee can find their invite at sign-in
```

`emailKey` = lowercased email with `.#$/[]@` replaced by `_` (RTDB-safe key).

## Lifecycle — how everything interacts

### 1. Owner buys a team plan
Website pricing CTA → app plan picker (`pickerCheckout` in `presenter.html`) →
`api/create-checkout.js` (Stripe Checkout, lookup keys `pollslide_<plan>_<cycle>`,
`firebase_uid` + `plan` stamped in metadata) → Stripe webhook
`api/stripe-webhook.js` on `checkout.session.completed` writes
`users/<uid>/tier` + sends upgrade/receipt emails.

### 2. Workspace creation (lazy — no setup step)
The first time a team-tier user opens **👥 Team admin** (user menu,
`openTeamPanel`), `loadOrCreateWorkspace()` creates
`workspaces/<wsId>` with them as `owner` and writes `users/<uid>/workspaceId`.
There is no separate "create a team" flow to support — it self-provisions.

### 3. Inviting members / assigning the local admin
Owner (or any admin) opens Team admin → enters an email → picks **Member** or
**Admin** → Send. The client calls `POST /api/team {action:'invite'}`;
`api/team.js` verifies the caller's Firebase ID token, checks their role and
the seat cap (members + pending invites ≤ seats), writes the invite to both
`workspaces/<wsId>/invites` and `team_invites/<emailKey>`, and **emails the
invitee** (`team_invite` template in `api/send-email.js`).

Two ways to give a team its "local admin":
- invite them with the **Admin** role from the start, or
- invite as member, then **Make admin** in the panel (`teamSetRole`).

### 4. Roles — who can do what

| Ability | Owner | Admin | Member |
|---|---|---|---|
| Use team-tier features (∞ presentations etc.) | ✓ | ✓ | ✓ |
| Invite members / revoke invites | ✓ | ✓ | — |
| Remove a member | ✓ | ✓ | — |
| Promote member → admin | ✓ | ✓ | — |
| Demote admin → member | ✓ | — | — |
| Be removed / demoted | never | by owner | by owner or admin |
| Pays the Stripe subscription | ✓ | — | — |

Enforced in `api/team.js` (`requireManager`, per-action checks) — the client
checks are cosmetic only.

### 5. Member joins (invite acceptance)
On every sign-in `presenter.html` runs `acceptPendingInvite()`:
`POST /api/team {action:'accept'}` looks up `team_invites/<emailKey of the
VERIFIED email>`, re-checks the seat cap, confirms the workspace-side invite
matches, then adds the member, sets `users/<uid>/workspaceId` and
`users/<uid>/tier = workspace tier`. This is why invitees "join automatically
the next time they sign in with this email" — no invite codes.

### 6. Removal — self-healing
Remove in the panel → member vanishes from `workspaces/<wsId>/members`. The
removed user's own record still says `workspaceId=<wsId>` until their next
sign-in, when `validateMembership()` notices they're gone, clears
`workspaceId`, and sets their tier to `free`. So removal takes effect on the
member's next session; presentations they created remain their own (content
lives under their uid, not the workspace).

### 7. Plan changes & cancellation (webhook → workspace sync)
`api/stripe-webhook.js` keeps everything in step via `syncWorkspaceTier()`:
whenever the **owner's** tier changes, the webhook also updates
`workspaces/<wsId>/tier` (which drives the seat cap in `api/team.js`) and
rewrites every member's `users/<uid>/tier`:
- upgrade `team_small → team_large`: members become `team_large`, cap 5 → 25;
- downgrade `team_large → team_small`: cap drops to 5. Members over the cap are
  NOT auto-removed — invites/joins are blocked until the owner trims the roster;
- cancel / downgrade to `free` or `pro`: workspace goes dormant and **all
  members drop to `free`** (they never inherit the owner's personal Pro).

## Enforcement layers (defense in depth)
1. **Client** (`presenter.html`): gates UI (Team admin only shows on team
   tiers), pre-validates invites — UX only.
2. **API** (`api/team.js`, Admin SDK): the real gate — token-verified caller,
   role checks, seat caps, invite/email match on acceptance.
3. **RTDB rules** (`database-rules.json` — the single canonical, deployed
   ruleset; the old `database-rules-workspaces.json` fragment is retired):
   read access limited to members, writes role-gated. Seat caps can't be
   expressed in rules (no `numChildren()`), which is why the API is
   authoritative. ⚠️ The client still contains a direct-write fallback for
   each mutation (used only if `/api/team` isn't deployed); once the API is
   confirmed live in prod, remove the `$uid === auth.uid` self-join clause
   from the `workspaces/$wsId/members/$uid` rule.

## Emails involved
- `team_invite` — invite notification (from `api/team.js`).
- `upgrade` + `receipt` — after checkout (webhook).
- `payment_failed` / `downgrade` — billing lifecycle (webhook).
All sent via `api/send-email.js` (Resend; `RESEND_API_KEY`, `FROM_EMAIL`).

## Ops runbook
- **Set a team up manually** (comp/testing, no Stripe): `admin.html` → tier
  override to `team_small`/`team_large`; the user opens Team admin once to
  self-provision the workspace, then invites their own admin/members.
- **Env needed** (Vercel): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
  `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_URL`, `NEXT_PUBLIC_APP_URL`,
  `RESEND_API_KEY`, `INTERNAL_API_KEY` (shared secret for server→server calls
  to `/api/send-email` — invite emails skip silently without it), plus Stripe
  keys for billing.
- **Known limits (by design, revisit when needed):** one workspace per user
  (an invitee who owns a workspace and accepts an invite gets their
  `workspaceId` overwritten); no ownership transfer; no workspace rename UI;
  over-cap members after a downgrade must be trimmed manually.
