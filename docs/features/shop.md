# Shop (Ecommerce) Feature

The `shop` feature adds a native, self-hosted ecommerce store to SiteSurge:
a product catalog with variants and media, categories/collections/tags,
moderated reviews, on-site Stripe checkout (guest or logged-in), orders with
fulfillment and digital delivery, and a configurable storefront.

It is a **toggle-able feature module** (`shop`, requires `users`). Everything —
API routes, admin pages, storefront routes — exists only while the feature is
enabled; disabled, the API 404s and the UI hides. Enable/disable and full
uninstall (drop tables + data) run through the feature-lifecycle system.

- **Feature key:** `shop` (requires `users`)
- **API mount:** `/api/v1/shop/*` (guarded by `requireFeature('shop')`)
- **SDK:** `cms.shop.*`
- **Admin:** `/admin/shop/*`
- **Storefront:** `/shop/*`
- **Migrations:** `039`–`049` (`-- @feature shop`)
- **Spec:** `docs/superpowers/specs/2026-06-08-shop-feature-design.md`

---

## Data model

All tables use `gen_random_uuid()` PKs, `created_at`/`updated_at` with
triggers, and are declared (in creation order) in the registry `tables` list
so uninstall can drop them in reverse with `CASCADE`.

| Table | Purpose | Key columns / relationships |
|-------|---------|-----------------------------|
| `shop_products` | Catalog entry | `title`, `slug` (unique), `description`, `type` (physical\|digital), `status` (draft\|active\|archived), SEO, `rating_avg`/`rating_count` (denormalized), `created_by` |
| `shop_product_options` | Option axes (≤3/product) | `product_id`→products CASCADE, `name`, `position` |
| `shop_option_values` | Values per option | `option_id`→options CASCADE, `value`, `position` |
| `shop_variants` | Purchasable SKU | `product_id` CASCADE, `sku`, `price_cents`, `compare_at_price_cents`, `inventory_qty`, `weight_grams`, `requires_shipping`, `option1/2/3`, `image_id`→media SET NULL, `is_default`. Unique `(product_id, option1, option2, option3)` |
| `shop_product_media` | Images + video | `product_id` CASCADE, `media_id`→media CASCADE, `variant_id`→variant SET NULL, `position` (0 = main), `kind` (image\|video) |
| `shop_categories` | Hierarchical taxonomy | `name`, `slug`, `parent_id` self-FK SET NULL, `position`, `image_id` |
| `shop_product_categories` | m2m | `(product_id, category_id)` |
| `shop_collections` | Curated grouping | `title`, `slug`, `description`, `image_id`, `position`, `is_published` |
| `shop_collection_products` | m2m + order | `(collection_id, product_id, position)` |
| `shop_product_tags` | Normalized tags | `(product_id, tag)` — distinct-tag query powers filters |
| `shop_reviews` | Product reviews | `product_id` CASCADE, `user_id` (nullable), `order_id`→orders SET NULL, `rating` 1–5, `title`, `body`, `status` (pending\|approved\|rejected), `verified_purchase`, `helpful_count` |
| `shop_orders` | Order header | `order_number` (unique), `user_id` (nullable, guest allowed), `customer_email/name`, `status` (pending\|paid\|processing\|shipped\|delivered\|cancelled\|refunded), `subtotal/tax/shipping/discount/total_cents`, `currency`, `stripe_payment_intent_id`, `stripe_charge_id`, `shipping_address`/`billing_address` JSONB, `fulfillment_status`, `tracking_number`, `notes` |
| `shop_order_items` | Line-item snapshots | `order_id` CASCADE, `product_id`, `variant_id`, `title`, `variant_title`, `sku`, `unit_price_cents`, `quantity`, `subtotal_cents`, `is_digital`, `download_token` |

**Cart has no table** — it is client-side (localStorage via `stores/shopCart`);
the order row is created server-side at checkout. Inventory is per-variant
(`inventory_qty`), decremented on the paid webhook.

Shop config lives in two `site_settings` rows (`shop_settings`,
`shop_appearance`, both JSONB) seeded by the `onEnable` hook; they are removed
on uninstall via the registry `settingsKeys` list.

---

## Routes + permissions (`/api/v1/shop`)

Auth tiers: **public** (no auth) · **optional** (anon allowed; a valid session
or admin API key enriches the response) · **user** (any authenticated user) ·
**admin** (admin role / `admin` API-key scope). Every route additionally 404s
when the feature is disabled.

| Path | Method | Auth | Notes |
|------|--------|------|-------|
| `/products` | GET | optional | active-only + cached for anon; `all=true` (admin) → all statuses. Adds `fromPriceCents`/`primaryImageUrl` |
| `/products/slug/:slug` | GET | optional | full nested detail (options/variants/media/review summary) |
| `/products/:id` | GET | admin | any-status detail |
| `/products`, `/products/:id` | POST/PUT/DELETE | admin | CRUD; variants/options/media managed as nested writes |
| `/products/bulk` | POST | admin | bulk actions |
| `/categories`, `/categories/slug/:slug` | GET | public | taxonomy read |
| `/categories`, `/categories/:id` | POST/PUT/DELETE | admin | taxonomy write |
| `/collections` | GET | optional | published-only for anon; `all=true` admin |
| `/collections/slug/:slug` | GET | public | detail |
| `/collections`, `/collections/:id` | POST/PUT/DELETE | admin | write |
| `/tags` | GET | public | distinct tag list |
| `/products/:productId/reviews` | GET | optional | approved-only, paginated |
| `/products/:productId/reviews` | POST | user | create pending review (verified badge if bought) |
| `/reviews/:id/helpful` | POST | optional | increment helpful count |
| `/reviews` | GET | admin | moderation queue (any status) |
| `/reviews/:id` | PUT/DELETE | admin | approve/reject/delete → recompute product rating |
| `/checkout/preview` | POST | optional | server-priced totals (Stripe Tax) without creating an order |
| `/checkout` | POST | optional | validate cart, create order(pending)+items, PaymentIntent → `{ clientSecret, orderId, orderNumber, totalCents }` |
| `/orders` | GET | user (own) / admin (all) | role-shaped, paginated |
| `/orders/:id` | GET | user / admin | detail |
| `/orders/number/:orderNumber` | GET | optional | confirmation-page detail |
| `/orders/:id` | PATCH | admin | status/fulfillment/tracking/notes/refund |
| `/orders/:id/resend-receipt` | POST | admin | resend the receipt email |
| `/orders/:orderNumber/download/:token` | GET | token-gated | digital delivery (resolves the file URL) |
| `/settings` | GET | optional | storefront-safe projection (no secret keys) |
| `/settings/admin` | GET | admin | full config |
| `/settings` | PUT | admin | merge partial config → full config |

**Checkout never trusts the client:** subtotal is recomputed from DB prices,
availability re-validated per line item, tax via Stripe Tax, shipping from
`shop_settings`; the PaymentIntent amount equals the server-computed total.
Orders are filtered to the caller's `user_id`/email for the user (own) tier.

---

## SDK — `cms.shop.*`

`ShopModule` (`packages/cms-client/src/modules/shop.ts`) groups typed
sub-namespaces (paginated lists return `Paginated<T>`; single reads return the
entity/detail directly):

- `cms.shop.products` — `listPublic` · `list` (admin, `all=true`) · `getBySlug` · `getById` · `create` · `update` · `remove` · `bulk`
- `cms.shop.categories` — `list` · `getBySlug` · `create` · `update` · `remove`
- `cms.shop.collections` — `list` · `getBySlug` · `create` · `update` · `remove`
- `cms.shop.tags` — `list`
- `cms.shop.reviews` — `list(productId)` · `create(productId, body)` · `markHelpful(id)` · `adminList` · `moderate(id, body)` · `remove(id)`
- `cms.shop.checkout` — `preview(body)` · `create(body)`
- `cms.shop.orders` — `list` · `get(id)` · `getByNumber(n)` · `update(id, body)` · `resendReceipt(id)` · `downloadUrl(n, token)`
- `cms.shop.settings` — `getPublic()` · `getAdmin()` · `update(body)`

```ts
const { data: products } = await cms.shop.products.listPublic({ page: 1 });
const product = await cms.shop.products.getBySlug('t-shirt');
const preview = await cms.shop.checkout.preview({ items: [{ variantId, qty: 2 }] });
const { clientSecret, orderNumber } = await cms.shop.checkout.create({ /* items + address */ });
```

All routes are covered by the drift check (`npm run check:drift -w
packages/cms-client` against `docs/api-manifest.json`).

---

## Checkout flow

1. **Cart** — client-side (`stores/shopCart`, localStorage): `{ variantId, qty }[]`.
2. **Preview** — `POST /shop/checkout/preview` prices the cart from the DB and
   runs a Stripe Tax calculation; the checkout page shows live totals. No order
   is created.
3. **Create** — `POST /shop/checkout` re-validates every line item (variant
   exists, active, `inventory_qty ≥ qty`), computes subtotal from DB prices,
   shipping from `shop_settings`, tax via Stripe Tax, creates a `pending`
   `shop_orders` row + `shop_order_items` snapshots, then creates a
   PaymentIntent (`amount = server total`, `metadata.orderType='shop'`,
   `metadata.orderId`) and returns `{ clientSecret, orderId, orderNumber, totalCents }`.
4. **Pay** — the storefront `CheckoutPage` confirms the PaymentIntent with
   Stripe Elements (the DonationForm Elements pattern is the reference).
5. **Webhook fulfillment** — the existing `payments.handleWebhook` dispatcher
   routes `payment_intent.succeeded` with `metadata.orderType === 'shop'` to
   `services/shop/fulfillment.fulfillShopOrder` (single raw webhook mount).
   Transactionally: mark the order `paid`, decrement each variant's inventory
   (guard against oversell), mint digital `download_token`s for digital items,
   send the receipt email, and insert a `transactions` row.
6. **Confirmation** — `/shop/orders/:number` shows status + digital download
   links; the download route is token-gated.

Webhook fulfillment is signature-verified server-side and is covered by unit
tests (it cannot be triggered without a live Stripe webhook).

---

## Enable / uninstall lifecycle

Enable and uninstall go through the hardened feature-lifecycle system
(see the "Feature module system" entry in the root `CLAUDE.md`).

**Enable** — `PUT /api/v1/settings` with `{ features: { shop: true } }`
(requires `users` enabled first). Inside one advisory-locked transaction the
runner applies migrations `039`–`049`, then runs the `onEnable` hook (seeds
`shop_settings` + `shop_appearance`). The response relays what ran:

```json
{ "message": "…",
  "features": [{ "key": "shop", "enabled": true,
                 "appliedMigrations": ["039_create_shop_products.sql", "…", "049_create_shop_order_items.sql"] }] }
```

**Uninstall** — `POST /api/v1/settings/features/shop/uninstall` with
`{ confirm: true }` (admin, JWT only — API keys rejected). Transactionally runs
`onUninstall` → `DROP TABLE … CASCADE` on the 13 owned tables (reverse order)
→ deletes `schema_migrations WHERE feature='shop'` → deletes the owned
`site_settings` rows (`shop_enabled`, `shop_settings`, `shop_appearance`) →
audits, returning `{ droppedTables: [...] }`. Dependent-safety rejects if an
enabled feature still requires `shop`. Idempotent (`IF EXISTS` / `DELETE …
WHERE`); re-enabling later re-runs the migrations and recreates the tables
cleanly. From the admin UI, disabled features show a type-to-confirm **Remove…**
modal wired to `cms.settings.uninstallFeature('shop')`.

---

## Stripe requirements

- **Secret key** (backend): `STRIPE_SECRET_KEY` in `packages/api/.env` — used
  for PaymentIntents, Stripe Tax calculations, refunds, and webhook signature
  verification. Without it, checkout fails at the PaymentIntent creation step
  (order validation + pending-order creation still run).
- **Publishable key** (frontend): `VITE_STRIPE_PUBLISHABLE_KEY` — loaded by the
  storefront `ShopCheckout` page (same var the DonationForm/Subscribe pages use)
  to mount Stripe Elements.
- **Stripe Tax** must be enabled on the Stripe account for automatic tax
  calculation; the `shop_settings.taxEnabled` flag gates the tax step.
- **Webhook** — the single existing raw mount `/api/v1/payments/webhook`
  handles shop orders (routed by `metadata.orderType === 'shop'`); no separate
  shop webhook endpoint.
