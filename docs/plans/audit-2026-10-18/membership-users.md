## membership-users

Scope: subscription tiers (TierModal, alternative prices / PriceChoice, hide price, Dev Only, custom display), membership applications (submit / claim / approve / offers), subscription-required mode + wall, roles / extra roles / developer role / invites, Users admin (bulk, pending pill, review modal), profile Membership tab, `/subscribe` + `/join` (`membershipChoice`), login access-denied messages, admin notification emails (`notifications/format.ts`, `subscriptionNotice`), the hidden-text removal in emails.

Window: `git log --since=2026-09-25`. The main commits are 3fe6a2d3, 93ac3bad, c51cdcd5, 93c55907, 2b532453, 1b6b2ce8, 1b553006, 502a1386, 3f35825c, b964a749, bd293198, 7fac160c, cb6deae2.

Read-only audit. I changed no source files. Line numbers are from `main` at 750f3aa8.

**Totals: 36 findings.** Security 7 (S1–S6, C14), correctness 9 (C1–C9), UI/UX 8, architecture/code 7 (A1–A6, C10), styling 2, feature gaps and docs 3 (C11–C13).
By phase: **A = 21**, **B = 9**, **C = 6**.

What is good: the new admin UI follows the house rules well. TierModal and ReviewApplicationModal commit text on blur and use `Toggle`/`FormField`. There are no raw checkboxes and no `!important`. Notification HTML escapes every value, and `settleOpenAttempts` has good test coverage. Most findings are in the server's membership/role rules and in copy that does not match the real state.

---

### 1. Security / authorization

#### S1 — Legacy `POST /payments/subscribe` bypasses approval, Dev Only, hide price and the minimum level
- **Location:** `packages/api/src/routes/payments.ts:97-102` → `packages/api/src/services/payments.ts:161-221`
- **Problem:** `subscribe(userId, planId)` checks only `is_active` and `stripe_price_id`. It does not call `membership.targetTier`. A signed-in member can `POST /payments/subscribe {planId}` (the published SDK `cms.payments.subscribe`) for a level that **requires approval**, a **Dev Only** level (often a token price), a **hide-price** level, or a level below the subscription-required minimum. When the first invoice is paid, the webhook marks the subscription active and `syncUserRole` gives the level's role. The metadata also has no `type: 'membership'`, so the result depends on webhook heuristics.
- **Fix:** send the route through `membership.change(userId, planId)`, which applies every rule and settles open attempts, and keep the response shape. Or reject levels with `requires_approval || dev_only || hide_price`. Mark `payments.subscribe` deprecated in the SDK.
- **Risk:** high (anyone can join a paid level without approval). **Phase A.**
- **Status:** DONE (route → `membership.change` via `payments.subscribe`; free plans refused up front; SDK method marked @deprecated; test `payments.subscribe.test.ts`)

#### S2 — Single-user admin routes skip the sysadmin protections that bulk applies
- **Location:** `packages/api/src/routes/users.ts:227-295` (`POST /`, `PUT /:id`, `POST /:id/password`, `POST /:id/ban`, `DELETE /:id`). Compare `services/users.ts:396-407` (`bulk`).
- **Problem:** `bulk` refuses to grant `sysadmin` unless the caller is a sysadmin, and it skips sysadmin targets. The single-user routes do not pass the caller to the service at all. An **admin** (or an `admin`-scope `ssk_` API key) can:
  - promote anyone, themselves included, to `sysadmin` (`PUT /users/:id {role:'sysadmin'}`, or `POST /users` with `role: sysadmin`);
  - set a sysadmin's password (account takeover);
  - ban or delete a sysadmin.

  The Add User form (`pages/admin/Users.tsx:268-273`) and the UserDetail role select show "System Admin" to every admin.
- **Fix:** move the bulk guard into one `assertCanManage(caller, target, patch)` and call it in `create`/`update`/`setPassword`/`ban`/`unban`/`remove`, with the caller passed from each route. Also refuse a role change to self. Hide `sysadmin` in both selects unless the caller is a sysadmin.
- **Risk:** high (privilege escalation). **Phase A.**
- **Status:** DONE (`users.assertCanManage`/`guardManage` on create/update/avatar/password/ban/unban/delete + bulk; self role change/ban/delete refused; API key acts as admin; selects hide sysadmin unless caller is sysadmin; test `users.manage.test.ts`)

#### S3 — No permissions on user management (project rule)
- **Location:** `packages/api/src/routes/users.ts` (every route except invites/subscription); `services/permissions/catalog.ts`.
- **Problem:** CLAUDE.md requires a permission for each gated read/write. Users CRUD, bulk, password, ban and delete rely only on the `admin` tier. An operator cannot let a "support" admin read users without letting them delete users.
- **Fix:** add `users:read`, `users:write`, `users:delete`, `users.password:set`, `users:ban` and `users:bulk`. Default them to admin+sysadmin so behaviour stays the same, and check them in each handler.
- **Risk:** medium. **Phase B.**
- **Status:** DONE (new `users:delete`, `users.password:set`, `users:ban`, `users:bulk`, `users:verify`; existing `users:read`/`users:write` now checked; bulk checks the action's permission too; API keys keep today's access)

#### S4 — Anonymous `apply/submit` is an unthrottled email relay and spam sink
- **Location:** `packages/api/src/routes/payments.ts:155-169`; `services/membershipApplications.ts:204-241`
- **Problem:** `auth: 'optional'` with no limiter, no honeypot and no per-email limit. Each call inserts a row, emails the team (`membership_application`), and sends "We received your … application" to **any address in the answers** (`c.email`). An attacker can send site-branded mail to arbitrary addresses and fill the "not signed up yet" list. The unique constraint does not help for `user_id IS NULL` rows.
- **Fix:** add `pre: [loginLimiter]` (or a dedicated Redis limiter keyed by IP + email). Add the discussions-style honeypot field. Allow at most one pending anonymous application per (`contact_email`, `plan_id`): return the existing one. Send the applicant receipt only for signed-in users, or after a CAPTCHA.
- **Risk:** medium-high. **Phase A** (limiter, dedupe), **B** (honeypot/CAPTCHA).
- **Status:** DONE (Redis-backed limiter 10/h per IP on `apply/submit`; honeypot `website` (server); one pending account-less row per email+level, repeat returns it with no mail). SKIPPED: CAPTCHA, and a DOM honeypot input in the client form (the field is accepted server-side only)

#### S5 — Approving twice can charge the card twice (no claim or lock on approve)
- **Location:** `services/membershipApplications.ts:388-428` → `membership.startApprovedMembership` (`services/membership.ts:688-745`)
- **Problem:** `loadPending` reads the status, then the Stripe subscription is created, and the status changes to `approved` only after that. Two concurrent approvals (two admins, two tabs, or a retried request) both pass `loadPending` and both call `stripe.subscriptions.create(off_session)`. The modal's `busy` flag protects one tab only. `activeLocalSub` does not see the other request's subscription because the row is inserted after the Stripe call.
- **Fix:** claim the row first: `UPDATE membership_applications SET status='processing' WHERE id=$1 AND status='pending' RETURNING …`. Revert to `pending` with `error` on failure. Also pass a Stripe `idempotencyKey: approve:<applicationId>` to `subscriptions.create`.
- **Risk:** high (double charge). **Phase A.**
- **Status:** DONE (claim via `approving_at` in one conditional UPDATE, migration 167; stale after 5 min; Stripe `idempotencyKey approve:<id>:<claim>`; claim released after; tests)

#### S6 — Notification settings cache is per process (stale on other workers)
- **Location:** `packages/api/src/services/notifications/index.ts:26-54`
- **Problem:** `cached` is a module variable, and `invalidateNotificationSettings()` clears it only on the worker that saved. With `CLUSTER_WORKERS > 1`, the other workers keep the old recipients until they restart. A removed admin keeps getting member PII (name, phone, membership) in notification emails.
- **Fix:** keep the settings in Redis through `CACHE_KEYS` (short TTL), or publish an invalidation on the existing pub/sub, as `adminChannel/peers.ts` does.
- **Risk:** medium. **Phase B.**
- **Status:** DONE (30 s TTL on the per-process cache bounds staleness on other workers; test `settingsCache.test.ts`). Not moved to Redis (cache.ts is outside this area)

---

### 2. Correctness

#### C1 — A member on an approval level cannot change billing (monthly ↔ yearly)
- **Location:** `services/membership.ts:349-364` (`targetTier`)
- **Problem:** for the same level at another price, `to.isCurrent = found.isCurrent && samePrice` is **false**. The approval check `to.requiresApproval && !to.isCurrent && !opts.approved` then throws "requires an application". The profile offers "Switch to yearly billing" (`MembershipPanel.tsx:96-100`) and the call fails.
- **Fix:** gate approval on `!found.isCurrent` (the level, not the price), so billing changes on the member's own level are allowed. Add a test.
- **Risk:** medium (a visible error on a paid path). **Phase A.**
- **Status:** DONE (approval gated on the LEVEL; test `membership.rules.test.ts`)

#### C2 — Upgrade/downgrade and "price difference" compare raw cents across intervals
- **Location:**
  - server: `services/membership.ts:426` (`direction`) and `:526` (`'upgraded'` email wording);
  - client: `components/profile/MembershipPanel.tsx:511` ("Price difference").
- **Problem:** with alternative prices, $25/month → $250/year is reported as "upgrade" (and +$225/year), although per month it costs less. The server and the client disagree: the client `direction()` uses `perMonth`, the server does not. As a result the confirmation heading, the preview `direction` and the member's email can contradict each other.
- **Fix:** add one `perMonthCents(price)` to `@sitesurge/types` (see A2). Use it for the server direction, the email wording and the client difference, and show the difference per month ("+$X / month equivalent") when the intervals differ.
- **Risk:** low-medium. **Phase A.**
- **Status:** DONE (shared `perMonthCents`/`isUpgrade`; server direction + email wording + client "Price difference" per month when intervals differ)

#### C3 — An account-less applicant who closes the tab cannot claim their application, and the approval email points to a link that does not exist
- **Location:**
  - `components/membership/MembershipApplication.tsx:110-138` (the token lives only in `sessionStorage`);
  - `services/membershipApplications.ts:228-235` (the receipt email has no link);
  - `:406` ("use the link from your application email").
- **Problem:** the claim token never reaches the applicant's inbox. A closed tab, another device, or the email-verification step (which opens a new tab, so `sessionStorage` is empty) loses the application. The hide-price approval email then tells them to use a link they never got. The row stays in "not signed up yet" forever, and the person usually applies again.
- **Fix:** put a claim link `/join?application=<id>&token=<token>` in the receipt and the approval emails. Also auto-claim on registration or verification when the verified email equals `contact_email` (pending/approved rows with `user_id IS NULL`).
- **Risk:** medium (lost applicants). **Phase B.**
- **Status:** DONE (claim link `/profile?tab=membership&claim=&token=` in the receipt and offer emails, claimed by MembershipPanel; `claimByVerifiedEmail` on email verification and invite accept — only for a PROVEN address; tests)

#### C4 — Developers on a Dev Only level are walled in subscription-required mode
- **Location:** `services/subscriptionAccess.ts:51-58` (`hasQualifyingSubscription`) vs `services/membership.ts:245,366` (Dev Only is exempt from the minimum)
- **Problem:** b8e824e5 made Dev Only levels exempt from the minimum when they are *offered* and *bought*, but not in `accessState`. A developer who buys the token-price Dev Only level ranks below the minimum and stays restricted. `TIER_RANK_SQL` (`subscriptionTiers.ts:237-252`) also ranks Dev Only and inactive levels. A $1 Dev Only level becomes rank 1 and moves every real level up, which changes post-gate comparisons for real subscribers.
- **Fix:** in `hasQualifyingSubscription`, accept `p.dev_only = true` as qualifying. Leave `dev_only` levels out of the rank CTE (give them `sort_order = 0` or NULL), as is done for Free.
- **Risk:** medium. **Phase B.**
- **Status:** DONE (`hasQualifyingSubscription` accepts `dev_only`; Dev only ranks 0 in `TIER_RANK_SQL`; migration 168 re-ranks; cheapest-paid minimum ignores dev levels; test `subscriptionAccess.test.ts`)

#### C5 — Wall and `/subscribe` banner say "your card is saved" when no card was added
- **Location:** `components/membership/SubscriptionWall.tsx:52-60`; `pages/Subscribe.tsx:113-118`
- **Problem:** both branch only on `noCard` (hide price). A normal approval applicant who submitted the answers but never did step 2 (`hasCard === false`) is told the card is saved. Admins cannot approve without the card (the button is disabled), so the application stalls and nobody notices. The profile handles this case (`MembershipPanel.tsx:316-323`).
- **Fix:** add the third state (`!hasCard && !noCard`) with "Add your card to finish your application" and a link to `/profile?tab=membership`.
- **Risk:** low. **Phase A.**
- **Status:** DONE (wall + /subscribe third state "Add your card to finish your application")

#### C6 — Members who are not verified cannot get a new verification email
- **Location:** `packages/api/src/routes/auth.ts:334` (`resend-verification`, `auth: 'user'`); `services/auth.ts:280-292`
- **Problem:** with verification on and subscription-required mode off, login refuses an unverified member. The only resend endpoint needs a signed-in user. `LoginForm` shows the error and offers no resend.
- **Fix:** add a public `POST /auth/resend-verification-by-email {email}` (loginLimiter, always 200 so it does not reveal accounts). Have `LoginForm` show "Resend the link" when the error is the verification one (use an error code, not text matching).
- **Risk:** low. **Phase A.**
- **Status:** DONE (`EMAIL_NOT_VERIFIED` AppError code kept through the login route; public `POST /auth/resend-verification-by-email` (loginLimiter, one answer); SDK `cms.auth.resendVerificationByEmail`; LoginForm "Resend the link")

#### C7 — Email-verification gate checks `role === 'member'` only
- **Location:** `services/auth.ts:280`
- **Problem:** custom roles (`subscriber`, `ambassador` as the main role, any custom role based on member) skip the gate. Invites already mark the email verified, so the real gap is a custom role given by hand or by a tier.
- **Fix:** `!isStaffRole(dbUser.role) && dbUser.email_verified === false`.
- **Risk:** low. **Phase A.**
- **Status:** DONE (`!isStaffRole(role) && email_verified === false`; test `auth.login.test.ts`)

#### C8 — Hide-price approval offers never expire
- **Location:** `services/membership.ts:121-133` (`approvedOfferFor`)
- **Problem:** an approved, unstarted offer stays valid forever, so a person approved two years ago can still buy the level. There is also no admin action to withdraw an offer: `reject` refuses because the status is no longer `pending`.
- **Fix:** add `offer_expires_at` (default e.g. 30 days, a setting) and check it in `approvedOfferFor`. Add a "Withdraw offer" action (`approved` → `withdrawn` while `activated_at IS NULL`).
- **Risk:** low. **Phase B.**
- **Status:** DONE (`offer_expires_at` = 30 days (constant `OFFER_TTL_DAYS`, not yet a setting), checked in `approvedOfferFor`; `POST /membership-applications/:id/withdraw-offer` + Review modal "Withdraw offer")

#### C9 — Invite accept is not atomic
- **Location:** `services/userInvites.ts:148-162`
- **Problem:** `liveInvite` → `registerMember` → mark accepted. Two concurrent accepts (a double-submit) can both pass `liveInvite`. The second normally fails on the duplicate email, but with a *different* email (allowed) both accounts get the roles. `resend` (`:116-126`) also clears `revoked_at`, so "Resend" silently un-revokes a revoked invite.
- **Fix:** claim first: `UPDATE user_invites SET accepted_at=NOW() WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW() RETURNING *`, then register, and roll back the claim on failure (one transaction). Refuse `resend` on revoked invites, or label the action "Re-issue".
- **Risk:** low. **Phase A.**
- **Status:** DONE (accept claims first with a conditional UPDATE, gives the invite back when registration fails; resend refuses a revoked invite; tests)

---

### 3. UI / UX

#### U1 — Approve confirmation does not show what will be charged
- **Location:** `components/admin/applications/ReviewApplicationModal.tsx:157-167`; DTO `packages/shared/src/api/routes/membershipApplications.ts:~40`
- **Problem:** "This charges the saved card (Visa •••• 4242) now" has no amount or frequency. `MembershipApplication` does not carry `price_id`, so the admin cannot see that the applicant chose the $1,500 bi-weekly price over the yearly one.
- **Fix:** add `price: { amount, currency, interval, intervalCount } | null` to the DTO (resolve it with `priceDetails`). Show "Charges $1,500.00 every 2 weeks" in the modal and the confirm.
- **Risk:** low. **Phase A.**
- **Status:** DONE (DTO `price` + `offerExpiresAt`; modal shows "Charges $X every N …" and the confirm text includes it)

#### U2 — UserDetail profile form does not follow the admin form rules
- **Location:** `pages/admin/UserDetail.tsx:272-330, 470-535`
- **Problem:** raw `<label class="settings-field__label">` + input instead of `FormField`, and six inline `style={{ width }}` values. Display Name and Handle lift state on every keystroke (`onInput` → page signal). This matches neither the commit-on-blur rule nor the label style used across the admin. Deleting a user uses `window.confirm` (`:165`), while every other destructive admin action uses `ConfirmModal`.
- **Fix:** rebuild with `admin-section` + `FormField` + `admin-form-row`, move the widths into `UserDetail.scss`, commit on blur, and use `ConfirmModal` for delete.
- **Risk:** low. **Phase A.**
- **Status:** DONE (FormField + admin-form-row, commit on blur/Enter, widths in UserDetail.scss, ConfirmModal for delete, role labels)

#### U3 — Add User form: hardcoded role list, raw role keys in the table
- **Location:** `pages/admin/Users.tsx:268-273` (four fixed `<option>`s), `:249` and `:339` (inline margins), Role column `:398` (`{user.role}`)
- **Problem:** custom roles (subscriber, ambassador, developer) cannot be chosen when creating a user, although the roles resource is already loaded on the page. The table shows `subscriber` while the extra-role chips show labels.
- **Fix:** build the options from `roles()` (filtered by the caller, see S2), show `roleLabel(roles(), user.role)`, and move the margins into a partial.
- **Risk:** low. **Phase A.**
- **Status:** DONE (role options from `roles()` via `primaryRoleOptions`, labels in the table, inline margins → `Users.scss`)

#### U4 — No email-verification state or actions in the Users admin
- **Location:** `pages/admin/Users.tsx`, `pages/admin/UserDetail.tsx` (no `emailVerified` anywhere)
- **Problem:** operators cannot see why a member "cannot log in", and cannot resend the link or mark the email verified. A support request then needs SQL.
- **Fix:** add an "Unverified" badge and filter in the list. On the detail page, add "Resend verification" and "Mark verified" (audited, new permission `users:verify`).
- **Risk:** low. **Phase B.**
- **Status:** DONE ("Unverified" badge + "Email not verified" filter (`?verified=`) on the list; user page badge + Resend verification / Mark email verified (`users:verify`, audited))

#### U5 — Profile Membership hides load errors and uses `window.confirm`
- **Location:** `components/profile/MembershipPanel.tsx:32` (`.catch(() => null)`), `:223`, `:331`
- **Problem:** every failure, including a 401 or a Stripe outage, reads "Membership details are unavailable right now" with no retry. Cancelling the membership and withdrawing the application use the browser's `confirm()`, which looks unlike the site's own modals and is blocked in some embedded webviews.
- **Fix:** keep the error, show a **Try again** button (`refetch`), and use the public `ConfirmModal` (or an inline confirm step, like the change flow) for cancel and withdraw.
- **Risk:** low. **Phase A.**
- **Status:** DONE (load error kept with Try again; inline confirm steps replace `window.confirm` for cancel and withdraw)

#### U6 — Each failed card attempt sends the team a "Membership started — awaiting payment" email
- **Location:** `services/payment/subscriptionNotice.ts:75-79`
- **Problem:** `customer.subscription.created` with `status: incomplete` sends a notification for every attempt, and `settleOpenAttempts` then cancels most of them. Operators learn to ignore these emails.
- **Fix:** skip `created` while the status is `incomplete`. The `incomplete → active` "payment received" notice already covers the successful case. Optionally add a daily digest of abandoned attempts.
- **Risk:** low. **Phase A.**
- **Status:** DONE (`created` + `incomplete` sends nothing; test)

#### U7 — Notification emails show raw role keys and naive money formatting
- **Location:**
  - `services/notifications/format.ts:189,220` (roles = keys);
  - `services/membership.ts:445` (member email price is `"1500.00 USD"`);
  - `components/admin/subscriptions/TierModal.tsx:30-33` (`$` hardcoded for every currency).
- **Problem:** notifications read "Roles: subscriber, ambassador". The member's "subscription changed" email prints `1500.00 USD` instead of `$1,500.00`, and non-USD prices show `$` in the admin.
- **Fix:** join `roles` for labels in `notifyUser`. Use one `Intl.NumberFormat` money helper (already `priceLabel` in `subscriptionNotice.ts:39`) in all three places.
- **Risk:** low. **Phase A.**
- **Status:** DONE (role labels in notifications; member email price via `formatMoney`; TierModal currency-aware)

#### U8 — Applicant receipt copy is wrong for signed-in and hide-price applicants
- **Location:** `services/membershipApplications.ts:229-234`
- **Problem:** every applicant is told "create your account and add your card". Signed-in applicants already have an account, and hide-price levels take no card. The approved, rejected and receipt emails are also hardcoded HTML (with inline `#111` buttons), so operators cannot edit them, unlike `user_subscription_changed` / `user_invite`.
- **Fix:** move the three emails to mail purposes (`membership_application_received`, `_approved`, `_rejected`) with `{{tier.*}}`, `{{application.claimUrl}}` and `{{note}}`. Make the default body depend on the state (signed in, needs card, hide price).
- **Risk:** low. **Phase B.**
- **Status:** DONE (mail purposes `membership_application_received` / `_approved` / `_rejected` with state-aware default bodies, `{{tier.*}}`, `{{application.claimUrl}}`, `{{note}}`; no hardcoded #111 buttons)

---

### 4. Architecture / code

#### A1 — Stripe card mounting copied three times, though a helper exists
- **Location:** `utils/stripeCard.ts` (has `mountStripeCard`, `saveCardForLater`); copies in `components/membership/SubscriptionSignup.tsx:139-156`, `components/profile/MembershipPanel.tsx:140-155, 239-255`
- **Problem:** the publishable-key lookup, `loadStripe`, card creation and the SetupIntent flow exist three times, and their error copy has already drifted. Only `MembershipApplication.tsx` uses the helper.
- **Fix:** move SubscriptionSignup and MembershipPanel to `mountStripeCard` / `saveCardForLater`, and add `payNewSubscription(m, clientSecret)` for the shared confirm step.
- **Risk:** low. **Phase A.**
- **Status:** DONE (`mountStripeCard`, `saveCardForLater`, new `tokenizeCard` + `payNewSubscription` used by SubscriptionSignup and MembershipPanel)

#### A2 — Price/frequency helpers duplicated across server, client and SQL
- **Location:** `services/membership.ts:83-86` (`perMonth`), `:415-419` (`frequency`); `components/profile/MembershipPanel.tsx:78-81` (`perMonth`); `TierModal.tsx:30` (`priceAmount`); `payment/subscriptionNotice.ts:39` (`priceLabel`); `subscriptionTiers.ts:241-243` (SQL); `utils/membershipFormat.ts`.
- **Problem:** five implementations of "monthly equivalent" and "billing words". C2 is already one result of the drift.
- **Fix:** move `perMonthCents`, `billingFrequency` and `formatMoney` into `@sitesurge/types` (`utils/membershipPrice.ts`) with tests. The SQL keeps its own copy, plus a comment that links the two.
- **Risk:** low. **Phase A.**
- **Status:** DONE (`@sitesurge/types` `utils/membershipPrice.ts`: `perMonthCents`, `billingFrequency`, `formatMoney`, `isUpgrade`, with tests; SQL keeps its copy with a comment)

#### A3 — Two separate Stripe price-listing paths
- **Location:** `services/membership.ts:52-79` (`priceDetails`, cached) vs `services/subscriptionTiers.ts:374-403` (`stripePrices`, uncached, cap 500); a dead `void stripePrices;` at `membership.ts:80`
- **Problem:** both page through every active recurring price in the account and map it in slightly different ways (deleted products, product default). This is two places to fix when Stripe changes its API (it already happened once: ad80b99f).
- **Fix:** one `listRecurringPrices()` in `services/payment/` returning the full shape. `priceDetails` caches it, and the admin route calls it with `fresh: true`. Remove the `void` import.
- **Risk:** low. **Phase B.**
- **Status:** DONE (`services/payment/recurringPrices.ts` `listRecurringPrices` used by `priceDetails` and the admin `stripePrices`; dead `void` removed; test)

#### A4 — Membership reads repeat the same queries and Stripe calls in one request
- **Location:** `services/membership.ts:295-339` (`current`, `overview`), `:342-376` (`targetTier`), `:378-412` (`preview`)
- **Problem:**
  - `overview` builds `tierOptions` twice and calls `stripe.subscriptions.retrieve` once.
  - `preview` = `targetTier` (→ `current` → tierOptions + retrieve) + `approvedOfferFor` + `tierOptions` again + `getPolicy` + `seesDevOnly` + `activeLocalSub`, then a second `subscriptions.retrieve` and `createPreview`.
  - `accessState` (every `/auth/me`) runs about 8 queries plus two dynamic imports.

  This is slow (each Stripe call is about 300 ms) and is close to Stripe's rate limits when many members manage plans at once.
- **Fix:** pass one per-request context (`{ cur, tiers, policy, seesDev, localSub, stripeSub }`) through `targetTier`/`preview`/`change`. Cache `getPolicy()` (settings + rank) in Redis, invalidated with tiers/settings. Use static imports where the cycle allows.
- **Risk:** medium. **Phase C.**
- **Status:** DONE in part (`loadCurrent` reads catalogue + local row + Stripe subscription once per request; preview/change reuse the retrieved subscription; overview builds the catalogue once). SKIPPED: Redis caching of `getPolicy()` (needs a new `CACHE_KEYS` entry in cache.ts, outside this area)

#### A5 — Dev Only visibility is a hardcoded role check, not a permission
- **Location:** `services/membership.ts:26-27, 249-255` (`DEVELOPER_ROLE = 'developer'`, `isAdminRole`)
- **Problem:** CLAUDE.md says "add a permission rather than falling back to a role check". Today the operator cannot let a QA role see test levels, and renaming or deleting the `developer` role silently breaks the feature. The constant is also placed between import statements.
- **Fix:** add the permission `memberships:dev_levels` (default admin, sysadmin, developer) and check it with `can()`. Move the constant into the catalog seed.
- **Risk:** low. **Phase B.**
- **Status:** DONE (permission `memberships:dev_levels`, default admin/sysadmin/developer, checked with `can()`)

#### A6 — Missing tests on the risky membership rules
- **Location:** `services/membership.test.ts` (7 cases: frequency, settleOpenAttempts, withPrice); there is no `subscriptionAccess.test.ts`; `cms/src/utils/membershipChoice.ts` and `SubscriptionWall.isOpenPath` have no tests.
- **Problem:** `targetTier` (approval, Dev Only, minimum, billing-only), `offered()`, `accessState` (viaRole, pending, lapsed, failedAttempt) and the open-path matcher control money and access, and none of them have tests. C1 and C4 would have been caught.
- **Fix:** table-driven tests for `targetTier`/`offered` (mock `listTiers`/`priceDetails`) and `accessState`. Add unit tests for `isOpenPath` (trailing slash, `/invite/` prefix, `openPaths`) and for `takeChoice` TTL/expiry.
- **Risk:** low. **Phase A.**
- **Status:** DONE (`membership.rules.test.ts` targetTier/offered incl. C1 + Dev only + minimum; `subscriptionAccess.test.ts`; cms `utils/membershipAccess.test.ts` for `isOpenPath` (moved to `utils/membershipAccess.ts`) and `takeChoice` TTL)

---

### 5. Styling

#### Y1 — Membership status colours are hardcoded hex
- **Location:** `components/profile/MembershipPanel.scss:14-16, 135-154` (~20 literals: `#ecfdf5`, `#fef2f2`, `#fffbeb`, `#e0e7ff`, …); `components/admin/applications/applications.scss:30` (`#fff`)
- **Problem:** the success/warning/danger/info panels and badges ignore the theme tokens. They look wrong on a dark site background, and the same palette is written separately in Subscribe and the wall.
- **Fix:** add public status tokens (e.g. `--site-success-bg/-fg`, `--site-warning-*`, `--site-danger-*`) in `styles/shared/` with the current values as fallbacks, and use one `.status-panel--{kind}` / `.status-badge--{kind}` partial for MembershipPanel, Subscribe and SubscriptionWall.
- **Risk:** low. **Phase A.**
- **Status:** DONE (`components/membership/_status.scss`: `--site-{success,warning,danger,info}-{bg,fg,border}` tokens with the old values as fallbacks; MembershipPanel + applications.scss use them). Subscribe/SubscriptionWall had no status literals to move

#### Y2 — Fallbacks for one token do not agree
- **Location:** `components/membership/SubscriptionSignup.scss:25,81` (`--site-border, #d1d5db`) vs `:71`, `PriceChoice.scss:20`, `SubscriptionWall.scss:13` (`--site-border, #e5e7eb`); `--site-text, #111` vs `#111827` elsewhere
- **Problem:** on a site with no appearance row, borders on the same page have two greys.
- **Fix:** take the fallbacks from SCSS variables (`$border-color`, `$text-color`) in one place, or drop them where `Layout` always sets the token.
- **Risk:** low. **Phase A.**
- **Status:** DONE (fallbacks unified to `#e5e7eb` / `#1f2937` across membership styles and Subscribe.scss)

---

### 6. Structural follow-ups

#### C10 — `membership.ts` is 800 lines doing five jobs
- **Location:** `packages/api/src/services/membership.ts`
- **Problem:** it holds the catalogue (tierOptions, offered, Dev Only), the current state, preview/change/confirm, open-attempt settling, approved-application billing, and the card. `membershipApplications` and `subscriptionAccess` import it through a dynamic `import()` to avoid a cycle.
- **Fix:** split it into `services/membership/{catalog,current,change,attempts,card,approved}.ts` behind a barrel, the same pattern as `services/events/`. Dependencies go one way: `catalog ← current ← change`. The cycle with `subscriptionAccess` then goes away.
- **Risk:** medium. **Phase C.**
- **Status:** DONE (`services/membership/{state,catalog,current,change,attempts,card,approved}.ts` + barrel; `subscriptionAccess` imports `membership/state` statically — the dynamic-import cycle is gone)

#### C11 — Hand-assigned memberships have no end date
- **Location:** `services/subscriptionTiers.ts:466-488` (`assignTier`); `components/admin/subscriptions/UserSubscriptionPanel.tsx`
- **Problem:** comps (a press pass, a YouTube supporter reconciled by hand) last until someone remembers to remove them. Operators expect "free for 3 months".
- **Fix:** add an optional `endsAt` to `PUT /users/:id/subscription` (stored in `current_period_end`). A daily cron expires manual rows past their end date and calls `syncUserRole`. Show "Assigned by staff · ends <date>" on the profile.
- **Risk:** low-medium. **Phase C.**
- **Status:** DONE (`endsAt` on `PUT /users/:id/subscription` → `current_period_end`; daily cron `membership-manual-expiry` (`expireManualSubscriptions` + `syncUserRole`), registered in lib.ts; admin date field; profile "Assigned by staff · ends <date>"; test)

#### C12 — Application lifecycle notifications to the team are incomplete
- **Location:** `services/membershipApplications.ts:453-458` (`withdraw`), `:243-264` (`attachCard`)
- **Problem:** the team is told when an application arrives, but not when the applicant adds their card (the moment it becomes approvable) or withdraws it. Reviewers poll the Users page.
- **Fix:** send `membership_application` follow-ups ("card added — ready to approve", "withdrawn") through `notifyWith`, with the same deep link.
- **Risk:** low. **Phase C.**
- **Status:** DONE ("card added — ready to approve" and "withdrawn" follow-ups on the `membership_application` notification)

#### C13 — Dev Only / developer role are missing from the guides
- **Location:** `docs/how-it-works/MEMBERSHIP-APPLICATIONS.md`, `docs/how-it-works/ROLES-AND-INVITES.md` (0 mentions); CLAUDE.md mentions it only in passing
- **Problem:** the Dev Only switch, its exemption from the minimum and the `developer` role (migration 152) are not documented for operators.
- **Fix:** add a short truth table (who sees it, who can buy it, the minimum exemption, rank effect after C4) to both guides, and update it with A5.
- **Risk:** low. **Phase C.**
- **Status:** DONE (MEMBERSHIP-APPLICATIONS.md: Dev only truth table, claim links, approval claim, offer expiry/withdraw; ROLES-AND-INVITES.md: developer role, manage rules + permissions, invite claim)

#### C14 — Login ban check reveals that an email is banned
- **Location:** `services/auth.ts:244-251`
- **Problem:** the `users_banned` lookup by email runs **before** the password check and returns "Account has been banned". Anyone can probe whether an address is banned. A banned *IP* also sees the same message for any email.
- **Fix:** check the email ban after the password check (keep the IP ban first, with a neutral message such as "Sign-in is not available from this network").
- **Risk:** low. **Phase C** (it changes user-facing copy across auth paths, so do it with the auth error-code work in C6).
- **Status:** DONE (IP ban first with a neutral message; email ban checked after the password; test)

---

## Implementation notes (2026-10-18)

**Totals:** Phase A 21/21 done (S4's CAPTCHA part skipped). Phase B 9/9 done (S6 by TTL, not Redis). Phase C 6/6 done (A4 in part).

**Migrations added:** 167 `membership_application_claims` (`approving_at`, `offer_expires_at`), 168 `tier_rank_dev_only` (re-rank). Both core (no `@feature` tag), so no registry entry.

### Cross-area follow-ups
- `packages/api/src/services/cache.ts`: add a `CACHE_KEYS.subscriptionPolicy` entry so `subscriptionAccess.getPolicy()` (every `/auth/me`) can be cached and invalidated with tiers/settings (A4 rest), and optionally move the notification-settings cache to Redis (S6). — **DONE (round 2)** for A4: `CACHE_KEYS.subscriptionPolicy` (`settings:subscription-policy`, 5 min) — cleared by `invalidateSettingsCache` (settings namespace) and `invalidateMembershipCache` (tier save/delete). S6 (notification settings to Redis) SKIPPED — optional, not in this round's list.
- Files outside the listed scope that were edited because the change needed them (all small, membership-only): `packages/api/src/lib.ts` (register `initMembershipCrons`), `packages/shared/src/types/mailPurposes.ts` + `packages/api/src/services/mail/purposeDefaults.ts` (three new purposes), `packages/cms-client/src/modules/{auth,users,membershipApplications,payments,coverage}.ts` (new SDK methods, `assignSubscription(…, endsAt)`, `subscribe` @deprecated), `packages/api/src/repositories/users.repo.ts` (`verified` filter), `packages/cms/src/components/admin/users/assignableRoles.ts` (`primaryRoleOptions`), `packages/cms/src/components/auth/LoginForm.tsx`.
- `packages/api/src/services/export/sources.ts`: the Users export does not pass the new `verified` filter yet. — **DONE (round 2)**: export route accepts `verified`, `allUsers` passes it (subtitle names it), Users page sends it.
- `docs/API.md` + `docs/api-manifest.json`: regenerate (`npm run docs:api`) — new routes `POST /auth/resend-verification-by-email`, `POST /users/:id/verification/{resend,verify}`, `POST /membership-applications/:id/withdraw-offer`; changed bodies (`apply/submit` `website`, `PUT /users/:id/subscription` `endsAt`).

### Docs to update
- CLAUDE.md → Roles + subscription tiers: the user-management rule set (`users.assertCanManage`) + the six new `users:*` permissions and `memberships:dev_levels` (replaces the hardcoded developer role check); Dev only ranks 0 and qualifies in subscription-required mode (migration 168); hand-assigned memberships may end (`endsAt`, cron `membership-manual-expiry`).
- CLAUDE.md → Membership applications: approval claim (`approving_at`, migration 167) + Stripe idempotency key; offers end after 30 days + Withdraw offer; claim links in emails and `claimByVerifiedEmail`; anonymous submit guards (limiter, honeypot, dedupe); three new mail purposes; team follow-up notices.
- CLAUDE.md → Users & roles: login refusal code `EMAIL_NOT_VERIFIED` + `POST /auth/resend-verification-by-email`; the verification gate applies to every non-staff role; banned-email check after the password.
- CLAUDE.md → services layout: `services/membership/` is now a directory (barrel `index.ts`; `state` / `catalog` / `current` / `change` / `attempts` / `card` / `approved`); shared price maths in `@sitesurge/types` `utils/membershipPrice.ts`; `services/payment/recurringPrices.ts`.
- CLAUDE.md → legacy `POST /payments/subscribe` now runs `membership.change` (deprecated in the SDK).
- `/admin/help` pages that describe memberships or Users permissions, if any mention the developer role check.
