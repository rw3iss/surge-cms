# Shopify plugin

**Overrides** the built-in Shop feature with a connected Shopify store. When
enabled, the public storefront reads products/collections live from Shopify and
hands checkout off to Shopify's hosted checkout; the admin Shop pages become a
read-only dashboard over Shopify data with links to the Shopify admin. The
internal shop (products/orders/Stripe checkout) is untouched and returns the
moment the plugin is disabled.

Plugin dir: `packages/api/plugins/shopify/`. Full guide: `docs/how-it-works/SHOPIFY.md`.

## How it works

- **`server.js`** — server-side **Storefront GraphQL** client (products,
  collections, cart) + **Admin GraphQL** client (orders, stats). All access uses
  the secret tokens (never sent to the browser). Shopify objects are **adapted**
  into the CMS `Shop*` shapes so the existing Solid components render unchanged.
  Actions (via `POST /api/v1/plugins/shopify/action/:action`): `testConnection`,
  `listProducts`, `getProduct`, `listCollections`, `getCollection`, `cartCreate`,
  `cartGet`, `cartLinesAdd/Update/Remove`, `listOrders`, `shopStats`. Every action
  returns a normalized `{ ok, ... }` / `{ ok:false, status, error }` envelope.
- **`client.js`** — `mountConfig`: shop domain, Storefront token, Admin token,
  API version, with **Save / Test connection / Preview products**.
- **Checkout** — the storefront builds a Shopify cart (`cartCreate`) and
  **full-page-redirects** to `cart.checkoutUrl` (the only supported headless
  checkout since Shopify removed the Checkout API in 2025-04). No iframe.

## Configure

Admin → **Plugins → Shopify**: set the **Shop domain**
(`my-store.myshopify.com`), the **Storefront API access token** (Headless /
Storefront app), and optionally the **Admin API access token** (`shpat_…`, for
the admin orders/stats dashboard). **Test connection**, then Enable. The Shop
feature must also be enabled for the shop routes/nav to exist.

## Notes / future work

- Reviews/ratings aren't exposed by the Storefront API by default → shown as 0 /
  hidden while Shopify is active.
- Shopify has no "categories" → category routes reuse collections.
- Product pages render client-side via the action-RPC (no SSR body) — server-side
  mirroring for SEO is future work.
- Admin order history is limited to Shopify's default 60-day window unless the
  Admin token has `read_all_orders`.
