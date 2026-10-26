# Role routing, role admin shells, contributors, affiliates + discount codes — plan

> **STATUS 2026-10-26 — IN PROGRESS.** Approved; building in the phase order below.

## Where we start (facts that shape the design)

| Fact | Consequence |
|---|---|
| Program approval adds the role to `users.extra_roles` (main role stays member/subscriber) | "Route by MAIN role" would never fire for a subscriber who becomes a contributor → routing must consider **all** roles (main + extra) with a priority. |
| The admin shell is gated by `isStaffRole` (`AdminLayout.tsx`), and every content route uses the `staff` auth tier | A contributor (member-level base) cannot open `/admin` or call `/posts` writes today. Needs a deliberate "non-staff shell" path, not just a permission tweak. |
| Permissions = catalog keys + role/tier/user grants, default roles; no "own records" scope except ad-hoc `*_own` keys | "Own posts only" and "needs approval" must be modelled. |
| Posts: `status` draft/published/archived (+ scheduled/deleted in SQL), `authorId` = staff user | Needs a `pending_review` state and a non-staff author. |
| Shop checkout prices every line server-side (`previewCheckout` / `createCheckout`, one PaymentIntent) | Discounts slot in at the totals step; Stripe Tax recomputes on the discounted amounts. |
| No Stripe Connect, no discount codes yet | Both are new modules. |

## Recommendations (the short version)

1. **Role routing** — add `roles.login_route` (+ `login_priority`) and resolve the destination over ALL the user's roles. Simple, data-driven, no new concepts.
2. **Admin shell per role** — **do NOT invent a second permission system.** Keep permissions as the single source of truth for *what you may do*, and add a small **role shell config** for *what you see* (nav items, dashboard view). Nav items are additionally filtered by permission, so a misconfigured shell can never expose an action the role cannot perform.
3. **"Requires approval"** — model it as a **permission mode**, not a flag on the shell: a grant can be `allow` | `approval` | `deny`. `posts:publish` granted to `contributor` in `approval` mode = "can submit; an admin publishes". This keeps it in the existing grant UI and precedence rules.
4. **Own records** — add an **ownership scope** to the content permissions instead of new parallel keys: `posts:write` + `posts:read` evaluate as `any` for staff and `own` for a role granted the `.own` variant (`posts:write_own`, `posts:read_own`). Server enforces with `author_id = viewer` in SQL.
5. **Affiliates** — a self-contained **feature module `affiliates`** (requires `shop`), its own tables/service/routes/SDK namespace, a profile tab on the public site, an admin page under Shop. Payouts via **Stripe Connect Express**.
6. **Discount codes** — a **generic `shop_discount_codes` engine** (the code + rules + usage); an affiliate code is just a discount code with an `affiliate_user_id` + commission %. One engine, one checkout hook, two admin views.

---

## Phase 1 — Role routing (small, ship first)

**DB (migration 189):** `roles.login_route TEXT NULL` (path WITHOUT leading slash; `''` = homepage), `roles.login_priority INT NOT NULL DEFAULT 0`. Seed: `admin`, `sysadmin`, `editor` → `admin` (priority 100); `contributor` → `admin` (50); `ambassador` (the affiliate role) → `profile?tab=affiliate` (40); everyone else NULL (= inherit base role, finally homepage).

**Rule (`@sitesurge/types` `utils/loginRoute.ts`, one function used by server + SPA):**
`loginRouteFor(roles: RoleRow[], userRoleKeys: string[])` → among the user's main + extra roles (each resolved through its base chain for an unset route), pick the route of the role with the highest `login_priority`; ties → main role first. Normalised: trim, strip leading `/`, refuse `//`, `http:`, `javascript:` (internal paths only).

**Wire-up:** `GET /auth/me` + login responses carry `loginRoute`. `Login.tsx` `afterLogin()` → `?redirect=` wins, else `/${loginRoute}`. Admin **Settings → Permissions → Roles**: "Default page after sign-in" text field (strip `/` on blur, hint "empty = homepage") + priority number.

**Tests:** rule unit tests (priority, base inheritance, sanitising), login redirect.

> **STATUS 2026-10-26 — DONE.** Migration 189 (+ `ambassador` → `affiliate` rename), `loginRouteFor` + tests, `services/loginRoute.ts`, `loginRoute` on login + `/auth/me`, Login redirect, Roles editor (built-ins: route only). Docs: ROLES-AND-INVITES.md, CLAUDE.md.

## Phase 2 — Permission modes + ownership (foundation for contributors)

**Grant mode** (migration 190): `permission_grants.mode TEXT NOT NULL DEFAULT 'allow'` CHECK `allow|approval` (deny keeps its existing representation). `check(subject, key)` returns `{ allowed, mode, reason }`; `can()` stays boolean (`approval` counts as allowed to *attempt*). New helper `requirePermission(subject, key, { allowApproval: true })` → returns the mode so the service can route the write to "pending".

**Ownership:** new catalog keys `posts:read_own`, `posts:write_own`, `posts:delete_own` (default: none). A service helper `postScope(subject)` → `'any'` (has `posts:read`) | `'own'` (has only `_own`) | `null`. List/get/update/delete add `author_id = $viewer` when `'own'`. Generic enough to reuse for pages/events later.

**Admin UI:** the Permissions grid gets a mode selector on a role grant (Allow / Requires approval). Help doc `docs/sdk/permissions.md` + `/admin/help/sdk/permissions`.

> **STATUS 2026-10-26 — DONE.** Migration 190 (`permission_grants.mode`), `approval` on `PermissionCheck`, `checkMode`, `scopeFor`, `posts:read_own|write_own|delete_own` (default role `contributor`), grant route + SDK `mode`, Permissions panel "+ Role exception" (Allow / Requires approval / Deny), tests, docs/sdk/permissions.md + in-admin help.

## Phase 3 — Role admin shells (config) + per-role dashboards

**Config (code-first, not DB):** `packages/cms/src/admin/shells/` — a registry:

```ts
// admin/shells/types.ts
export interface AdminShellConfig {
  /** Nav item ids shown (Dashboard is always shown); omitted = every item the role can use. */
  nav?: string[];
  /** Dashboard view id → `admin/dashboards/<id>.tsx`; missing/unknown → `default`. */
  dashboard?: string;
  /** Extra links in the sidebar footer (e.g. "View my profile"). */
  links?: { label: string; href: string; }[];
}
// admin/shells/index.ts
export const ROLE_SHELLS: Record<string, AdminShellConfig> = {
  contributor: { nav: ['posts'], dashboard: 'contributor', },
};
```

Resolution: the user's highest-priority role that HAS a shell (same priority as Phase 1), else the staff default. Each `NAV_ITEMS` entry gets an `id` + the permission it needs (`posts` → `posts:read` OR `posts:read_own`); the sidebar shows `shell.nav ∩ items the user may use`. Kept in code because a shell references components; a later step can store the `dashboard`/`nav` choice on `roles` (`roles.admin_shell JSONB`) and pick from the registry in the Roles UI — the registry stays the list of valid values.

**Dashboards:** move `pages/admin/Dashboard.tsx` → `admin/dashboards/default.tsx`; `admin/dashboards/index.ts` maps id → `lazy(import)`; `Dashboard` route renders the shell's view (fallback `default`). New `admin/dashboards/contributor.tsx`: "My posts" (drafts / pending review / published counts), "Write a new post", recent feedback.

**Who may enter the shell:** `AdminLayout` gate changes from `isStaffRole(role)` to `isStaffRole(role) || hasAdminShell(user)` (a role with a shell). Server side, admin routes stay `staff` EXCEPT the ones a shell needs, which move to `user` tier + permission (`posts` list/get/create/update/delete + post block CRUD + media upload for their own images). Every other admin route keeps `staff`, so entering the shell grants nothing by itself.

> **STATUS 2026-10-26 — DONE.** `admin/shells` (ROLE_SHELLS, adminShellFor, canEnterAdmin) + `admin/dashboards` (DASHBOARDS, RoleDashboard, ContributorDashboard). The staff dashboard stays at `pages/admin/Dashboard.tsx` and is registered as `default` (moving the file bought nothing). Nav items got ids + permissions; AdminLayout gate = staff or a shell; shell users are kept to their paths; presence/search hidden for them. Shells stay code-only (no `roles.admin_shell` column yet).

## Phase 4 — Contributors

- **Post status `pending_review`** (migration 191; add to `PostStatus` + route enums). A save with `posts:publish` in `approval` mode turns "Publish" into **Submit for review** → `pending_review`; `submitted_at`, `reviewed_by`, `review_note` columns.
- **Author:** a contributor is the post's `author_id` (relax "authors are staff": `GET /users/authors` adds users holding `posts:write_own`).
- **Grants** (seed for `contributor`): `posts:read_own`, `posts:write_own`, `posts:delete_own` (drafts only), `posts:publish` in **approval** mode, `media:write` limited to own uploads (new `media:write_own`, `media.created_by`).
- **Admin review:** `/admin/posts` gets a **Pending review** filter + badge (count in the sidebar like comment moderation); the post editor shows **Approve & publish** / **Return with note** for reviewers (`posts:publish` allow). Mail purposes `post_submitted_admin` (team) and `post_review_result` (author: published / returned with note).
- **Guardrails:** contributors can't set post type `live`, featured/SEO-sensitive fields stay editable but gated content options (`required_tier_id`, gate) are staff-only; content goes through the existing sanitiser; rate limit on submissions.

> **STATUS 2026-10-26 — DONE.** Migration 191 (`pending_review`, review columns, contributor `posts:publish` approval grant); new auth tier `userOrKey`; `services/postAccess.ts` + tests; posts/media/authors routes opened with permission checks (media checked before multer); `services/postReview.ts` + `POST /posts/:id/review` + SDK `cms.posts.review`; notification `post_submitted`, mail purposes `post_submitted_admin` / `post_review_result` (Posts → Settings → Email templates); editor: Submit for review, reviewer box, returned note, staff-only fields hidden; Posts list filter + sidebar badge; `media:read_own`/`media:write_own`; `/users/authors` includes contributors. Guide: CONTRIBUTORS-AND-ROLE-SHELLS.md.
> **Correction 2026-10-26:** "requires approval" first applied only to own-scope writers; production had `contributor` in the `posts:write` DEFAULT roles (full scope), so a contributor published directly in the e2e test. Fixed: `shapeStatus` applies the `posts:publish` mode to EVERY writer (any scope, staff included; API keys exempt), and `posts:write` defaults were set back to staff on production. Also fixed: the login response now carries `extraRoles`, so the admin shell resolves right after sign-in. Verified on production with a temporary contributor account (landed on /admin, Dashboard + Posts only, submit → pending_review + badge + review box, other posts 404, staff routes 403).

## Phase 5 — Discount codes (generic engine, `shop`)

**Tables (migration 192, `-- @feature shop`):**
- `shop_discount_codes`: `id, code (unique on lower(code)), kind ('percent'|'fixed'), amount (percent 0–100 or cents), active, starts_at, ends_at, max_uses NULL, max_uses_per_user NULL, min_subtotal_cents NULL, allowed_tier_ids UUID[] (membership levels; empty = anyone), allowed_roles TEXT[], applies_to ('order'|'merch'), affiliate_user_id UUID NULL REFERENCES users, commission_percent NUMERIC(5,2) NULL, note, created_by, created_at, updated_at, deleted_at`.
- `shop_discount_redemptions`: `id, code_id, order_id UNIQUE per code, user_id NULL, email, discount_cents, commission_cents, created_at` — **the usage count is COUNT of paid redemptions**, never a mutable counter.

**Checkout:** `previewCheckout`/`createCheckout` take `discountCode`; `services/shop/discounts.ts` validates (active, window, uses left — counted under `FOR UPDATE` on the code row at create, viewer's tier/roles, min subtotal) and returns a line `{ code, discountCents }`; `orderTotalsLines` gains a Discount line (one totals definition everywhere: storefront, admin, emails, PDF). Tax is computed after the discount. The redemption row is written in `fulfillShopOrder` (paid), so abandoned checkouts never consume a use. Event-ticket groups excluded unless `applies_to='order'`.

**Admin:** Shop → **Discount codes** page (list: code, discount, uses / max, status, restrictions; create/edit modal; enable/disable/delete). Storefront: "Discount code" field on checkout step 1 with live validation.

**Permissions:** `shop.discounts:manage` (admin), `shop.discounts:use` (everyone — narrowed by each code's tier/role rules).

## Phase 6 — Affiliates (feature module `affiliates`, requires `shop`)

**Enable:** Shop Settings → **Affiliate program**: switch "Enable affiliate program" (hint: "Lets users with the chosen role get affiliate codes, see their sales and get paid out") + **Affiliate role** select (default `ambassador`). Registered as feature `affiliates` (`requires: ['shop']`) so its routes 404 and its tables are owned/uninstallable like any module.

**Data (migration 193, `-- @feature affiliates`):**
- `affiliate_accounts`: `user_id PK, stripe_account_id, payouts_enabled, details_submitted, payout_share_percent NUMERIC DEFAULT 100` (how much of their commission they keep vs. pass to buyers as extra discount — see below), `display_name, created_at, updated_at`.
- Codes = `shop_discount_codes` rows with `affiliate_user_id` + `commission_percent` (default 10, 0–100), `max_uses` optional.
- `affiliate_earnings`: one row per paid redemption: `code_id, order_id, user_id, commission_cents, status ('pending'|'available'|'paid'|'reversed'), available_at (order paid + refund window, e.g. 30 days), payout_id`.
- `affiliate_payouts`: `id, user_id, amount_cents, stripe_transfer_id, status, created_at`.

**Commission maths:** commission is `commission_percent` × the order's merchandise subtotal **after** discount, excluding shipping/tax. A refund reverses the earning (`reversed`, or a negative adjustment if already paid).

**Affiliate-chosen discount ("keep 100% or share"):** per code the affiliate may set `buyer_discount_percent` ≤ their `commission_percent`; the buyer discount comes out of the commission (`commission = (commission_percent − buyer_discount_percent) × subtotal`). The admin sets the ceiling; the affiliate chooses the split on their page.

**Stripe Connect Express:** `POST /affiliates/me/stripe/onboard` → `accounts.create({ type: 'express' })` (once) + `accountLinks.create` → redirect; `account.updated` webhook updates `payouts_enabled`; `POST /affiliates/me/stripe/dashboard` → login link. **Payouts:** admin "Pay out" (or a monthly cron later) → `transfers.create` of the available balance to the connected account (from the shop's Stripe account; platform balance must cover it). Needs Connect enabled on the shop Stripe account.

**Affiliate page (public site):** Profile → **Affiliate program** tab (shown when the feature is on and the user has the affiliate role; Phase-1 login route `profile?tab=affiliate`): connect/status of the Stripe account, codes (copy link `/shop?code=XYZ`, uses, the split control), sales history (orders: date, subtotal, commission, status — no buyer PII), balance (pending / available / paid), payouts.

**Admin (Shop → Affiliates):** members with the affiliate role (+ their account status), per member: assign/disable/remove codes (commission %, max uses, uses so far), sales + earnings, "Pay out". Shop dashboard card: affiliate sales this month, commissions owed.

**Attribution:** `?code=` on any shop URL stores the code in the client cart (and a 30-day cookie); checkout pre-fills it. One code per order.

**Permissions:** `affiliates:manage` (admin), `affiliates:self` (the affiliate role, default) for the `/affiliates/me/*` routes.

## Phase order + rough size

| Phase | What | Size |
|---|---|---|
| 1 | Role login routes | S |
| 2 | Permission modes + ownership scope | M |
| 3 | Role admin shells + dashboards directory | M |
| 4 | Contributors (pending review, own posts, review UI, emails) | L |
| 5 | Discount codes engine + admin + checkout | L |
| 6 | Affiliates module (codes, earnings, Connect Express, pages) | XL |

1 → 2 → 3 → 4 is the contributor track; 5 → 6 is the affiliate track (6 needs 1 for its login route). The two tracks are independent after Phase 1.

## Decisions (2026-10-26)

1. The affiliate role key is **`affiliate`** — the seeded `ambassador` role is renamed (migration 189 moves every reference).
2. Payouts: a manual **Pay out** is always available, plus **automatic payouts on a configurable schedule** (off / weekly / every 2 weeks / monthly).
3. The refund window before a commission becomes payable is **configurable, default 30 days**.
4. A contributor **is the public author** of their post (byline + member page).
5. A discount code **always applies to shop merchandise**; each code has an option to **also apply to event tickets** (offered when Events is on).
