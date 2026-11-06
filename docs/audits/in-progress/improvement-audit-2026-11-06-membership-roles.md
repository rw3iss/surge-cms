# Audit 2026-11-06 — Membership, applications, programs, roles, invites

Scope: membership levels + self-service change, membership applications (programs, linking, hide price, rejection reason, notifications), role login routes, roles table, invites, and their admin/public UI (commits since f28ea8ae). Migrations used: **210** (211 unused).

| Status | Count |
|---|---|
| Applied | 33 (backend 11, frontend 22) |
| Planned / open | 6 (backend 3, frontend 3) + 1 skipped |
| Lead follow-up | 2 (L1 tidy-up, L2 CLAUDE.md) |

## Backend findings

### 1. Applications claimed by an UNPROVEN email (security)
- **Location:** `packages/api/src/services/membershipApplications.ts` `claimByVerifiedEmail` (called on every sign-in from `services/auth.ts` `authenticateWithEmail`); `accountForEmail` (program approval auto-link).
- **Problem:** the sign-in claim ran when `email_verified !== false`. `email_verified` is **true by default** for every account created while "Require new users to validate their email" is off (and for grandfathered/Patreon accounts). So anyone could register with another person's address, sign in, and have that person's account-less applications attached — and an approved program's role added. A program approval also auto-linked such an account.
- **Fix:** "proven" = `users.verified_at IS NOT NULL` (set by the verification link and by admin "mark verified") OR the account was created from an invite accepted for its own address (`user_invites`). `claimByVerifiedEmail(userId, email, { proven? })` checks it unless the caller passes its own proof. `accountForEmail().emailVerified` now means proven, so program approval no longer auto-links an unproven account (the admin links it by hand; message reworded). `matchedAccount.emailVerified` doc updated in the shared DTO.
- **Risk:** B · **Status:** applied (+ tests). Lead follow-up L1 is a tidy-up, not a blocker.

### 2. Reject / withdraw raced an approval that was charging the card
- **Location:** `membershipApplications.ts` `reject`, `withdraw`.
- **Problem:** approval claims the row (`approving_at`) and then charges Stripe; reject and the member's withdraw only checked `status = 'pending'`. A reject during the charge → card charged AND rejection emailed; the later approve then overwrote the status to approved.
- **Fix:** both UPDATEs are conditional on no live claim (same 5-minute window as `claimForApproval`); reject answers 409 "being approved by someone else", a named withdraw says "being approved right now". Withdraw also reads the level names in the same statement (was one query per row).
- **Risk:** A · **Status:** applied (+ tests).

### 3. Double click / two tabs created two Stripe subscriptions
- **Location:** `services/membership/change.ts` `change` / `confirm`, `approved.ts` `startApprovedMembership`.
- **Problem:** free → paid ran `settleOpenAttempts` then `createSubscription`; two concurrent calls both found nothing open and each created a subscription (two open invoices; the member pays one, the other lingers or is paid too). The member paying while an admin approves had the same race. Two concurrent `confirm`s both emailed "Your membership is active".
- **Fix:** new `services/membership/lock.ts` `withMembershipLock(userId, fn)` — a session-level `pg_try_advisory_lock` on a dedicated client (pattern of `printify/syncLock.ts`); the second call answers **409** at once. `change`, `confirm` and `startApprovedMembership` take it; internal `changeUnlocked` / `confirmUnlocked` are used by callers that already hold it (no self-deadlock).
- **Risk:** B · **Status:** applied (+ `lock.test.ts`).

### 4. Approval could bill the wrong Stripe customer
- **Location:** `services/membership/approved.ts`.
- **Problem:** the card is checked (at apply time) to be on ANY of the member's customers (`users.stripe_customer_id` or a subscription's), but approval created the subscription on `customerFor()` (latest subscription's customer). When they differ, Stripe refuses ("payment method not attached to customer") and the approval fails with a confusing card error.
- **Fix:** bill the customer the saved card is attached to (attach to `customerFor()` only when the card has none).
- **Risk:** A · **Status:** applied.

### 5. A charged approval stayed "approved, not started" → reappeared as an open offer
- **Location:** `membershipApplications.ts` `approveClaimed`; `services/membership/state.ts` `approvedOfferFor`.
- **Problem:** only the hide-price offer flow set `activated_at`. A normal approval left it NULL with no `offer_expires_at`; `approvedOfferFor` hides it only while a subscription to that level is live — after the membership lapsed the member saw an "approved offer" again and could re-buy an approval level without applying (`targetTier` treats an offer as approval).
- **Fix:** a charged approval sets `activated_at`; **migration 210** backfills older approved rows whose member got that level's subscription, and adds a partial index on `lower(contact_email) WHERE user_id IS NULL` (looked up on every verified sign-in and per anonymous submit).
- **Risk:** B · **Status:** applied.

### 6. Claiming a PROGRAM with its token checked it as a membership
- **Location:** `membershipApplications.ts` `attachCard`.
- **Problem:** the tier row was re-read with a short column list (no `role_only`, `role`), so `assertCanApply` ran the MEMBERSHIP rules: a member with a pending membership application could not claim a program application ("already have an application"), and "already part of" was never checked.
- **Fix:** one `TIER_COLUMNS` list shared by `loadTier` and `attachCard`.
- **Risk:** A · **Status:** applied (+ test).

### 7. Unique-index violations surfaced as 500s
- **Location:** `membershipApplications.ts` `attachCard`, `claim`, `linkToAccount`, `claimByVerifiedEmail`.
- **Problem:** moving `user_id` onto an account that already has a pending application of the same kind hit `uq_membership_applications_pending_*` → unhandled 23505 → 500 (claim link, admin Link). In `claimByVerifiedEmail` one such row aborted the whole loop (every later application stayed unclaimed). The claim UPDATEs were also not conditional on `user_id IS NULL`, so two accounts racing with the same token could both "win".
- **Fix:** shared `duplicatePending()` → 409 with the same wording as submit; claim UPDATEs are conditional (`user_id IS NULL` / `= me`) and refuse when 0 rows; `claimByVerifiedEmail` skips a second pending application for the same program and catches per row. Program applications claimed/linked while pending now mirror `users.approval_status = pending` (only memberships did).
- **Risk:** A · **Status:** applied (+ test).

### 8. Applicant name read by label regex in three places
- **Location:** `membershipApplications.ts` `applicationNotice`, `submit` (receipt), `approveProgram` (invite name).
- **Problem:** commit 021bc7df added `applicantName()` (contact-field aware: "First name" + "Last name", "Your name", a form's Contact field) for greetings, but the team notice, the receipt email and the program invite still matched `/^(full )?name$/` on the label — a form with "Your name" or first/last fields gave "Someone" / an empty greeting.
- **Fix:** all use `applicantName()`. Also dropped a redundant `hide_price` query in `submit` (already on the tier row).
- **Risk:** A · **Status:** applied.

### 9. Switching a level to/from a program with members or open applications
- **Location:** `services/subscriptionTiers.ts` `saveTier`.
- **Problem:** toggling "Add its role only" on a level with active subscribers left members billed on a "program", and pending rows kept a stale `membership_applications.program` (the one-pending indexes and `withdraw` read it, while approval reads the live `role_only`).
- **Fix:** `assertRoleOnlySwitchable`: refused (409) while the level has members (→ program) or open applications / unstarted offers (either way).
- **Risk:** B · **Status:** applied (+ test).

### 10. Deleting a role left pending invites granting it; login routes not refreshed
- **Location:** `subscriptionTiers.ts` `deleteRole`.
- **Problem:** a pending invite carrying the role would, on accept, create an account with a role that no longer exists (`extra_roles` has no FK). `deleteRole` also did not call `invalidateLoginRoutes()` (create/update did), so a deleted role's landing page stayed cached.
- **Fix:** refuse with "N pending invite(s) give this role — revoke them first"; invalidate the login-route cache.
- **Risk:** A · **Status:** applied (+ test).

### 11. Small cleanups
- `services/loginRoute.ts`: `loginRouteForUser` reuses `extraRolesOf` (duplicate query). — applied.
- `ROLES-AND-INVITES.md` still said "Ambassador" (renamed to Affiliate by migration 189). — applied.

### 12. Planned / not changed
- **Stripe price fetch per notice** — `applicationNotice` retrieves the Stripe price on every application (one call, best effort). Could read `priceDetails()` (cached). Low value; left.
- **`approval_status` for program rejections** — rejecting a program application sets the member's `users.approval_status = rejected` even when they are an active member. The column mirrors "the latest application"; a per-kind status would need a schema change. Planned (C): split into membership vs program status, or derive the Users filter from `membership_applications` directly.
- **Withdrawn offers are not emailed** — `withdrawOffer` tells nobody. Add a mail purpose `membership_offer_withdrawn` (touches the mail-purpose registry, shared). Planned.

## Frontend findings (packages/cms)

| # | Title | Location | Problem → Fix | Risk | Status |
|---|---|---|---|---|---|
| F1 | Unsafe "page after sign-in" redirect | `pages/Login.tsx` | Role route used as `` `/${route}` `` unchecked; `?redirect=/login…` looped. → pure `pages/loginTarget.ts` (`returnPathFrom`, `loginRoutePath`): refuses external, `//host`, backslash and `/login` targets, never yields `//` (+ `loginTarget.test.ts`). | A | applied |
| F2 | Invite fields snapped back | `pages/AcceptInvite.tsx` | `name() \|\| invite.name` restored a cleared field → `null` = untouched. | A | applied |
| F3 | Invite success claimed "signed in" | `AcceptInvite.tsx` | `signedIn:false` (other email → verify) ignored; Continue went to `/`. → "verify your email, then sign in"; signed in → the account's page after sign-in. | B | applied |
| F4 | Join read the prefill before settings loaded | `pages/Join.tsx` | Direct load skipped the "required" check and used up the prefill in the wrong flow. → one effect after settings arrive; double-submit guard; heading "Create Your Account" when a level was chosen. | B | applied |
| F5 | Signed-out apply to a priced level 401'd | `membership/MembershipApplication.tsx` | `signedIn` hard-coded → guest sent to "Add my card" (user-only endpoint, session-expired modal). → Done step with "add your card in your profile after sign-up". | B | applied |
| F6 | Apply modal had no focus trap | `MembershipApplication.tsx` | → `useFocusTrap`. | A | applied |
| F7 | Program `?apply=` blocked by a membership application | `membership/MembershipTierCards.tsx` | → one `blockedByPending()` rule for the effect, `choose()` and the disabled state (+ explaining title). | A | applied |
| F8 | Different pending/approved wording on /subscribe vs levels cards | `pages/Subscribe.tsx`, `MembershipLevels.tsx` | → shared `membership/MembershipNotices.tsx`. | A | applied |
| F9 | Levels block failed silently | `MembershipLevels.tsx` | → error line; a failed reload keeps the shown data. | A | applied |
| F10 | PriceChoice hidden-price check not reactive | `PriceChoice.tsx` | Early `return` → `<Show>`, so the price appears once approved. | A | applied |
| F11 | Sign-up showed "Pricing shared after approval" | `SubscriptionSignup.tsx` | → same rule as /subscribe (no price line). | A | applied |
| F12 | Sign-up stuck on the account form after a failed `finishOffer` | `SubscriptionSignup.tsx` | Retry failed with "email exists". → go to Submitted (its button retries), `untrack`, double-submit guard. | B | applied |
| F13 | Unclear payment / heading copy | `SubscriptionSignup.tsx` | → "then $X / month until you cancel"; subtitle fixed for approval levels. | A | applied |
| F14 | "Try again" sent the wrong price id | `profile/MembershipPanel.tsx` | Kept the current level's price → server refused. → `pickTier()` resets the price. | A | applied |
| F15 | Profile Membership blanked on every reload | `MembershipPanel.tsx`, `MembershipPrograms.tsx`, `admin/applications/UserApplicationsPanel.tsx` | → `resource.latest`; "Loading…" only on first load; Programs stay visible during their notice. | B | applied |
| F16 | Membership panel gaps | `MembershipPanel.tsx` | No confirmation on withdraw / card save; card save did not refresh auth (wall still said "Add my card"); Cancel did nothing without a Free level; chooser unnamed. → messages + `refreshUser`, cancel confirmation, `aria-label`. | A | applied |
| F17 | Programs could not be approved | `admin/applications/ReviewApplicationModal.tsx` | Approve disabled without account/card (programs need neither; server invites); showed card text. → `charges()` / `approveBlocked()`; blocked (with tooltip) only for an unproven matching account; note uses `CommitInput`. | B | applied |
| F18 | Editing a role dropped "inherit" for its sign-in page | `admin/settings/RoleManager.tsx` | `null` saved as `''` (homepage). → Toggle "Use the base role's page after sign-in" sends `null`; `CommitInput`; key/label required; busy/double-click guards; load error with Try again. | B | applied |
| F19 | Permission groups collapsed after every change | `admin/settings/PermissionsPanel.tsx` | Reload rebuilt groups; unhandled rejection on removing a role exception; fast clicks used stale data. → keep list + open groups during reload, one save per permission, `aria-pressed`, try/catch, busy delete. | B | applied |
| F20 | Tier modal flashed; program without role | `admin/subscriptions/TierModal.tsx` | Focus reload re-suspended. → `.latest`; a program requires a role; `CommitInput`; save guard. | B | applied |
| F21 | Memberships table wording | `SubscriptionTiersPanel.tsx` | Programs showed "— (no Stripe price)" and the role key. → "— (program, no price)", role name, busy delete, `.latest`. | A | applied |
| F22 | User membership panel | `admin/subscriptions/UserSubscriptionPanel.tsx` | Load error = "Loading…" forever; programs assignable as a membership. → error + Try again; programs left out; double-submit guard. | A | applied |
| F23 | Admin prices hard-code "$" | `SubscriptionTiersPanel.tsx` | `subscription_plans` has no currency column. Plan: add `currency` (copied from the Stripe price in `stripePriceFields`, new migration) to `SubscriptionTier`, then `formatMoney(cents, currency)`. | B | planned |
| F24 | Sign-up plan step uses its own cards | `SubscriptionSignup.tsx` | No current/pending/program states, unlike `MembershipTierCards`. Plan: `onChoose(tier, priceId)` override on `MembershipTierCards`, used by the Plan step — one card on all three surfaces. | C | planned |
| F25 | New-permission form updates per keystroke | `PermissionsPanel.tsx` | Local create form; harmless. | A | skipped (low value) |
| F26 | Programs list hides its own load errors | `MembershipPrograms.tsx` | Plan: track the error and show a retry line (hidden-when-empty stays). | C | planned |


## Lead follow-up

- **L1 (tidy-up for #1)** — `packages/api/src/services/auth.ts` `registerMember`: when `opts.verified` (invite to the same address), also set `verified_at = NOW()` in the INSERT (the address IS proven). The claim already treats an accepted same-address invite as proof, so this only makes `verified_at` truthful for later checks.
- **L2** — `CLAUDE.md` (Membership applications bullet): "claims via `claimByVerifiedEmail` on verified sign-in" → "on sign-in of an account whose address was PROVEN (`users.verified_at`)"; add "`change`/`confirm`/`startApprovedMembership` hold a per-member advisory lock (`services/membership/lock.ts`, 409 when busy)" and "migration 210: charged approvals set `activated_at`".

## Verification
- `cd packages/shared && npm run build` — ok.
- `cd packages/api && npx tsc --noEmit -p .` — clean in scope (only error: `services/social/analytics/read.ts`, another agent).
- `cd packages/api && npx vitest run` on `services/membership/lock.test.ts`, `membership.test.ts`, `membership.rules.test.ts`, `membershipApplications.test.ts` (+6 new tests), `membershipApplications.name.test.ts`, `subscriptionTiers.expiry.test.ts`, `subscriptionTiers.roles.test.ts` (new, 5), `userInvites.test.ts`, `payments.subscribe.test.ts`, `auth.login.test.ts` — 10 files, 65 tests passed.
- `cd packages/cms && npx tsc --noEmit -p .` — no errors in scope (remaining: known CampaignDonations/FormSubmissions; `pages/admin/social/analytics/digestFormat.ts`, another agent).
- `cd packages/cms && npx vitest run --config ../../config/cms/vitest.config.ts src/pages/loginTarget.test.ts src/utils/joinPrefill.test.ts src/utils/membershipAccess.test.ts src/hooks/useFocusTrap.test.ts` — 4 files, 16 tests passed.
- Migration 210 not run against a database here (idempotent UPDATE + `CREATE INDEX IF NOT EXISTS`).
- Not browser-tested (Stripe flows need a live account).
