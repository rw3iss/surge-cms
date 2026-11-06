# Improvement audit 2026-11-06 — Partners, contributors, affiliates, discounts

Scope: role admin shells + dashboards, `services/postAccess.ts`, media own-scope, permission grant modes, contributor post review, `services/contributions/**`, `services/partners/**`, `services/affiliates/**`, `services/shop/discounts.ts`, their routes / SDK / shared maths, and the admin + profile + checkout UI for them (features since f28ea8ae). Migration used: **212** (213 unused).

| # | Title | Risk | Status |
|---|-------|------|--------|
| 1 | Unclear Stripe transfer failure could pay a partner twice | B | applied |
| 2 | DB error after a successful transfer released the claim | B | applied |
| 3 | Two concurrent payouts for one partner/program | B | applied (migration 212) |
| 4 | Mixed-currency earnings summed into one transfer | A | applied |
| 5 | Commission used the code's CURRENT split, not the order's | B | applied |
| 6 | Refund while the affiliates feature is off never reversed the commission | A | applied |
| 7 | Single-use code "used up" for 30 min after the buyer's own failed attempt | A | applied |
| 8 | `POST /shop/discounts/check` unthrottled (code guessing) + ignored `shop.discounts:use` | A | applied |
| 9 | Two reviewers could act on one submission | B | applied |
| 10 | Contribution credit raced a payout claim; payee did not follow an author fix | B | applied |
| 11 | "Credited" email sent when the credit failed | A | applied |
| 12 | Affiliates admin list: 2 queries per affiliate | A | applied |
| 13 | Admin "give code" to a missing user → 500 | A | applied |
| 14 | Partial refunds never adjust a commission | C | planned |
| 15 | Commission % read at payment time, not checkout | C | planned |
| 16 | Checkout uses the unlocked preview amounts after the locked re-check | B | lead follow-up |
| 17 | Affiliates-only admin got 403 editing / deleting an affiliate code | A | applied |
| U1–U19 | UI findings | — | see "UI" (18 applied, 1 skipped) |

## Findings

### 1. Unclear Stripe transfer failure could pay a partner twice
`packages/api/src/services/partners/payouts.ts` (`payOutSource`).
**Problem:** any error from `stripe.transfers.create` marked the payout `failed` and released the earnings. A network error / timeout / Stripe 5xx can happen AFTER Stripe made the transfer; the next payout then claimed the same rows under a NEW payout id → new idempotency key → a second real transfer.
**Fix:** `isAmbiguousTransferError` (network, 5xx, non-Stripe errors) keeps the payout `pending` with its earnings claimed and the error recorded. The next payout for that partner + program resumes it (after 2 minutes, so an in-flight call elsewhere is not doubled): it looks the transfer up at Stripe (`transfer_group = payout_<id>`, new; or `metadata.payoutId` within the payout's time for older rows) and records it, else creates it with the SAME idempotency key. A definite 4xx refusal still fails + releases. `payableUsers` includes partners with a pending payout, so the cron resumes them. Message to the admin says "do not pay by hand".
**Status:** applied; tests `partners/payouts.test.ts` (success, refusal, unclear → resume finds transfer, unclear → retry same key, nothing payable).

### 2. DB error after a successful transfer released the claim
Same function. **Problem:** the paid-marking transaction sat inside the same `try` as the transfer; a DB failure there ran the "transfer failed" path (released earnings → paid again later). **Fix:** separate `try`; a post-transfer DB error logs and leaves the payout `pending`; the resume records it. **Status:** applied.

### 3. One pending payout per partner/program
`db/migrations/212_partner_payout_single_pending.sql`. Partial unique index `(user_id, source) WHERE status = 'pending'` (created only when no duplicates exist, so an old install still boots). A conflicting claim returns "A payout for this partner is already in progress". **Status:** applied.

### 4. Mixed currencies in one transfer
**Problem:** the claim summed every payable row and used the first row's currency (contributor currency can be changed in settings). **Fix:** each run claims one currency (the oldest payable row's); the rest follow on the next run. **Status:** applied.

### 5. Commission from the code's current split
`services/shop/discounts.ts` `recordRedemption`; new `orderBuyerDiscountPercent` in `packages/shared/src/utils/discountMath.ts`.
**Problem:** the commission used the code's `percent` at PAYMENT time. An affiliate who lowered the buyer share after a buyer checked out with 10 % off earned the full commission while the shop also paid the 10 % — the shop paid twice.
**Fix:** the buyer % is derived from the order's own `discount_cents` (merchandise part only when the code also covered tickets), capped at the commission. Tests in `discountMath.test.ts`. **Status:** applied.

### 6. Refund reversal gated on the feature flag
`markOrderRefunded`. **Problem:** reversal only ran while `affiliates` was on; refunds in an "off" period left the commission payable after re-enabling. **Fix:** reverse whenever `affiliate_earnings` exists. **Status:** applied.

### 7. Own unpaid checkout held a single-use code
`countUses`. **Problem:** pending orders < 30 min count as uses, including the buyer's own — after a card decline, the retry said "This code has been used up". **Fix:** the buyer's own pending orders (same user id or email) are not counted. Residual: one buyer racing themselves in two tabs can pay twice with a single-use code (bounded, logged by redemptions). **Status:** applied.

### 8. `/shop/discounts/check`
`routes/shopDiscounts.ts`, `discounts.check`. **Problem:** public, no rate limit → codes can be guessed; also said "valid" to a role that checkout refuses (`shop.discounts:use`). **Fix:** 30 checks / 10 min per user or IP (`discussions/spam.rateLimit`, fails open); permission checked like checkout. **Status:** applied.

### 9. Review race
`services/postReview.ts`. **Problem:** status check then `posts.update` — two reviewers could both pass (published AND returned, two emails, double credit attempt). **Fix:** an atomic claim (`reviewed_at` set only when not yet reviewed for this submission; a claim older than 2 minutes on a still-pending post counts as failed); a failed update releases it. Test `postReview.test.ts`. **Status:** applied.

### 10. Contribution credit vs payout
`services/contributions/index.ts` `credit`. **Problem:** read-then-write; a payout claiming the earning between the two could have its amount changed under it. The payee was fixed at first credit, so fixing a post's author did not move the payout. **Fix:** conditional `UPDATE … WHERE status <> 'paid' AND payout_id IS NULL` (rowCount checked), `user_id` follows the current author, insert `ON CONFLICT DO NOTHING` + retry through the update path. **Status:** applied.

### 11. "Credited" email on failure
`onApproved`. **Problem:** a failed credit was logged, but the author + team still got "credited $X". **Fix:** on failure return `false` → the plain review-result email goes out. **Status:** applied.

### 12. N+1 in the affiliates admin list
`services/affiliates/index.ts` `members`. Up to 1000 affiliates × 2 queries. **Fix:** `accountRows` + `balancesFor` batched. **Status:** applied.

### 13. Code for a missing user
`createCode` → FK error 500. **Fix:** 404 "User". **Status:** applied.

### 14. Partial refunds (planned)
`services/payment/webhook.ts` (`charge.refunded`) only acts on a FULL refund. A partial refund keeps the whole commission and the use. Plan: reverse `round(commission × refunded / charged)` as a `reversal` row — needs `affiliate_earnings` UNIQUE `(order_id, user_id, kind)` relaxed for several partial reversals (or an `amount_refunded` high-water mark on the redemption). Documented as a known limit in the guide.
**Status:** applied. Partial `charge.refunded` → `markOrderRefunded(id, { refundedCents, chargedCents })` → `reverseCommission` reverses `round(commission × refunded / charged)` as a high-water mark read from the ledger (cut from an unpaid commission, else new `reversal` rows), row-locked; retries are no-ops, a later full refund completes it, the use is released only on a full refund. Migration 213: UNIQUE `(order_id, user_id, kind)` → partial unique on commission rows (193 now creates that shape). Pure maths `services/affiliates/reversal.ts` + `reversal.test.ts`.

### 15. Commission % read at payment (planned)
The commission % is still the code's value at payment time (admin-controlled; normally minutes after checkout). Plan: snapshot `{ percent, commissionPercent }` on the order at checkout (`shop_orders.discount_snapshot JSONB`, migration) in `checkout.ts` (outside this area).
**Status:** applied. Migration 213 adds `shop_orders.discount_snapshot` (`{ codeId, kind, percent, amountCents, appliesToTickets, affiliateUserId, commissionPercent }`), written in the order transaction from the locked re-check (`AppliedDiscount.snapshot`); `recordRedemption` reads the affiliate + commission % through `commissionSplitFor` (snapshot, else the code row for older orders). Tests in `discounts.test.ts`.

### 16. Checkout re-check amounts (lead follow-up)
`services/shop/checkout.ts:606-612`: the LOCKED re-check (`again`) is only used as a yes/no; the order is written with the amounts from the unlocked preview `discount`. If the code changed in between, totals use the stale rule. Fix: `if (again.applied.discountCents !== discount.discountCents) throw new ValidationError('The discount changed — review your order.')`.

### 17. Affiliate code edit/delete permission
`routes/shopDiscounts.ts`. **Problem:** Shop → Affiliates edits/deletes codes through `/shop/discounts/:id` (`shop.discounts:manage`), so an admin with only `affiliates:manage` could create an affiliate code but got 403 editing or deleting it. **Fix:** `manageCode` — read / update / delete / redemptions of a code with `affiliate_user_id` also accept `affiliates:manage`; such an admin cannot set `affiliateUserId: null` (turn it into a site code). **Status:** applied.

## UI (findings U1–U19)

| # | Finding | Risk | Status |
|---|---|---|---|
| U1 | Refetch suspends the admin page (search / filters / actions blank the page, search box loses focus) | B | applied |
| 2 | Header Save on Posts → Settings → Contributions saved the WRONG settings | B | applied |
| 3 | Settings panels saved placeholder defaults after a failed load | B | applied |
| 4 | `parseDollars('')` = $0; float rounding for x.xx5 | A | applied |
| 5 | Several money / date / status helpers, inconsistent labels | A | applied |
| 6 | Discount modal: no client validation (buyer % > commission, 0% / $0 codes, bad code, end before start, bad limits, NaN cents) | B | applied |
| 7 | Discount table Active switch: double send, no lock | A | applied |
| 8 | "Pay selected" contributors paid with no confirmation; could include unpayable rows | B | applied |
| 9 | Checkout discount: out-of-order previews; old code shown as applied after Remove; order could carry a removed code | B | applied |
| 10 | services/discountCode.ts: damaged entry not dropped, no code check on stored / remembered values | A | applied |
| 11 | Partner Program: lazy AffiliatePanel had no Suspense boundary; no empty state without programs | A | applied |
| 12 | Partner tabs inconsistent (note order, labels, payout status text) | A | applied |
| 13 | Contributor shell could open /admin/posts/settings (Save → 403) | A | applied (helper) + lead follow-up |
| 14 | Contributions tab "N waiting" count stale after a review / payout | A | applied |
| 15 | Hardcoded hex fallbacks in partner SCSS | A | applied |
| 16 | Shop → Affiliates: raw status / schedule values, own badge style, errors crash page | A | applied |
| 17 | Contributor dashboard: no way to reach earnings | A | applied |
| 18 | Affiliate Program settings: role select silently shows another role when the saved one is missing | A | applied |
| 19 | AffiliatePanel non-embedded mode (own Getting paid card) is unused and lacks the steps/Refresh of the Partner Program card | C | skipped (no caller; kept, not deleted) |

1. **Resource refetch suspends the admin page**
   - Location: `pages/admin/shop/ShopDiscounts.tsx:~30-66`, `components/admin/contributions/ContributionsView.tsx` (list/summary reads), `pages/admin/shop/ShopAffiliates.tsx` (members/stats/member modal), `pages/admin/Posts.tsx` (contrib).
   - Problem: `codes()` / `list()` / `m()` read in JSX while a refetch runs suspends the nearest boundary (the admin `<main>` StableSuspense). Each keystroke in Discount codes search swapped the page for its placeholder and the search box lost focus; every filter/page change or action in Contributions and every change in the affiliate modal blanked the page.
   - Fix: read through `.latest` (only once resolved), local error states instead of throwing into the error boundary, debounced (250 ms) discount search.
   - Risk B — applied.

2. **Posts → Settings → Contributions: header Save saved the posts settings, not the contributor settings**
   - Location: `pages/admin/PostsSettings.tsx` header button; `ContributorSettingsPanel.tsx`.
   - Problem: the sticky header Save said "Posts settings saved" while the contributor changes were dropped; the real Save sat at the bottom (convention: controls in the sticky header).
   - Fix: panel exposes `bindSave({ save, saving, ready })`; on that tab the header Save calls it, and the panel hides its own bottom button when bound.
   - Risk B — applied.

3. **Failed load → Save overwrote real settings with defaults**
   - Location: `ContributorSettingsPanel.tsx` onMount; `AffiliateProgramSettings.tsx` `loaded` resource.
   - Problem: on a load error the form showed the placeholder defaults (contributor payouts OFF, $40, …) and Save wrote them.
   - Fix: error alert in place of the form, `ready()` gate on save, double-submit guards.
   - Risk B — applied.

4. **Money parsing**
   - Location: `components/admin/contributions/money.ts` `parseDollars`.
   - Problem: empty field parsed as 0 cents (a blank payout saved $0; PostEditor approve with a blank amount paid $0); `1.005` → 100 via float; `1e3` accepted.
   - Fix: blank → null, digits-only grammar, decimal maths on the digits, Math.round. Tests in `money.test.ts`.
   - Risk A — applied.

5. **One money/status helper**
   - Location: `money.ts` (now the one helper), used by ContributionsView, ContributorPayouts, ShopAffiliates, DiscountCodeTable, DiscountCodeModal, AffiliatePanel, PartnerProgramPanel, ContributorDashboard.
   - Problem: four local `money`/`day` copies, three Stripe-status wordings ("Ready" / "Onboarding" / "Not finished"), raw payout statuses in admin.
   - Fix: `formatMoney` (on shared `formatCurrency`), `formatDay`, `clampPercent`, `payoutStatusForPartner/Admin`, `stripeState` (Payouts ready / Setup not finished / Not connected, standard `badge--*`), `SCHEDULE_LABEL`.
   - Risk A — applied.

6. **Discount code modal validation**
   - Location: `components/admin/discounts/DiscountCodeModal.tsx` save; new `discountForm.ts` (pure, tested).
   - Problem: buyer discount could exceed the commission (server 400 after the round trip; min/max on the input not enforced); site code with 0% or $0 saved; NaN cents possible; end before start; "1.5" uses; code pattern only checked by the server.
   - Fix: `buildDiscountBody` mirrors the server checks with plain messages; commission change clamps the buyer %; percent inputs clamped; save is re-entrancy guarded. No `validate` on the code field on purpose (a refused draft would have left the OLD code to be saved).
   - Risk B — applied.

7. **Discount table Active switch**
   - Location: `DiscountCodeTable.tsx` setActive.
   - Problem: no busy state — double clicks sent two updates; min order printed with a hardcoded `$`.
   - Fix: per-row lock (`disabled` Toggle while saving), currency via `formatMoney`, delete re-entrancy guard.
   - Risk A — applied.

8. **Contributor payouts confirmation**
   - Location: `ContributorPayouts.tsx`.
   - Problem: "Pay selected" transferred money with no confirm; ticked rows without a payable balance / Stripe were sent anyway.
   - Fix: one ConfirmModal for both actions naming the amount and the payees; "Pay selected" only sends payable + Stripe-ready rows (disabled with a tooltip otherwise); guard against a second click.
   - Risk B — applied.

9. **Checkout discount field**
   - Location: `pages/shop/ShopCheckout.tsx` runPreview / applyCode / discount block / create.
   - Problem: previews raced (a slow address preview with the old code could land after Remove/Apply); after Remove the old code still showed as applied until the reply; create sent `totals().discountCode` (could be a removed code); the comment said a failing code is forgotten (it is not — correct for affiliate attribution).
   - Fix: preview sequence number (only the latest reply applies), `appliedDiscount()` = totals code only when it matches the requested one, create uses it, Remove disabled while pricing, error hidden while pricing, input `maxLength=64` / no autocomplete / no spellcheck, comment corrected.
   - Risk B — applied.

10. **services/discountCode.ts**
    - Problem: `"null"` or a non-object entry threw inside and was never removed; stored / remembered values not checked against the code rule.
    - Fix: pure `readStoredCode` + `codeFromSearch`, damaged entries dropped, same CODE_RE as the server. Tests in `discountCode.test.ts`. Expiry logic itself was right (30 days, renewed when the checkout accepts the code).
    - Risk A — applied.

11. **Partner Program loading / empty**
    - Location: `components/profile/PartnerProgramPanel.tsx`.
    - Problem: the lazy `AffiliatePanel` had no boundary (loading its chunk suspended the whole profile page); a partner with no programs saw only the Getting paid card and nothing else.
    - Fix: local `<Suspense>` with a "Loading your affiliate account…" line; an empty-state card; data read via `.latest`.
    - Risk A — applied.

12. **Consistent partner tabs**
    - Location: AffiliatePanel (embedded) vs ContributionsTab.
    - Problem: the affiliate note sat ABOVE its balance cards, the contributions tab had no note; payout status text duplicated; "1 days".
    - Fix: both tabs = prefixed balance cards, then one muted note, same helpers; singular/plural fixed; refetch after a split save no longer flashes the card; copy-link timer cleaned up; split slider disabled while saving.
    - Risk A — applied.

13. **Contributor shell reaches Posts → Settings**
    - Location: `admin/shells/index.ts`; enforcement lives in `pages/admin/AdminLayout.tsx` (not in my scope).
    - Problem: prefix `/admin/posts` also opens `/admin/posts/settings`; its Save is admin-only (PUT 403).
    - Fix: `deny` list on the shell config + pure `shellAllowsPath(shell, path, navPaths)` (tests in `admin/shells/index.test.ts`). AdminLayout must call it — lead follow-up 1. No other contributor path leads to a 403: Contributions view is hidden for shells, `GET /posts/settings` is allowed for post writers.
    - Risk A — applied (helper), planned (wiring).

14. **Stale "N waiting" tab count** — `Posts.tsx` + `ContributionsView` `onChanged` prop → refetch the count after any action. A — applied.

15. **Hex fallbacks** — `AffiliatePanel.scss`, `PartnerProgramPanel.scss`, `discounts.scss`, `contributions.scss`, `ContributorDashboard.scss`: `var(--x, #hex)` → `var(--x, #{$token})`; unused `.affiliate-admin__badge` styles removed. A — applied.

16. **Shop → Affiliates polish** — standard Stripe badge, payout status words, schedule in words ("every 2 weeks", not `biweekly`), `formatPercent` share, member modal error state, members/stats/settings errors no longer crash the page, Pay-out confirm cannot be cancelled mid-payment. A — applied.

17. **Contributor dashboard** — "Earnings and payouts" header button to `/profile?tab=partners&program=contributions` when the user is a paid contributor (`cms.partners.me()`). A — applied.

18. **Affiliate role select** — keeps the saved role as an option ("(role not found)") when the role list lacks it, so Save cannot silently switch roles. A — applied.

19. **AffiliatePanel stand-alone mode** — `embedded={false}` renders its own Getting paid + balance, with fewer states than the Partner Program card; no caller uses it. Skipped (not deleted, per rules); delete or reuse when convenient.

## Lead follow-up
- **CLAUDE.md** (Affiliate program / Contributor payouts bullets): add "Payouts: an unclear Stripe failure keeps the payout `pending` and the next run resumes it (Stripe lookup by `transfer_group`/`metadata.payoutId`, same idempotency key); one pending payout per partner+program (migration 212). Commission uses the order's actual discount (`orderBuyerDiscountPercent`)."
- **`services/shop/checkout.ts`** — finding 16.
- **`services/payment/webhook.ts`** — finding 14 (partial refunds), when wanted.
- **`packages/cms/src/pages/admin/AdminLayout.tsx` `shellAllows`** (U13): replace the body with `const sh = shell(); return !sh || shellAllowsPath(sh, path, shellNavItems().map((i) => i.path));` (import `shellAllowsPath` from `../../admin/shells`). Until then a contributor can open `/admin/posts/settings` by URL (page loads, Save → 403).
- **`packages/cms/src/pages/admin/shop/ShopSettings.tsx`** (same bug as U2): on the Affiliate program tab the header Save saves the shop settings. Mirror PostsSettings: `const [aff, setAff] = createSignal<AffiliateSettingsApi | null>(null)`, `<AffiliateProgramSettings bindSave={setAff} />`, header button → `aff()?.save()` (busy `aff()?.saving()`, disabled `!aff()?.ready()`) when the tab is `affiliates`.
- **CLAUDE.md** also: "an `affiliates:manage` admin may read/edit/delete AFFILIATE codes via `/shop/discounts/:id`"; Partner Program UI money/status helpers live in `components/admin/contributions/money.ts`.
- No route path or input changed (route summaries unchanged); `docs:api` not needed for this area.

## Verification
- `packages/shared`: `npm run build` OK; `npx vitest run src/utils/discountMath.test.ts` → 13 passed.
- `packages/api`: `npx tsc --noEmit -p .` → clean. `npx vitest run src/services/partners src/services/affiliates src/services/postAccess.test.ts src/services/postReview.test.ts src/services/shop src/routes/mediaAuth.test.ts src/services/permissions` → 224 passed (new: `partners/payouts.test.ts` 7, `postReview.test.ts` 3).
- `packages/cms`: `npx tsc --noEmit -p .` → only `CampaignDonations.tsx` (known). `npx vitest run --config ../../config/cms/vitest.config.ts src/admin/shells src/components/admin/contributions src/components/admin/discounts src/services/discountCode.test.ts` → 27 passed (4 new files).
- Not verified: migration 212 not run against a database; no browser test; no live Stripe call (payout logic tested against a mocked Stripe + in-memory DB model).

## Files touched
- api: `services/partners/payouts.ts` (+ test), `services/partners/stripeConnect.ts`, `services/affiliates/index.ts`, `services/affiliates/earnings.ts`, `services/contributions/index.ts`, `services/postReview.ts` (+ test), `services/shop/discounts.ts`, `routes/shopDiscounts.ts`, `db/migrations/212_partner_payout_single_pending.sql`
- shared: `utils/discountMath.ts` (+ test)
- cms: see UI list (shells, dashboards, contributions, discounts, profile partner panels, ShopAffiliates/ShopDiscounts/AffiliateProgramSettings, PostsSettings, Posts, ShopCheckout, services/discountCode.ts)
- docs: `how-it-works/AFFILIATES-AND-DISCOUNTS.md`, `CONTRIBUTOR-PAYOUTS.md`, `CONTRIBUTORS-AND-ROLE-SHELLS.md`
