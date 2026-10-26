# Discount codes and the affiliate program

Two features on ONE engine:

- **Discount codes** (part of `shop`) — codes a buyer enters at checkout.
- **Affiliate program** (feature `affiliates`, requires `shop`) — members with the
  affiliate role get codes from an admin, earn a commission on every paid order
  that uses them, and are paid out through **Stripe Connect Express**.

An affiliate code IS a discount code with `affiliate_user_id` + `commission_percent`.

## Discount codes

| | |
|---|---|
| Tables | `shop_discount_codes`, `shop_discount_redemptions` (migration 192); `shop_orders.discount_code_id` / `discount_code` |
| Service | `packages/api/src/services/shop/discounts.ts` |
| Maths | `@sitesurge/types` `utils/discountMath.ts` (`discountCentsFor`, `distributeDiscount`, `affiliateShareCents`, `discountSummary`) |
| Admin | **Shop → Discount codes** (`/admin/shop/discounts`) — site-wide codes. Shared `components/admin/discounts/DiscountCodeModal` + `DiscountCodeTable` |
| API | `/api/v1/shop/discounts` — `GET/POST /`, `GET/PUT/DELETE /:id`, `GET /:id/redemptions` (`shop.discounts:manage`), `POST /check` (public) |
| SDK | `cms.shop.discounts.list/get/redemptions/create/update/remove/check` |

**A code:** percent off (0–100) or an amount off (never more than the eligible
subtotal); active switch; optional start/end; **maximum uses** (total paid orders,
empty = unlimited), uses per buyer (account or email), minimum order; who may use
it — **membership levels** and/or **roles** (main or additional; none = anyone;
signed-out buyers are refused a limited code). A code **always applies to
merchandise**; **Also applies to event tickets** (offered when Events is on) adds
ticket lines bought through the cart.

**Usage is counted, never stored:** "Used" = paid redemptions (refunded ones do not
count). At checkout, unpaid orders from the last 30 minutes that hold the code also
count, so a limited code cannot be oversold by buyers paying at the same time; the
order is created with the code row LOCKED (`FOR UPDATE`) and re-checked.

**Checkout:** `previewCheckout` / `createCheckout` take `discountCode`. The preview
returns `discountCents`, `discountCode`, `discountSummary` or `discountError` (never
throws for a bad code); create refuses an unusable code (400). Tax (Stripe Tax) is
computed on the discounted line amounts (`distributeDiscount`). The order stores
`discount_cents` + the code, and every totals surface prints **Discount (CODE)**
(`orderTotalsLines`). The redemption row is written when the order is PAID
(`fulfillShopOrder` → `recordRedemption`), so abandoned checkouts never use a code.
A refund (admin status → refunded, or a full refund in Stripe → `charge.refunded`)
marks the redemption refunded (`markOrderRefunded`).

**Storefront:** `?code=XYZ` on any shop URL (an affiliate's share link) is remembered
for 30 days (`services/discountCode.ts`, captured by `ShopStoreGuard`) and
pre-filled at checkout; the checkout summary has a code field with Apply / Remove
and a Discount line.

## Affiliate program

| | |
|---|---|
| Feature | `affiliates` (requires `shop`) — Shop → Settings → **Affiliate program** (also Settings → Features) |
| Tables | `affiliate_accounts`, `affiliate_earnings`, `affiliate_payouts` (migration 193); settings row `affiliate_settings` |
| Services | `packages/api/src/services/affiliates/` — `index` (members, me, codes), `earnings`, `payouts`, `stripeConnect`, `schedule`, `settings`, `cron` |
| Admin | **Shop → Affiliates** (`/admin/shop/affiliates`): program numbers, members, per member codes / commissions / payouts / **Pay out**; a card on the Shop dashboard |
| Member page | **Profile → Affiliate program** (`components/profile/AffiliatePanel.tsx`) — the `affiliate` role's page after sign-in (`profile?tab=affiliate`) |
| API | `/api/v1/affiliates` — `/me/status`, `/me`, `PUT /me/codes/:id`, `/me/stripe/{onboard,dashboard,refresh}` (`affiliates:self` + the role); `/settings`, `/admin/{stats,members,members/:userId,members/:userId/codes,members/:userId/payout}` (`affiliates:manage`) |
| SDK | `cms.affiliates.*` |

**Who is an affiliate:** a user holding the configured role (default `affiliate`),
as main or additional role — e.g. approved for the Affiliate program level.

**Settings:** affiliate role; default commission % for new codes (10); **refund
window** in days before a commission is payable (30); **automatic payouts**: off /
weekly / every 2 weeks / monthly. A manual **Pay out** is always available.

**Commission:** each code has a commission % (0–100, admin) and a **buyer discount**
% the affiliate chooses on their page (≤ the commission). On a paid order:

    affiliate share = (commission% − buyer discount%) × merchandise subtotal (before the discount)

so the buyer discount is paid out of the commission and the shop's total cost is the
commission. Tickets and shipping/tax never earn commission. Earnings rows:
`commission` (status `earned` → `paid`), payable once `available_at` (payment +
refund window) passes. A refund before payout marks it `reversed`; after a payout it
adds a negative `reversal` row that nets against the next payout.

**Stripe Connect Express:** the shop's Stripe account is the platform (Settings →
Shop → Payment credentials; enable **Connect** in Stripe). "Connect with Stripe"
creates an Express account (`transfers` capability) and opens Stripe's onboarding;
returning re-reads the account (`/me/stripe/refresh`), and the `account.updated`
webhook keeps it current (add it to the webhook endpoint as an event on connected
accounts). Payouts are `stripe.transfers.create` from the shop's balance to the
connected account — idempotent per payout row. The earnings are CLAIMED (payout id
set in a transaction) before the transfer, so two runs can never pay the same
commission; a failed transfer releases them and records the error.

**Automatic payouts:** the `affiliate-payouts` cron (daily 06:15, primary only)
pays every affiliate with a payable balance and a ready Stripe account when
`isPayoutDue(schedule, lastAutoPayoutAt)` — weekly / 14 days since the last run, or
the first run of a new month.

**Permissions:** `shop.discounts:manage` (admin), `shop.discounts:use` (everyone;
codes narrow it), `affiliates:manage` (admin), `affiliates:self` (members; the
service also requires the affiliate role).
