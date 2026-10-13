# Additional roles, sign-in roles and invites (e.g. brand ambassadors)

## Two kinds of role on a user

| | Column | Set by | Changes when the membership changes? |
|---|---|---|---|
| **Main role** | `users.role` | the membership (Free → `member`, a paid level → its role, e.g. `subscriber`), or an admin | **yes** (`syncUserRole`) |
| **Additional roles** | `users.extra_roles` | an admin (User detail → Additional roles) or an **invite** | **no** |

So a person can pay for **Membership** (main role `subscriber`) and be an
**Ambassador** (additional role) at the same time; cancelling the membership
moves the main role back to `member` and keeps `ambassador`.

Permissions combine both: the main role's chain first, then each additional
role's chain (`permissions/subjects.enrich`). An explicit grant on the main role
decides first; role DEFAULTS consider every role. Grant ambassadors their own
abilities in Settings → Permissions (role `ambassador`). Additional roles are
member-level only — staff roles stay a main-role decision.

The Users table's Role filter matches the main role OR an additional role.

## Membership required + roles that may sign in anyway

Users → Settings → **"Roles that can sign in without a membership"**
(`users_settings.accessRoles`). When a membership is required, a member is let
in when they have a qualifying membership **or** any of these roles (main or
additional) — `subscriptionAccess.hasAccessRole`, `access.viaRole`.

Recommended for brand ambassadors: keep the minimum membership at the paid
level ("Membership or higher") and tick **Ambassador** here. Ambassadors then
sign in without paying; everyone else still needs a membership; an ambassador
who also subscribes simply has both.

Content gated by a membership TIER (posts, forum, events, live shows) still
follows the tier: an ambassador without a paid membership sees public content
plus whatever you grant the `ambassador` role.

## Invites

Users → **Invite**: email, optional name, roles (default Ambassador).

- The address **already has an account** → the roles are added to it now, and
  the `user_role_added` email tells them.
- Otherwise → an invite (`user_invites`) with a random token (only its SHA-256 is
  stored), valid **3 days**, and the `user_invite` email with `/invite/<token>`.
  Resend makes a new link (the old one stops working); Revoke cancels it. One
  live invite per address.
- `/invite/<token>`: the person sets name, email and password → the account is
  created through the normal member sign-up (handle, contact, notifications),
  the roles are added, they are signed in. The invited address counts as
  verified; a different address goes through normal email verification.

Both emails are editable in Users → Settings → Email templates
("Account invite", "Role added"). Permission: `users:invite` (admins).

API: `GET/POST /users/invites`, `POST /users/invites/:id/resend`,
`DELETE /users/invites/:id`, `GET /auth/invites/:token`,
`POST /auth/invites/:token/accept`; `PUT /users/:id { extraRoles }`.
SDK: `cms.users.invites / invite / resendInvite / revokeInvite`,
`cms.auth.invite / acceptInvite`.
