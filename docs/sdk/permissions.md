# Permissions in a backend module

Permissions sit **on top of** roles. A route keeps its auth tier
(`staff`, `admin`, …) as the floor; a permission narrows who may act within it.
They do not replace the tier, and removing the tier in favour of a permission
would drop the authentication requirement entirely.

## The rule

```
sysadmin  →  user grant  →  role grant  →  the permission's own default
```

Most specific wins at every step, which is what lets a per-user DENY override a
role that allows.

Two properties are deliberate and load-bearing:

- **A sysadmin always passes.** Otherwise an admin could revoke
  `permissions:manage` and leave the site administrable only by hand-editing
  the database.
- **An unknown key DENIES.** A typo in a guard fails closed. The alternative —
  unknown means allowed — turns a misspelling into an open route.

## Declaring one

`packages/api/src/services/permissions/catalog.ts`:

```ts
FEATURE_PERMISSIONS.recipes = [
  { key: 'recipes:read',  feature: 'recipes', label: 'View recipes',
    action: 'read',  defaultRoles: ['editor', 'admin', 'sysadmin'] },
  { key: 'recipes:write', feature: 'recipes', label: 'Create and edit recipes',
    action: 'write', defaultRoles: ['editor', 'admin', 'sysadmin'] },
  { key: 'recipes:publish', feature: 'recipes', label: 'Publish a recipe',
    description: 'Move a recipe from draft to published.',
    action: 'publish', defaultRoles: ['admin', 'sysadmin'] },
];
```

Key format is `feature:action`. Use a dotted feature for a sub-area
(`shop.orders:refund`).

**Choose defaults that preserve today's behaviour.** A new permission that
silently takes access away from existing users is a regression. Tightening is
the operator's decision, made in Settings → Permissions.

Registration is idempotent and runs at boot for enabled features. It refreshes
the label/description from code but **never overwrites an operator's edited
rule** — otherwise every deploy would quietly undo their policy.

## Checking one

```ts
import { can, requirePermission } from '../services/permissions';

// In a route handler — throws 403 with a readable message.
await requirePermission({ id: user?.id, role: user?.role }, 'recipes:write');

// Branching instead of throwing.
if (await can(subject, 'recipes:publish')) { … }
```

Other helpers:

- `check(subject, key)` → `{ allowed, reason }`, where `reason` names the rule
  that decided it (`user-deny`, `default-role`, `sysadmin-bypass`, …). Use it
  when you need to explain a decision, not just enforce it.
- `permissionsFor(subject)` → every key's answer, for a UI that hides controls.

Never hand-roll `role === 'admin'` next to a permission — two sources of truth
for one question is how a policy starts disagreeing with itself.

## From the client

```ts
const mine = await cms.permissions.mine();   // { 'recipes:write': true, … }
if (mine['recipes:write']) showEditButton();
```

`/permissions/me` is `user`-tier on purpose: asking about your own access is not
privileged, and the UI needs it on every load.

Hiding a button is **not** enforcement. The server check is the boundary; the
client check is courtesy.

## Where the data lives

- `permissions` — the catalog plus each key's own default rule
- `permission_grants` — only the EXCEPTIONS (a specific user or role,
  allowed or denied)

The default living on the permission is what keeps the grants table small: "all
staff may do this" costs zero rows. `granted` is a boolean rather than
row-existence, because revoking one person's access to something their role
allows has to be representable.

## Admin

- **Settings → Permissions** — the catalog grouped by feature; edit the default
  rule, toggle roles, see exceptions, create hand-made permissions.
- **Users → Manage** — one user's resolved answers, labelled by source (role
  versus this user), with Allow / Deny / Reset.
