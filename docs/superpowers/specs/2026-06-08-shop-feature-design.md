# Shop (Ecommerce) Feature + Feature-Lifecycle System — Design

Date: 2026-06-08
Status: Implemented
Implemented: 2026-07-08

## Goal

Add a toggle-able **`shop`** feature to the SiteSurge CMS: a native ecommerce
store (catalog with variants, media, reviews, cart, on-site Stripe checkout,
orders, and configurable storefront appearance) that replaces the current
Shopify-iframe `Shop.tsx`. Every capability is exposed through the manifest
framework + typed DTOs + a `cms.shop.*` SDK namespace, fully headless for
buyers and admins with appropriate permissions.

Prerequisite sub-project: harden the **feature-lifecycle system** so any
feature (Shop first) can (1) run an idempotent install/init when enabled with
status relayed to the client, and (2) be fully **uninstalled/removed** —
dropping its tables + data — with confirmation. The Shop feature and ALL its
routes/pages exist only when the feature is enabled.

Survey source of truth: the 2026-06-08 codebase surveys (feature registry,
manifest module file-set, Stripe PaymentIntent/Elements flow, admin nav
gating, SDK/drift pattern, feature-lifecycle audit).

## Settled decisions

1. **Checkout:** reuse the existing Stripe **PaymentIntent + Elements**
   on-site flow (cart → order(pending) → PaymentIntent → Elements card form →
   webhook confirms → order paid). Same provider abstraction + raw webhook
   route as donations.
2. **Product model:** full **product → options → variants** (Shopify-style,
   ≤3 options via `option1/2/3` on variants). Every product has ≥1 variant
   (simple products get a default variant). Supports `type` = physical |
   digital. Per-variant inventory. Cart/order line-items reference a variant.
3. **Buyers/cart:** guest checkout allowed (email + shipping) OR logged-in;
   cart is **client-side** (localStorage via the cms-client cache); the order
   is created server-side at checkout. `shop` requires the `users` feature.
4. **Payments config:** single site Stripe account; **Stripe Tax** automatic
   tax calculation at checkout; shipping = configurable flat/rate-table.
5. **Feature key** `shop`; mount `/api/v1/shop`; SDK `cms.shop.*`; admin
   `/admin/shop/*`; storefront `/shop/*`; settings row `shop_enabled`.
6. **Gating:** all `/api/v1/shop/*` routes 404 when disabled (a
   `requireFeature('shop')` guard); admin nav + storefront routes render only
   when enabled.

---

# Part A — Feature-Lifecycle System (Phase 0, prerequisite)

The enable/install flow is already production-grade (synchronous,
transactional, `pg_advisory_xact_lock`, idempotent via `schema_migrations` +
`CREATE TABLE IF NOT EXISTS` + `ON CONFLICT`). This phase adds the missing
pieces.

## A1. Registry additions (`packages/api/src/features/registry.ts`)

`FeatureConfig` gains:
- `tables?: string[]` — the feature's tables, in **creation (dependency)
  order**. Uninstall drops them in **reverse** order (or `DROP … CASCADE`).
  Required for any feature that supports uninstall.
- `onEnable?: (client: PoolClient, key: FeatureKey) => Promise<void>` —
  optional init hook run inside the enable transaction AFTER migrations
  (seed defaults, register crons, warm cache). Must be idempotent.
- `onUninstall?: (client: PoolClient, key: FeatureKey) => Promise<void>` —
  optional cleanup hook run inside the uninstall transaction BEFORE dropping
  tables (deregister crons, purge external resources, cache clear). Idempotent.

Existing features keep working (all new fields optional). The `shop` entry
declares its full `tables` list + `onEnable` (seed default shop settings) +
`onUninstall` (clear shop caches).

## A2. Install: run the onEnable hook + relay status

- `applyFeatureMigrations(key, client)` (`features/migrations.ts`) unchanged
  for migrations; `updateSettings` (`services/settings.ts`) calls
  `registry[key].onEnable?.(client, key)` after `applyFeatureMigrations` for
  each newly-enabled step, inside the same transaction (rolls back together).
- **Install remains synchronous** (blocking the PUT). For the shop's ~10
  tables this completes in well under a second. The PUT `/settings` response
  for a feature toggle is extended to carry an install result:
  `{ message, features: [{ key, enabled, appliedMigrations: string[] }] }`
  so the client can display what ran. (An async job + polling model is noted
  as a future option if installs ever grow long; not built now.)

## A3. Uninstall/remove (new)

- **Route:** `POST /api/v1/settings/features/:key/uninstall` (admin only;
  rejects apiKey auth like other settings-management routes). Body:
  `{ confirm: true }` (belt-and-suspenders; the real guard is the client
  confirm modal).
- **Service** `settings.uninstallFeature(key, ctx)`:
  1. Advisory lock `feature:${key}` (transaction-scoped).
  2. Reject if `key` is not uninstallable (core modules `posts/pages/…` that
     ship in the base schema are NOT feature-migration-owned — only features
     with a `tables` list + feature-tagged migrations are uninstallable).
  3. Dependent-safety: if any ENABLED feature `requires` this one, reject with
     a `has_dependents` result (same shape as the cascade) unless the client
     already disabled them.
  4. In one transaction: run `onUninstall` hook → `DROP TABLE IF EXISTS`
     each `tables[]` entry in reverse order with `CASCADE` → `DELETE FROM
     schema_migrations WHERE feature = $key` → `DELETE FROM site_settings
     WHERE key = '<key>_enabled'` and any other feature-owned settings keys
     (declared or `<key>_*` prefixed) → audit `uninstall` action.
  5. Invalidate the public-settings cache.
- **Idempotency:** `DROP … IF EXISTS` + `DELETE … WHERE` make a repeat
  uninstall a no-op. Re-enabling later re-runs the migrations (their
  `schema_migrations` rows were removed), recreating the tables cleanly.
- **Errors:** any failure rolls back the whole transaction (no partial
  drops); the client receives a typed error + the feature stays as-is.

## A4. Runtime feature-gate for routes

- Add `requireFeature(key)` — a small guard (reads the cached
  enabled-features projection; falls back to a `site_settings` read) that
  returns **404 Not Found** when the feature is disabled, so a disabled
  feature's endpoints behave as if they don't exist. Applied to the Shop
  module at mount (either via a `feature` option on `registerModule` or a
  `pre`-style guard on every shop route). Public shop reads and admin writes
  alike 404 when `shop` is off.

## A5. Client: status + uninstall UX

- `FeatureToggleRow` (`components/admin/features/`): add `busy` state —
  during an enable/disable/uninstall the switch is disabled and shows a
  spinner + "Installing…" / "Removing…" label; on completion a toast reports
  success (with what installed) or the error. Prevents double-clicks.
- A **disabled** feature row shows a subtle "Disabled — data preserved" hint
  and a **Remove…** action (trash affordance). Clicking opens a destructive
  confirm modal ("Permanently delete all <Feature> data and tables? This
  cannot be undone." + type-to-confirm or a hold-to-confirm) → on confirm
  calls the uninstall SDK method, shows the removing state, then refreshes.
- SDK: `cms.settings.uninstallFeature(key)` → `POST
  /settings/features/:key/uninstall`. The install status comes back from the
  existing `cms.settings.update(...)` response (extended shape).
- Store: `isFeatureEnabled` unchanged; the shop projection is added to
  `computePublicFeatures` and `SiteFeatures` (shared type) + the frontend
  `MODULE_FEATURES`/features map so the nav + gating react.

## A6. Shared/DTO for lifecycle

- `SiteFeatures` (shared) gains `shop: { enabled: boolean }`.
- Settings route DTOs gain the uninstall body/response + the extended update
  response (`SettingsFeatureInstallResult`). Backend binds them.

---

# Part B — Shop feature

## B1. Data model (migrations `039`–`~049`, `-- @feature shop`)

All tables `-- @feature shop`, `gen_random_uuid()` PKs, `created_at/updated_at`
+ triggers, FK ON DELETE strategies, indexes. Declared in the registry
`tables` list (creation order).

- **`shop_products`** — `title`, `slug` (unique), `description`, `type`
  (physical|digital), `status` (draft|active|archived), SEO fields,
  `rating_avg` NUMERIC, `rating_count` INT (denormalized), `created_by`
  (uuidOrNull), timestamps.
- **`shop_product_options`** — `product_id` FK CASCADE, `name`, `position`
  (≤3 per product).
- **`shop_option_values`** — `option_id` FK CASCADE, `value`, `position`.
- **`shop_variants`** — `product_id` FK CASCADE, `sku`, `price_cents`,
  `compare_at_price_cents`, `inventory_qty`, `weight_grams`,
  `requires_shipping`, `option1`/`option2`/`option3` (value strings),
  `image_id` (FK media SET NULL), `position`, `is_default`. Unique
  `(product_id, option1, option2, option3)`.
- **`shop_product_media`** — `product_id` FK CASCADE, `media_id` (FK media
  CASCADE), `variant_id` (FK variant SET NULL, optional), `position`,
  `kind` (image|video derived from media). Position 0 = main.
- **`shop_categories`** — `name`, `slug`, `parent_id` (self-FK SET NULL,
  hierarchical), `position`, `description`, `image_id`.
- **`shop_product_categories`** — m2m (`product_id`, `category_id`).
- **`shop_collections`** — `title`, `slug`, `description`, `image_id`,
  `position`, `is_published`.
- **`shop_collection_products`** — m2m + `position` (curated order).
- **`shop_product_tags`** — normalized (`product_id`, `tag`) for reuse/
  autocomplete; a distinct-tags query powers the admin filter.
- **`shop_reviews`** — `product_id` FK CASCADE, `user_id` (uuidOrNull),
  `order_id` (FK SET NULL, verified-purchase link), `rating` 1–5, `title`,
  `body`, `status` (pending|approved|rejected), `verified_purchase`,
  `helpful_count`, timestamps.
- **`shop_orders`** — `order_number` (human, unique), `user_id` (uuidOrNull,
  guest allowed), `customer_email`, `customer_name`, `status`
  (pending|paid|processing|shipped|delivered|cancelled|refunded),
  `subtotal_cents`, `tax_cents`, `shipping_cents`, `discount_cents`,
  `total_cents`, `currency`, `stripe_payment_intent_id`, `stripe_charge_id`,
  `shipping_address` JSONB, `billing_address` JSONB, `fulfillment_status`,
  `tracking_number`, `notes`, timestamps.
- **`shop_order_items`** — `order_id` FK CASCADE, snapshot fields
  (`product_id`, `variant_id`, `title`, `variant_title`, `sku`,
  `unit_price_cents`, `quantity`, `subtotal_cents`, `is_digital`,
  `download_token`).
- Seed default `shop_settings` / `shop_appearance` via `onEnable` (or a seed
  migration) — kept out of the destructive-drop list (they're `site_settings`
  rows, cleaned by the settings-key deletion on uninstall).

Cart: **no table** (client-side). Inventory: per-variant `inventory_qty`
(decremented on paid webhook; optionally reserved at checkout — v1
decrements on payment success, rejects checkout if insufficient at order
creation).

## B2. Backend modules (manifest framework, mount `/api/v1/shop`, `requireFeature('shop')`)

File-set (one cohesive module with grouped sub-resources):
- `services/shop/` — split by concern: `products.ts`, `variants.ts`,
  `catalog.ts` (categories/collections/tags), `reviews.ts`, `orders.ts`,
  `checkout.ts`, `settings.ts` (shop config). A `services/shop/index.ts`
  aggregates for the `cms.shop` sdk shim.
- `repositories/shop/` — matching repos (`shopProducts.repo.ts`,
  `shopOrders.repo.ts`, etc.) using `base.repo` helpers, `mapRow`,
  `uuidOrNull`.
- `routes/shop.ts` — the `defineRoute` array (all shop routes), registered
  via `registerModule('shop', shopRoutes, { mountPath:'/api/v1/shop',
  feature:'shop' })`.
- `sdk/shop.ts` — re-export the services aggregate for `cms.shop`.

### Routes + permissions (all under `/api/v1/shop`)
| Path | Method | Auth | Notes |
|---|---|---|---|
| `/products` | GET | public | active/published only; cached (public-safe); admin/key sees all via `status`/`all` |
| `/products/slug/:slug` | GET | public | with variants/options/media/reviews-summary |
| `/products/:id` | GET | admin | any status, full detail |
| `/products` `/products/:id` | POST/PUT/DELETE | admin | CRUD; variants/options/media managed as nested writes or sub-routes |
| `/products/:id/variants` … | admin | variant CRUD + inventory |
| `/products/:id/media` … | admin | attach/sort/main media (media_id from library) |
| `/categories`, `/collections`, `/tags` | GET public / write admin | taxonomy |
| `/reviews` (`?productId=`) | GET public (approved) | list |
| `/products/:id/reviews` | POST | user | write review (verified badge if bought) |
| `/reviews/:id` (moderate) | PATCH/DELETE | admin | approve/reject/delete |
| `/checkout` | POST | optional | guest or user → validate cart, Stripe Tax calc, create order(pending)+items, PaymentIntent → `{ clientSecret, orderId, orderNumber }` |
| `/orders` | GET | user (own) / admin (all) | role-shaped |
| `/orders/:id` (or `/orders/number/:n`) | GET | user (own) / admin | detail |
| `/orders/:id` | PATCH | admin | status/fulfillment/tracking/notes; refund; resend receipt/email |
| `/settings` | GET public (storefront-safe) / GET+PUT admin | full config |
| `/webhook` handled by existing `/api/v1/payments/webhook` OR a shop-specific raw route | public raw | `payment_intent.succeeded` for shop orders → mark paid, decrement inventory, digital fulfillment, receipt email |

Checkout **re-validates** every line item's price/availability server-side
(never trusts client totals); computes subtotal from DB, tax via Stripe Tax,
shipping from config; the PaymentIntent amount = server total. Sacred
patterns: `uuidOrNull` on guest `user_id`; cache guard on public product
lists (active-only → cache for anonymous only); `isAdminRole||apiKey` on
admin branches; orders filtered to the caller's `user_id`/email for the
"my orders" (user) tier.

Webhook decision: extend the existing payments webhook dispatcher to route
`metadata.orderType === 'shop'` intents to the shop order handler (keeps one
raw webhook mount), OR a dedicated shop raw route — plan picks the
lower-risk extension of the existing dispatcher.

## B3. Shared types + DTOs
- `packages/shared/src/types/shop.ts` — entity types (Product, ProductOption,
  Variant, ProductMedia, Category, Collection, Review, Order, OrderItem,
  ShopSettings, ShopAppearance).
- `packages/shared/src/api/routes/shop.ts` — request/response DTOs per
  endpoint (module-prefixed `Shop*`), barrel-exported; backend binds zod.

## B4. SDK — `cms.shop.*`
`packages/cms-client/src/modules/shop.ts` — a `ShopModule` grouping typed
sub-namespaces: `.products`, `.variants`, `.categories`, `.collections`,
`.tags`, `.reviews`, `.orders`, `.checkout`, `.settings`. Registered in
`modules/index.ts` + `coverage.ts` (drift check enforces every shop route is
covered or allowlisted). Paginated lists return `Paginated<T>`.

## B5. Admin UI (`/admin/shop/*`, feature-gated nav)
- Nav: `{ path:'/admin/shop', label:'Shop', icon:'shop', feature:'shop' }`.
- Routes (rendered only when enabled):
  `/admin/shop` (dashboard), `/admin/shop/products` (+ `/new`, `/:id` editor
  with options/variants matrix + media picker/sort + category/collection/tag
  assignment + per-variant price/inventory), `/admin/shop/categories`,
  `/admin/shop/collections`, `/admin/shop/orders` (+ `/:id` detail: items,
  customer/shipping, status transitions, tracking, contact/email buyer,
  refund), `/admin/shop/reviews` (moderation), `/admin/shop/settings`
  (tabs: General · Payments/Stripe-Tax/business · Shipping · Appearance).
- Reuses `MediaSelectModal`, `usePaginatedList({fetch})`,
  `useBulkActions`, the admin styles partials.

## B6. Storefront (`/shop/*`, gated on `isFeatureEnabled('shop')`)
- `/shop` — product grid (replaces the Shopify iframe), filter by
  category/collection/tag, search, pagination, rendered per Shop Appearance
  settings + `--site-*` tokens.
- `/shop/:slug` — product detail: media gallery (images+video, sorted, main),
  variant selector (color/size → resolves to a variant), price, add-to-cart,
  description, reviews list + write-review, rating summary.
- `/shop/collections/:slug`, `/shop/categories/:slug` — filtered grids.
- `/shop/cart` (client cart), `/shop/checkout` (address + Stripe Elements +
  live Stripe-Tax total + place order), `/shop/orders/:number` (confirmation
  + status; digital download links), mini-cart in the header.
- Cart state: a small `shopCart` store (localStorage), items = `{variantId,
  qty}`; resolves display data from `cms.shop.products`/variants.

## B7. Phased implementation
0. **Feature lifecycle** — Part A (registry hooks, onEnable, install status
   relay, uninstall endpoint/service, requireFeature guard, client
   busy/remove UX, SDK). Verified against an existing feature (e.g. a dry-run
   uninstall of a disabled test feature) + unit tests.
1. **Shop foundation** — registry `shop` entry + migrations (schema) +
   shared types/DTOs + `requireFeature` mount.
2. **Catalog backend** — products/options/variants/media/categories/
   collections/tags services, repos, routes, SDK, drift.
3. **Reviews backend** + moderation + rating denormalization.
4. **Checkout + orders backend** — cart validation, Stripe Tax, PaymentIntent,
   webhook routing, order/fulfillment, digital delivery, receipts, SDK.
5. **Shop settings backend** — config/appearance keys, Stripe/tax/shipping/
   business; storefront-safe projection.
6. **Admin UI** — Shop menu + all sub-pages.
7. **Storefront UI** — grid, product detail, cart, checkout, collection/
   category pages, reviews, mini-cart; replace `Shop.tsx`.
8. **Docs + verify** — CLAUDE.md, API.md/manifest regen, feature docs,
   end-to-end smoke (enable shop → seed a product → guest checkout →
   webhook-paid order → uninstall shop → data gone).

## Risks / mitigations
- **Uninstall data loss** — destructive by design; guarded by admin-only +
  type-to-confirm modal + transactional (no partial drops) + dependent-safety.
- **Install status for long migrations** — synchronous is fine for shop's
  table count; async job noted as future if needed.
- **Checkout trust** — server re-validates prices/inventory; Stripe Tax +
  PaymentIntent amount computed server-side only.
- **Variant complexity** — bounded to ≤3 options (option1/2/3); default
  variant unifies simple + variant products.
- **Feature gating** — `requireFeature` 404s disabled-shop routes; nav +
  storefront routes conditional; migration runner already skips disabled at
  boot.
- **Scope** — large; delivered in 9 phases, each builds + tests green, one
  concern at a time.

## Out of scope (v1)
- Shared/component inventory (blank-shirt pooled stock) — per-variant only.
- Stripe Connect / multi-seller marketplace.
- Discounts/coupons engine, gift cards, subscriptions-as-products (the
  existing subscriptions feature is separate) — notable future extensions.
- Carrier-calculated shipping / real-time rates (flat/table only).
- Async install job + polling (synchronous install retained).
