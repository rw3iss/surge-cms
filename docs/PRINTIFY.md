# Printify Integration — Design & Implementation

Print-on-demand integration that **syncs Printify products into the built-in
Shop** (products, variants, images, tags → categories/types), lets customers buy
them through the existing **Stripe checkout**, and **submits paid orders to
Printify** for fulfillment. Reviews, categories, collections, search, and the
storefront/admin all work natively because Printify products are ingested as
real `shop_products` rows.

Contrast with the **Shopify** plugin, which is a live *proxy/override* (stores
nothing, disables reviews). Printify is an **ingest** integration.

## Store model (important)

The test store is a Printify **`custom_integration`** sales channel. That means:
- **We** own the storefront and **payment** (Stripe) — Printify does *not* host
  checkout or collect customer payment.
- **Printify** handles **fulfillment**: on a paid order we POST the order to
  Printify's Orders API; Printify prints + ships and bills *us* the wholesale
  `cost`. Customer pays *us* the retail `price` (already set per-variant in
  Printify).

## Architecture (hybrid: thin plugin + core engine)

A sandboxed plugin (isolated to `ctx.db`/`ctx.httpJson`) can't reuse the shop
write-repos or hook the checkout lifecycle. So:

- **Plugin `packages/api/plugins/printify/`** — the enable/config/credentials/CSP
  veneer (like every other plugin): `plugin.json` (config schema + CSP),
  `server.js` (`validateConfig` + a `testConnection` action), `client.js` (config
  form + Test connection). The API token (secret) + shop id live in the plugin's
  config row.
- **Core `packages/api/src/services/printify/`** — the engine, reused by the sync
  route, the cron, and the order hook:
  - `config.ts` — `getPrintifyConfig()` reads the `printify` plugin's DB config
    row (token/shopId/interval/…); returns `null` when the plugin is disabled or
    unconfigured (so nothing runs unless the operator opted in).
  - `client.ts` — Printify REST client over `https://api.printify.com/v1`
    (`Authorization: Bearer <token>`): `listProducts`, `getProduct`, `shops`,
    `createOrder`, `shippingRates`, order reads.
  - `adapter.ts` — Printify product → shop upsert shape (title, description,
    variants from enabled+available Printify variants [price in cents], options
    Colors/Sizes, external image URLs, tags, product-type category from tags).
  - `sync.ts` — `syncProducts()`: fetch all Printify products, upsert into the
    shop (keyed on `external_provider='printify'` + `external_id`) via the
    existing product/variant/media/taxonomy repos, then **reconcile**: products
    that vanished from Printify (or `is_deleted`/not `visible`) are set to
    `status='archived'` (soft delete; a later sweep can hard-delete). Records a
    sync log row.
  - `fulfillment.ts` — `submitOrder(order)`: on a paid order containing Printify
    line items, POST to Printify Orders API (line items → Printify variant ids,
    shipping address, shipping method). Stores the Printify order id + status.
- **Core routes** (shop feature, gated on printify enabled+configured):
  `POST /shop/printify/sync` (admin, manual), `GET /shop/printify/status`.
- **Core cron** — a ~1h (configurable) `printify:sync` job registered when the
  plugin is enabled; on-demand via the route/button. The cron/route just refresh
  the ingested rows (which are the cache).
- **SDK** — `cms.shop.printify.sync()` / `.status()`.

## Data model — external-source support (core migration)

Migration `076_shop_external_source.sql` (`-- @feature shop`):
- `shop_products`: `external_provider VARCHAR(32)`, `external_id VARCHAR(128)`,
  `external_url TEXT` (link to Printify editor), `external_synced_at TIMESTAMPTZ`;
  partial unique index `(external_provider, external_id)`.
- `shop_variants`: `external_id VARCHAR(128)` (Printify variant id).
- `shop_product_media`: `external_url TEXT`, and `media_id` made **nullable** so a
  Printify CDN image renders without importing a file. Read queries `COALESCE`
  `media.url` → `shop_product_media.external_url`.

Everything else (categories, collections, tags, reviews, orders) is reused
as-is. Product types (Hoodies/Mugs/Hats…, already in Printify `tags`) map to
`shop_categories`. A `read-only`/external badge is derived from
`external_provider IS NOT NULL`.

## Admin UX

Printify products appear natively in the shop admin (list/search) with a
**"Managed by Printify — edit in Printify ↗"** badge and read-only editing
(reusing the Shopify-banner pattern). A **Sync from Printify** button + last-sync
status on the shop admin. Reviews are moderated normally.

## Checkout & fulfillment

- Printify products are native `shop_products` with variants + retail prices, so
  the existing **Stripe checkout works unchanged**. Server re-validates price at
  checkout as it already does.
- On a **paid** order, the order hook submits Printify line items to Printify's
  Orders API for fulfillment; the Printify order id/status is stored on the
  order. Shipping rates come from Printify (address-dependent) during checkout.
- Fulfillment/tracking status is synced back (webhook or poll) onto the order.

## Config (plugin `plugin.json`)

`apiToken` (secret), `shopId` (string), `syncIntervalMinutes` (number, default
60), `autoPublish` (boolean — import as `active` vs `draft`), `priceMarkupPercent`
(number, default 0 — Printify price is already retail; optional uplift). CSP:
`connectSrc: https://api.printify.com`, `imgSrc: https://images-api.printify.com`.

## Build phases

1. **Foundation** — migration + `ShopProduct` type/DTO fields + repo read-path
   for external media/provenance. ✅ first.
2. **Plugin veneer** — `plugin.json` + `server.js` (test) + `client.js` config.
3. **Sync engine** — core `services/printify/*` + routes + SDK; tested against the
   live store; admin Sync button + badge.
4. **Commerce** ✅ — Printify products sell through the existing Stripe checkout
   (native shop_products). At checkout, Printify line items get an address-based
   shipping quote from Printify's shipping API (added to the shop's own shipping).
   On a paid order (the `fulfillShopOrder` webhook hook, post-commit + best-
   effort), the order is submitted to Printify's Orders API (`external_id` = our
   order number) and — when `autoFulfill` is on — sent to production. The printify
   cron polls in-flight orders and syncs Printify status + tracking (number/url/
   carrier) back onto the order (migration 076); the confirmation page shows
   tracking. Order-body + shipping validated live against the store.

Each phase is committed + deployed working.

## Operate

Enable Plugins → install **Printify** → set token + shop id, **Test connection**
→ Shop → Products → **Sync from Printify**. Keep **Auto-fulfill paid orders**
OFF for the first test order (it's created in Printify but held, not produced);
turn it on for hands-off fulfillment.
