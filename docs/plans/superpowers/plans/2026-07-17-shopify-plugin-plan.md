# Shopify Storefront Plugin — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Each task ends with a build/typecheck gate. Reuse the GiveButter plugin (`packages/api/plugins/givebutter/`) + plugin action-RPC as the template.

**Goal:** A `shopify` plugin that, when enabled, **overrides** the built-in Shop feature: public storefront pages render live Shopify products/collections, cart/checkout hands off to Shopify's hosted checkout, and the admin Shop pages become a lightweight read-only dashboard over Shopify data with links to the Shopify admin.

**Architecture:** All Shopify API access is **server-side**, proxied through the plugin action-RPC (`POST /plugins/shopify/action/:action`) using secret tokens — no tokens in the browser. The plugin's `server.js` holds a Shopify **Storefront GraphQL** client (products, collections, cart) + **Admin GraphQL** client (orders, stats) and **adapts** Shopify objects into our existing `Shop*` types so the existing Solid components render unchanged. The frontend routes through a single `services/shopifySource.ts` seam that branches on `isPluginEnabled('shopify')`; internal-shop code paths are untouched when the plugin is off. Cart lines are kept in the existing localStorage `shopCart` store; **checkout** builds a Shopify cart via `cartCreate` and full-page-redirects to `cart.checkoutUrl` (the only supported headless checkout since the Checkout API was removed 2025-04). Adds no DB tables and no core schema changes.

**Tech stack:** Express/PG backend + `packages/api/plugins/shopify/`; SolidJS admin+public SPA (`packages/cms`); plugin action-RPC + `stores/plugins` (built for GiveButter).

## Research summary (Shopify)

- **Storefront API** (GraphQL `https://{shopDomain}/api/{version}/graphql.json`, header `X-Shopify-Storefront-Access-Token`): products (by `handle`), collections (by `handle`), variants, images, pricing. IDs are base64 GIDs. "Unauthenticated" (public data), but we keep the token server-side. Cacheable 5–10 min.
- **Cart API** (Storefront): `cartCreate(lines:[{merchandiseId, quantity}])` → `cart { id, checkoutUrl, cost{subtotalAmount,totalAmount}, lines }`; `cartLinesAdd/Update/Remove(cartId, …)`. Cart id is `<token>?key=<secret>` — persist the whole thing. **Checkout = full-page redirect to `cart.checkoutUrl`** (no iframe — Shopify sets `frame-ancestors`).
- **Admin API** (GraphQL `https://{shopDomain}/admin/api/{version}/graphql.json`, header `X-Shopify-Access-Token`, `shpat_` token): `orders(first:…)`, product counts, sales — server-side only. Orders default to last 60 days.
- Money arrives as decimal strings + `currencyCode`; convert `Math.round(parseFloat(amount)*100)` → cents.

## Design decisions

- **Override seam = frontend `shopifySource` + page-level branch** (not SDK interception): each shop page/guard checks `isPluginEnabled('shopify')` and reads from `shopifySource.*` (→ action-RPC) instead of `cms.shop.*`. Internal shop untouched when off.
- **Products stay live-queried** (Redis-cached in `server.js` via `ctx` is not available; cache in the action layer by returning fast — rely on Storefront's own speed + a short in-process TTL). No product mirroring/sync.
- **Admin pages become read-only** when Shopify is active: Dashboard, Products, Orders show Shopify data + a banner + "Open in Shopify" links; editing pages (product editor, categories, collections, reviews, settings) show a "managed by Shopify" notice.
- **Reviews** aren't exposed by the Storefront API by default → `ratingAvg/ratingCount = 0`, review UI hidden when Shopify active.
- Tokens are `secret` config → stripped from the public projection; `shopDomain` is public (needed for "Open in Shopify" links + checkout origin).

---

## Task 1: Shopify plugin backend (`packages/api/plugins/shopify/`)

**Files:** Create `plugin.json`, `server.js`, `client.js`, `README.md`, `.gitignore`.

- [ ] **Step 1: `plugin.json`**
```json
{
  "name": "shopify",
  "label": "Shopify Storefront",
  "version": "0.1.0",
  "apiVersion": 1,
  "server": "server.js",
  "client": "client.js",
  "capabilities": ["config-page"],
  "adminOnlyToggle": true,
  "csp": {
    "imgSrc": ["https://cdn.shopify.com", "https://*.myshopify.com"],
    "connectSrc": ["https://*.myshopify.com"],
    "frameSrc": ["https://*.myshopify.com"]
  },
  "configSchema": [
    { "key": "shopDomain", "label": "Shop domain (my-store.myshopify.com)", "type": "string", "required": true },
    { "key": "storefrontToken", "label": "Storefront API access token", "type": "secret", "required": true },
    { "key": "adminToken", "label": "Admin API access token (shpat_…)", "type": "secret" },
    { "key": "apiVersion", "label": "API version", "type": "string", "default": "2024-10" }
  ]
}
```

- [ ] **Step 2: `server.js`** — Storefront + Admin GraphQL clients, adapters, and actions. Structure:
  - `cfg(ctx)` → `{ shopDomain, storefrontToken, adminToken, version }` (strip protocol/trailing slash from domain).
  - `storefront(ctx, query, variables)` → POST `https://{domain}/api/{version}/graphql.json` with `X-Shopify-Storefront-Access-Token`; returns normalized `{ ok, data } | { ok:false, status, error }` (surface `errors[0].message`).
  - `admin(ctx, query, variables)` → POST `.../admin/api/{version}/graphql.json` with `X-Shopify-Access-Token`; same envelope; `{ ok:false, error:'Admin token not configured' }` when absent.
  - `money(m)` → `Math.round(parseFloat(m.amount)*100)`; helpers `adaptProduct(node)`, `adaptProductDetail(node)`, `adaptCollection(node)`, `adaptOrder(node)`.
  - **Actions** (all return normalized `{ ok, … }`):
    - `testConnection` — Storefront `{ shop { name } }`; if `adminToken`, also probe `{ shop { name } }` on Admin. Returns `{ ok, shopName, adminOk }`.
    - `listProducts({ limit=24, cursor, search })` — `products(first:$n, after:$cursor, query:$q)` → `{ ok, products: ShopProduct[], pageInfo:{hasNextPage,endCursor} }`.
    - `getProduct({ handle })` — `productByHandle(handle:$h)` with options, `variants(first:100){id,title,availableForSale,quantityAvailable,price,compareAtPrice,selectedOptions{name value}}`, `images(first:20){url,altText}` → `{ ok, product: ShopProductDetail }`.
    - `listCollections({ limit=50 })` — `collections(first:$n)` → `{ ok, collections: ShopCollection[] }`.
    - `getCollection({ handle, limit=48 })` — `collectionByHandle` + `products(first:$n)` → `{ ok, collection, products }`.
    - `cartCreate({ lines })` — `cartCreate(input:{lines})` → `{ ok, cart }` (adapt to `{ id, checkoutUrl, currency, subtotalCents, totalCents, lines:[{id,variantId,title,quantity,priceCents,image}] }`).
    - `cartGet({ cartId })`, `cartLinesAdd({ cartId, lines })`, `cartLinesUpdate({ cartId, lines })`, `cartLinesRemove({ cartId, lineIds })` — same adapted cart shape.
    - `listOrders({ first=20 })` (admin token) — `orders(first:$n, sortKey:CREATED_AT, reverse:true)` → `{ ok, orders:[{id,name,createdAt,email,customerName,financialStatus,fulfillmentStatus,totalCents,currency}] }`.
    - `shopStats()` (admin token) — `productsCount`/`ordersCount` + sum of recent `orders` totals → `{ ok, productCount, orderCount, recentSalesCents, currency }`.
  - `validateConfig(config)` — require `shopDomain` + `storefrontToken`; if `apiVersion` set, match `/^\d{4}-\d{2}$/`.
  - Lifecycle: `install`/`onEnable`/`onDisable`/`onLoad` (log only), `update` (no migration).
  - Every fetch wrapped in try/catch → normalized error; never throw.

- [ ] **Step 3: `client.js`** — `mountConfig(el, host)` (vanilla DOM like GiveButter): inputs for shopDomain, storefrontToken, adminToken, apiVersion; **Save**, **Test connection** (`host.api.post('/action/testConnection')` → shows shop name + admin status), **Preview products** (`listProducts` → first 5 titles).

- [ ] **Step 4: `README.md`** (mirror GiveButter's) + `.gitignore` = `.data/`.

- [ ] **Step 5: Gate.** `node -e "require('./packages/api/plugins/shopify/server.js')"` lists actions; `node --check client.js`; `node -e "require('./plugin.json')"`.

---

## Task 2: Frontend Shopify data seam (`packages/cms`)

**Files:** Create `packages/cms/src/services/shopifySource.ts`.

- [ ] **Step 1:** A typed wrapper over the action-RPC returning our `Shop*` shapes, plus the active-check:
```ts
import type { ShopProduct, ShopProductDetail, ShopCollection } from '@sitesurge/types';
import { cms } from './cmsClient';
import { isPluginEnabled } from '../stores/plugins';

export const isShopifyActive = () => isPluginEnabled('shopify');
const call = <T,>(action: string, payload?: Record<string, unknown>) =>
    cms.plugins.action<T>('shopify', action, payload);

export interface ShopifyCart { id: string; checkoutUrl: string; currency: string; subtotalCents: number; totalCents: number; lines: Array<{ id: string; variantId: string; title: string; quantity: number; priceCents: number; image?: string }>; }

export const shopifySource = {
    listProducts: (p: { limit?: number; cursor?: string; search?: string }) =>
        call<{ ok: boolean; products: ShopProduct[]; pageInfo: { hasNextPage: boolean; endCursor?: string }; error?: string }>('listProducts', p),
    getProduct: (handle: string) =>
        call<{ ok: boolean; product?: ShopProductDetail; error?: string }>('getProduct', { handle }),
    listCollections: () => call<{ ok: boolean; collections: ShopCollection[]; error?: string }>('listCollections', {}),
    getCollection: (handle: string) =>
        call<{ ok: boolean; collection?: ShopCollection; products: ShopProduct[]; error?: string }>('getCollection', { handle }),
    cartCreate: (lines: Array<{ merchandiseId: string; quantity: number }>) =>
        call<{ ok: boolean; cart?: ShopifyCart; error?: string }>('cartCreate', { lines }),
    listOrders: (first = 20) => call<{ ok: boolean; orders: any[]; error?: string }>('listOrders', { first }),
    shopStats: () => call<{ ok: boolean; productCount?: number; orderCount?: number; recentSalesCents?: number; currency?: string; error?: string }>('shopStats', {}),
};
```

- [ ] **Step 2: Gate.** cms typecheck clean (component wiring comes in Tasks 3–4).

---

## Task 3: Public storefront override (plugin-gated)

**Files:** Modify `pages/shop/ShopIndex.tsx`, `ShopProduct.tsx`, `ShopCollection.tsx`, `ShopCategory.tsx`, `ShopCart.tsx`, `ShopCheckout.tsx`; `stores/plugins` load in `ShopStoreGuard.tsx`.

- [ ] **Step 1: Guard.** In `ShopStoreGuard.tsx` also `await loadEnabledPlugins()` so `isShopifyActive()` is ready before children render.
- [ ] **Step 2: ShopIndex.** When `isShopifyActive()`, the products resource calls `shopifySource.listProducts({ limit, cursor })` (cursor-paginated "Load more") and maps `.products`; else the existing `cms.shop.products.listPublic`. `ProductCard` renders unchanged (adapter yields `slug`/`fromPriceCents`/`primaryImageUrl`). Product links → `/shop/:slug` (slug = Shopify handle) — unchanged.
- [ ] **Step 3: ShopProduct.** When active, fetch via `shopifySource.getProduct(slug)`; variant selection + add-to-cart work unchanged because the adapter fills `options`/`variants` with `option1/2/3` and `variant.id` = Shopify variant GID (used as `variantId` in the cart line). Hide the reviews section when active.
- [ ] **Step 4: ShopCollection / ShopCategory.** When active, ShopCollection uses `shopifySource.getCollection(slug)` → `{ collection, products }`. Shopify has no "categories" → when active, ShopCategory renders the same collection view (treat category slug as a collection handle) or a "not available" note; keep it simple: reuse `getCollection`.
- [ ] **Step 5: ShopCart.** Unchanged for line display (localStorage store). The **Checkout** button/flow branches (Step 6).
- [ ] **Step 6: ShopCheckout.** When `isShopifyActive()`, **bypass Stripe entirely**: render a summary of `cartItems()` + a "Continue to secure checkout" button that calls `shopifySource.cartCreate(cartItems().map(i => ({ merchandiseId: i.variantId, quantity: i.qty })))`, then on `ok` does `window.location.href = cart.checkoutUrl` (full-page redirect) and `clearCart()`. Show the returned `subtotalCents` (informational). On `!ok`, show the error. Else the existing Stripe flow.
- [ ] **Step 7: Gate.** cms typecheck + `pnpm --filter @sitesurge/admin build` clean.

---

## Task 4: Admin Shop override (plugin-gated dashboard)

**Files:** Modify `pages/admin/shop/ShopDashboard.tsx`, `ShopProducts.tsx`, `ShopOrders.tsx`; add a shared `ShopifyManagedBanner.tsx`; light notice on `ShopProductEditor.tsx`, `ShopCategories.tsx`, `ShopCollections.tsx`, `ShopReviews.tsx`, `ShopSettings.tsx`.

- [ ] **Step 1: `ShopifyManagedBanner.tsx`** — a reusable banner: "🛍 Shopify is managing your store. Products, orders, and checkout are served from your Shopify store." + an "Open Shopify admin ↗" link built from `pluginConfig('shopify').shopDomain` (`https://{shopDomain}/admin`). Only renders when `isShopifyActive()`.
- [ ] **Step 2: ShopDashboard.** When active: render the banner, replace the internal counts/orders with `shopifySource.shopStats()` (product count, order count, recent sales) + `shopifySource.listOrders(10)` (recent orders table, read-only), each row/section linking to Shopify admin. Hide internal "new product"/editing CTAs.
- [ ] **Step 3: ShopProducts.** When active: banner + swap the `usePaginatedList` fetch for a Shopify adapter (`shopifySource.listProducts` mapped to the existing row shape); make the table read-only (no bulk/edit/delete; row "View in Shopify" link). Else unchanged.
- [ ] **Step 4: ShopOrders.** When active: banner + `shopifySource.listOrders()` read-only table (order name, date, customer, financial/fulfillment status, total), rows link to Shopify admin. Else unchanged.
- [ ] **Step 5: Editing pages.** ShopProductEditor / ShopCategories / ShopCollections / ShopReviews / ShopSettings: at the top, `<Show when={isShopifyActive()}>` render the banner + a short "These are managed in Shopify while the Shopify plugin is enabled" note; keep the internal UI below it (still usable if they disable the plugin) — do not hard-block.
- [ ] **Step 6: Gate.** cms typecheck + admin build clean.

---

## Task 5: Docs + catalog

**Files:** Create `docs/how-it-works/SHOPIFY.md`; modify `CLAUDE.md` (Plugins bullet — third first-party plugin), `docs/how-it-works/PLUGINS.md` (note Shopify as an override-style plugin).

- [ ] **Step 1:** `docs/how-it-works/SHOPIFY.md` — what it overrides, config keys (shopDomain/storefrontToken/adminToken/apiVersion), the Storefront-vs-Admin split, actions list, the cart→`checkoutUrl` redirect flow, admin read-only behavior, and **future work** (reviews sync, category mapping, webhook order backfill, product mirroring for SSR/SEO). Mirror `docs/how-it-works/GIVEBUTTER.md` tone.
- [ ] **Step 2:** One-line adds in `CLAUDE.md` + `docs/how-it-works/PLUGINS.md`.
- [ ] **Step 3:** Confirm the plugin-catalog build copies `plugins/shopify/*` (it copies `plugins/*` minus a vendor `client/` dir — Shopify has none).

---

## Task 6: Verification + deploy

- [ ] Ordered build: types → server → admin → client, all green.
- [ ] `npx tsc --noEmit -p config/api/tsconfig.json` + cms typecheck (minus VideoPlayer baseline) clean.
- [ ] `pnpm --filter @sitesurge/server test` (118 baseline) green; `pnpm --filter @sitesurge/client check:drift` PASS (no new core routes — Shopify rides the existing `/plugins/:name/action/:action`).
- [ ] Plugin static checks: `server.js` requires + all actions return normalized errors with empty config (no throw), like GiveButter.
- [ ] Deploy via `./deploy/hotpatch-surge.sh` (SKIP_MIGRATE=1 — no migration). Commit + push per house rules (stage by path; brief messages; never stage `prod-*.jpeg`/secrets).

## Risks / decisions / limitations

- **No live-store verification without credentials** — like GiveButter, the GraphQL queries/adapters are unverified against a real Shopify store; wiring, types, builds, and error-normalization are. Needs a `shopDomain` + Storefront token (+ optional Admin token) to exercise.
- **Reviews/ratings** not available via Storefront → shown as 0 / hidden when active.
- **Categories** have no Shopify equivalent → mapped onto collections.
- **SSR/SEO:** Shopify product pages render client-side via the action-RPC (no SSR body) — acceptable for v1; server-side product mirroring for SEO is future work.
- **Order history** in the admin is limited to Shopify's default 60-day window unless `read_all_orders` is granted on the Admin token.
- **Cart** reuses the localStorage line store; the authoritative price/tax/shipping is computed by Shopify at checkout (we only show an informational subtotal).
