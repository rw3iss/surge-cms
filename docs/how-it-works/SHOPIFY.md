# Shopify Storefront plugin

**Overrides** the built-in Shop feature with a connected Shopify store. When
enabled (alongside the `shop` feature), the public storefront reads live Shopify
products/collections and hands checkout off to Shopify's hosted checkout; the
admin Shop pages become a read-only dashboard over Shopify data with links to the
Shopify admin. The internal shop (products/orders/Stripe checkout) is untouched
and returns the moment the plugin is disabled.

Plugin dir: `packages/api/plugins/shopify/`. Builds on the generic plugin
**action-RPC** (`docs/how-it-works/PLUGINS.md`) and the `stores/plugins` gating.

## Architecture

All Shopify API access is **server-side** (`server.js`), proxied through
`POST /api/v1/plugins/shopify/action/:action` — secret tokens never reach the
browser. Shopify GraphQL objects are **adapted** into the CMS `Shop*` types
(`shared/types/shop.ts`) so the existing Solid components render unchanged. The
frontend routes through one seam, `services/shopifySource.ts`, which branches on
`isPluginEnabled('shopify')`; every shop page/guard consults it. Adds no DB tables
and no core schema changes.

- **Storefront API** (`https://{shopDomain}/api/{version}/graphql.json`, header
  `X-Shopify-Storefront-Access-Token`) — products, collections, cart. Public data;
  token kept server-side anyway.
- **Admin API** (`https://{shopDomain}/admin/api/{version}/graphql.json`, header
  `X-Shopify-Access-Token`, `shpat_…`) — orders + stats for the admin dashboard.
  Optional; the storefront works without it.

## Config

`shopDomain` (public — used for "Open in Shopify" links + checkout origin),
`storefrontToken` (secret), `adminToken` (secret, optional), `apiVersion`
(default `2024-10`).

## Actions (server.js)

`testConnection`, `listProducts`, `getProduct`, `listCollections`,
`getCollection`, `cartCreate`, `cartGet`, `cartLinesAdd`, `cartLinesUpdate`,
`cartLinesRemove`, `listOrders` (admin), `shopStats` (admin). Each returns a
normalized `{ ok, ... }` / `{ ok:false, status, error }` envelope; none throw.

## Storefront override

- **Index / product / collection / category** pages read from `shopifySource.*`.
  Category routes reuse Shopify collections (Shopify has no categories). Product
  reviews are hidden (not exposed by the Storefront API).
- **Cart** stays in the existing localStorage store; line `variantId` is the
  Shopify variant GID.
- **Checkout** (`ShopCheckout.tsx`): when Shopify is active it **bypasses Stripe**
  — builds a Shopify cart (`cartCreate`) and **full-page-redirects** to
  `cart.checkoutUrl`. This is the only supported headless checkout (Shopify
  removed the Checkout API in 2025-04); no iframe.

## Admin override

`ShopDashboard`, `ShopProducts`, `ShopOrders` show a `ShopifyManagedBanner`, pull
data from Shopify (read-only), and link to the Shopify admin. `ShopProductEditor`,
`ShopCategories`, `ShopCollections`, `ShopReviews`, `ShopSettings` show the banner
noting the surface is Shopify-managed (the internal UI stays visible but inactive
for the storefront).

## Configure + use

1. Enable the **Shop** feature (Settings → Features) so the shop routes/nav exist.
2. Admin → **Plugins** → install + enable **Shopify** → config page → set the shop
   domain, Storefront token, and (optionally) Admin token → **Test connection**.
3. The public `/shop/*` and admin `/admin/shop/*` now serve Shopify data.

## Limitations / future work

- No live-store verification without credentials — the GraphQL queries/adapters
  are validated by wiring/types/builds, not against a real store.
- Reviews/ratings not exposed by the Storefront API → shown as 0 / hidden.
- Product pages render client-side (no SSR body) → server-side mirroring for SEO
  is future work.
- Admin order history is Shopify's default 60-day window unless the Admin token has
  `read_all_orders`.
- Reference only (not a dependency): `github.com/johnnylinsf/givebutter-mcp`
  (pattern), Shopify Storefront/Admin GraphQL docs.
