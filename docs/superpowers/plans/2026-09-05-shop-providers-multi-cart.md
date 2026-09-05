# Shop Providers + Multi-Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or
> `superpowers:executing-plans` to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the per-plugin print-provider model with a first-class **Shop Providers** system
managed from `/admin/shop/settings`, and generalise the checkout from "native + Printify" to
"N fulfilment groups", so a single cart can contain items fulfilled by different suppliers.

**Architecture:** A provider *registry* (modelled on `FEATURE_REGISTRY`) where each provider
implements one `ShopProvider` interface. Checkout resolves cart lines into **fulfilment groups**,
quotes shipping per group, sums them into one total, takes **one** payment, then fans out one
supplier order per group. Display grouping (cart / emails / notifications) is presentation-only and
operator-configurable.

**Tech stack:** Express + PostgreSQL + SolidJS, existing Stripe payment provider, existing
`services/printify/` engine (kept, re-homed behind the interface).

---

## Decisions taken before writing this plan

These three came out of the audit and change the shape of the build. They are recorded here so the
implementer does not re-litigate them.

### 1. There is only one viable payment model — one charge

The request allows for "charge the user's card once per vendor". **We should not build that.**

Printify and Apliiq are **suppliers, not merchants of record**. Neither has any mechanism to charge
your customer's card. They bill *us*: Printify against the card on file, Apliiq per the
`$1/item + shipping` fulfilment fee. Our existing `submitOrderToPrintify` already works this way —
it POSTs an order and Printify invoices the account.

Charging the customer separately per provider would require each provider to be a Stripe **Connect**
connected account, which they are not and will not be. So:

- **One `PaymentIntent`, one charge, one descriptor** ("Surge Media Merchandise"). This is already
  what happens today and is the desired end state.
- We then pay suppliers from our own account, out of band, exactly as now.
- **No `paymentMode` setting is built.** A toggle whose second option cannot work is worse than no
  toggle. If per-provider *settlement reporting* is wanted later, that is an accounting report over
  `shop_order_fulfillments`, not a second charge.

### 2. Shopify stays a plugin

Shopify is not a fulfilment provider. It is an **override** that replaces the entire storefront and
checkout (`cms/src/services/shopifySource.ts` → `isShopifyActive()` bypasses our cart and Stripe
entirely, redirecting to Shopify's hosted checkout). Filing it under "Shop Providers" alongside
suppliers would put two incompatible meanings behind one word and imply it can be combined with
others in a cart — it cannot; it *replaces* the cart.

The audit quantifies the cost of moving it: Shopify has **no core engine at all** — the GraphQL
client, all the `Shop*` adapters and 12 actions are 331 lines inside `plugins/shopify/server.js`,
reached only through the generic `POST /plugins/:name/action/:action` RPC, and **9 admin/storefront
pages** branch on `isShopifyActive()` (`ShopIndex`, `ShopProduct`, `ShopCategory`, `ShopCollection`,
`ShopCheckout`, `ShopDashboard`, `ShopProducts`, `ShopOrders`, `ShopSettings`). Extraction means
relocating all of it and rewiring every call site, to gain nothing — it still cannot share a cart.

It stays where it is. The Providers tab gains a short note pointing at it.

### 3. Apliiq is PUSH, not pull — the add-to-store webhook IS the import

**This corrects an earlier reading of the API.** There is genuinely no list-designs endpoint, but
the conclusion drawn from that ("we import by Design ID") was wrong. Apliiq's custom-store
integration is inverted: *they* call *us*.

Verified against the live API:

| Endpoint | Result |
| --- | --- |
| `GET /v1/Product/` | 200 — 1,535 **blank** garments (15 MB) |
| `POST /v1/Design` | 400 `Missing_ProductCode` (route live, validates) |
| `GET /v1/Design/:id` | 200, account-scoped, `{}` when not ours |
| `GET /v1/Order` | 200 `[]` |
| `POST /v1/Order` | 202 *"we did not find any matching product(s) in this account"* |

A design saved on their website is **not** reachable by its public product-page id
(`/product/6068710/…` → `GET /v1/Design/6068710` returns `{}`). It becomes ours only when the
operator clicks **Add to Store** and picks our custom store — at which point Apliiq POSTs the whole
product to our registered *Add product to store URL*:

```json
{
  "name": "Midweight Fleece Joggers", "type": "pants", "currency": "USD",
  "imageUrls": ["https://blob.apliiq.com/…jpg"],
  "sizes": ["s","m","l","xl"], "colors": ["Grey Heather","white"],
  "replaceProduct": false,
  "variants": [{
    "sku": "APQ-4633445S6A1", "price": 63.78, "color": "Grey Heather", "size": "s",
    "imageUrl": "https://blob.apliiq.com/…jpg",
    "weight": 11.9, "weightUnit": "oz",
    "width": 6, "height": 2, "length": 8, "dimensionUnit": "in", "default": false
  }]
}
```

and expects back:

```json
{ "storeProductId": "<our shop_products.id>", "stepsCompleted": ["Completed"],
  "hasError": false, "errorMessages": [] }
```

So the flow is: **design on Apliiq → Add to Store → we receive the product + its `APQ-…` SKUs →
we sell it → `POST /v1/Order` with those SKUs → Apliiq ships → Fulfillment webhook returns
tracking.** `syncProducts` stays undefined for Apliiq — not because we are the system of record,
but because there is nothing to pull; the catalogue arrives by push.

Two consequences the implementer must plan around:

- **Nothing can be tested until a public webhook URL is deployed and registered** in the Apliiq
  store settings. The design already saved will not appear until then.
- The payload carries per-variant `weight`/`weightUnit` and dimensions. That is the only shipping
  input Apliiq gives us (there is no rate endpoint), so store it on the variant — it is what any
  future weight-based rate table will need.

### 3a. SECURITY: the add-to-store webhook has no documented authentication

Unlike the Fulfillment URL — which is signed with `x-apliiq-hmac`
(`base64(HMACSHA256(base64(payload), shared_secret))`) — the add-to-store docs specify **no**
signature, token or allowlist. It is an unauthenticated endpoint that *creates products in our
shop*.

Mitigations are mandatory, not optional:

- The URL carries a high-entropy token in its path (`/api/v1/shop/webhooks/apliiq/add-to-store/<48-char token>`),
  generated per provider and revocable from the admin.
- Treat the body as fully untrusted: validate shape, clamp string lengths, reject unknown SKU
  prefixes, cap `variants` length, and never let it set price on an existing product without
  `replaceProduct`.
- Products created this way land as `status='draft'`, never `active`. A human publishes them. An
  unauthenticated endpoint must not be able to put items on the storefront.
- Rate-limit per token.

### 4. Moving credentials does not make them more secure

Plugin credentials live today in `plugins.config` JSONB — **plaintext, no encryption at rest**
(`migrations/050_create_plugins.sql`). The new `shop_providers.config` is the same storage with a
narrower audience. That is a *tidiness* win, not a security one. Encryption at rest is a separate
piece of work and is deliberately out of scope here; do not describe the new table as a "secrets
store" in the UI or docs.

---

## Answered

- **Providers:** Printify (keep, live), Apliiq (new), Printful (designed in now as a third provider,
  scaffolded in Task 12 — API calls deferred until credentials exist).
- **The saved Apliiq design** cannot be fetched; it arrives via Add to Store once Task 13 is
  deployed and the URL is registered. See decision 3.

---

## File structure

```
packages/api/src/services/shop/providers/
  types.ts        ShopProvider interface, ProviderKey, ShippingQuote, SyncResult
  registry.ts     PROVIDER_REGISTRY + lookup/list helpers
  settings.ts     read/write shop_providers rows; secret masking
  printify.ts     adapter over the existing services/printify/ engine
  apliiq/
    client.ts     HMAC signing + typed calls
    provider.ts   ShopProvider implementation
    designs.ts    createDesign / importDesign -> shop_products + variants
  printful.ts     scaffold only (Task 12)
packages/api/src/services/shop/groups.ts    fulfilment grouping + per-group shipping
packages/api/src/routes/shopProviders.ts    admin CRUD + test-connection + sync
packages/api/src/routes/shopWebhooks.ts     public, HMAC-verified provider webhooks
packages/cms/src/pages/admin/shop/settings/ProvidersPanel.tsx
packages/cms/src/pages/admin/shop/settings/ProviderDetail.tsx
packages/cms/src/components/shop/CartGroups.tsx   shared grouped renderer
```

**Modified, with the exact seams the audit located:**

| File | Line | What changes |
| --- | --- | --- |
| `services/shop/checkout.ts` | 201 | `computeShipping` skips `externalProvider === 'printify'` → skip any self-quoting provider |
| `services/shop/checkout.ts` | 294 | `buildShipping` hardcodes `hasPrintify` → per-group `buildGroupShipping` |
| `services/shop/checkout.ts` | 359 | direct `getPrintifyShippingOptions` call → `provider.quoteShipping` |
| `services/shop/fulfillment.ts` | 116-121 | unconditional `submitOrderToPrintify(orderId)` → `submitOrderToProviders` |
| `repositories/shop/shopOrders.repo.ts` | 87-117 | `createOrderItems` drops provider fields → persist them |
| `services/printify/config.ts` | 28-29 | `SELECT … FROM plugins WHERE name='printify'` → read `shop_providers` |
| `routes/shop.ts` | ~600 | `/shop/printify/status|sync|sync/:id` → `/shop/providers/:key/…` |
| `pages/admin/shop/ShopSettings.tsx` | 16-22 | 4 tabs → add `Providers` |
| `pages/shop/ShopCart.tsx`, `ShopCheckout.tsx` | — | grouped rendering (Task 10) |
| `services/shop/orderEmails.ts` | 50 | `renderItemsTable` gains optional groups |

---

## Task 1: Provider interface + registry

**Files:** Create `packages/api/src/services/shop/providers/types.ts`, `registry.ts`,
Test `packages/api/src/services/shop/providers/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, } from 'vitest';
import { PROVIDER_REGISTRY, listProviders, getProvider, } from './registry';

describe('provider registry', () => {
    it('exposes every provider under its own key', () => {
        for (const [key, p,] of Object.entries(PROVIDER_REGISTRY,)) {
            expect(p.key, `${key} must match its registry key`,).toBe(key,);
        }
    },);
    it('every provider can submit an order', () => {
        // syncProducts/quoteShipping are optional (Apliiq has no catalogue
        // endpoint), but a provider that cannot be ordered from is not a
        // fulfilment provider at all.
        for (const p of listProviders()) expect(typeof p.submitOrder,).toBe('function',);
    },);
    it('returns undefined for an unknown key rather than throwing', () => {
        expect(getProvider('nope',),).toBeUndefined();
    },);
},);
```

- [ ] **Step 2: Run it — expect failure**

Run: `cd packages/api && npx vitest run --config ../../config/api/vitest.config.ts src/services/shop/providers/registry.test.ts`
Expected: FAIL, cannot resolve `./registry`.

- [ ] **Step 3: Write `types.ts`**

```ts
export type ProviderKey = 'printify' | 'apliiq' | 'printful';

/** A cart line already resolved against the DB, narrowed to what a provider needs. */
export interface ProviderLine {
    variantId: string;
    externalProductId: string | null;
    externalVariantId: string | null;   // Apliiq: the APQ-… SKU
    qty: number;
    grams: number;
}

export interface ProviderShippingOption { id: string; label: string; cents: number; }

export interface ProviderShippingQuote {
    ok: boolean;
    options: ProviderShippingOption[];
    /** 'no-address' | 'no-config' | 'api-error' — drives the storefront caption. */
    reason?: string;
}

export interface ProviderField {
    key: string; label: string; type: 'string' | 'secret' | 'boolean' | 'number';
    required?: boolean; help?: string;
}

export interface ShopProvider {
    key: ProviderKey;
    label: string;
    /** Rendered by the admin as the provider's credential form. */
    configSchema: ProviderField[];
    isConfigured(config: Record<string, unknown>,): boolean;
    testConnection(config: Record<string, unknown>,): Promise<{ ok: boolean; message: string; }>;
    /** Optional: only providers that expose a catalogue can be pulled. */
    syncProducts?(config: Record<string, unknown>,): Promise<{ upserted: number; archived: number; }>;
    /** Optional: providers without a rate API fall back to the shop's flat rate. */
    quoteShipping?(
        config: Record<string, unknown>,
        lines: ProviderLine[],
        address: unknown,
    ): Promise<ProviderShippingQuote>;
    submitOrder(
        config: Record<string, unknown>,
        order: { orderNumber: string; email: string; name: string | null; shippingAddress: unknown; },
        lines: ProviderLine[],
    ): Promise<{ externalOrderId: string; }>;
    /** Push providers verify a signature; pull providers poll instead. */
    verifyWebhook?(config: Record<string, unknown>, rawBody: string, headers: Record<string, string>,): boolean;
    parseWebhook?(rawBody: string,): { externalOrderId: string; status: string; carrier?: string; tracking?: string[]; };
    pollStatus?(config: Record<string, unknown>, externalOrderId: string,): Promise<{ status: string; carrier?: string; tracking?: string[]; }>;
}
```

- [ ] **Step 4: Write `registry.ts`**

```ts
import type { ProviderKey, ShopProvider, } from './types';
import { printifyProvider, } from './printify';
import { apliiqProvider, } from './apliiq/provider';

export const PROVIDER_REGISTRY: Record<ProviderKey, ShopProvider> = {
    printify: printifyProvider,
    apliiq: apliiqProvider,
    printful: printfulProvider,   // added in Task 12
};

export function listProviders(): ShopProvider[] { return Object.values(PROVIDER_REGISTRY,); }
export function getProvider(key: string,): ShopProvider | undefined {
    return (PROVIDER_REGISTRY as Record<string, ShopProvider>)[key];
}
```

- [ ] **Step 5: Run the test — expect PASS**, then commit.

```bash
git add packages/api/src/services/shop/providers
git commit -m "feat(shop): provider interface + registry"
```

---

## Task 2: Provider settings storage

**Files:** Create `packages/api/src/db/migrations/097_shop_providers.sql`,
`packages/api/src/services/shop/providers/settings.ts`

- [ ] **Step 1: Migration**

```sql
-- @feature shop
-- One row per configured fulfilment provider. Config holds credentials, so this
-- table is admin-read-only and secrets are masked before they reach any client.
CREATE TABLE IF NOT EXISTS shop_providers (
    key         VARCHAR(32) PRIMARY KEY,
    enabled     BOOLEAN NOT NULL DEFAULT false,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    auto_sync   BOOLEAN NOT NULL DEFAULT false,
    sync_interval_minutes INTEGER NOT NULL DEFAULT 15,
    last_sync_at TIMESTAMPTZ,
    last_error  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: `settings.ts`** — `getProviderConfig(key)`, `listProviderSettings()` (secrets masked
      as `'••••'` when `forClient`), `saveProviderSettings(key, patch, ctx)` (a masked secret sent
      back unchanged must NOT overwrite the stored one), `setProviderEnabled(key, on, ctx)`.

- [ ] **Step 3: Test** the mask/round-trip explicitly — re-saving a form that still shows `••••`
      must leave the real token intact. This is the single easiest way to destroy a live
      integration, so it gets its own test.

- [ ] **Step 4: Migrate Printify's existing plugin credentials.** They live in `plugins.config`
      JSONB (`SELECT enabled, installed, config FROM plugins WHERE name = 'printify'`,
      `services/printify/config.ts:28-29`). Copy that row across in the same migration:

```sql
INSERT INTO shop_providers (key, enabled, config, auto_sync, sync_interval_minutes)
SELECT 'printify', enabled, config,
       COALESCE((config->>'syncIntervalMinutes')::int, 0) > 0,
       COALESCE((config->>'syncIntervalMinutes')::int, 60)
FROM plugins WHERE name = 'printify' AND installed = true
ON CONFLICT (key) DO NOTHING;
```

      **This is the highest-risk step in the plan** — surgemedia.us is live on Printify. Verify on
      the demo first, and confirm a sync + an order submit both still work before production.

- [ ] **Step 5: Commit.**

---

## Task 3: Fulfilment groups

**Files:** Create `packages/api/src/services/shop/groups.ts`, Test `groups.test.ts`

The grouping key is **not** just `external_provider`. `CartItem.kind` (`shopCart.ts:20-45`) already
distinguishes virtual event tickets, whose `variantId` is a synthetic `event:<id>:<date>:<tier>` key
and which have no `shop_variants` row at all; self-fulfilled stock is a third group. Group from the
server-side `ResolvedLine` (`checkout.ts:100-105`), never from the cart line — the client cart
carries no provider field by design.

- [ ] **Step 1: Write the failing test** covering: native-only cart → one group; mixed
      native+printify+apliiq → three groups in stable order; event tickets → their own group;
      empty cart → no groups.

- [ ] **Step 2: Implement**

```ts
export type GroupKey = 'native' | 'event_tickets' | ProviderKey;

export interface FulfillmentGroup {
    key: GroupKey;
    label: string;                       // "Surge Media", "Printify", …
    lines: ResolvedLine[];
    subtotalCents: number;
    shippingCents: number;
    shippingOptions: ShopShippingOption[];
    shippingMethod?: string;
    shippingQuoteFailed?: boolean;
}

export function groupLines(lines: ResolvedLine[],): Map<GroupKey, ResolvedLine[]>;
```

- [ ] **Step 3: Run tests, commit.**

---

## Task 4: Generalise checkout shipping

**Files:** Modify `packages/api/src/services/shop/checkout.ts:294` (`buildShipping`)

Today `buildShipping` hardcodes one supplier:

```ts
const hasPrintify = lines.some((l,) => l.externalProvider === 'printify' && l.requiresShipping,);
```

- [ ] **Step 1: Write failing tests** in `checkout.test.ts`: a cart with printify + apliiq lines
      returns two groups each with their own options, and `totals.shippingCents` equals the **sum**
      of the per-group chosen options.

- [ ] **Step 2: Replace `buildShipping`** with `buildGroupShipping(groups, settings, address, requested)`:
  - for each group, call `provider.quoteShipping?.()`; providers without one (Apliiq today) fall
    back to `settings.shipping.flatCents`, flagging `shippingQuoteFailed` exactly as the current
    Printify fallback does — never ship free on a failed quote.
  - `shippingMethod` becomes `Record<GroupKey, string>` in the request; keep accepting the old flat
    string for one release and treat it as "apply to every group".

- [ ] **Step 3: Extend `CheckoutTotals`** with `groups: FulfillmentGroup[]`. Keep every existing
      field so the current storefront keeps working before Task 8 lands.

- [ ] **Step 4: Tax** stays computed once on the combined subtotal + total shipping. Do not
      per-group the tax — Stripe Tax is calculated for the whole order.

- [ ] **Step 5: Run tests, commit.**

---

## Task 5: Per-provider order fulfilment records

**Files:** Create migration `098_shop_order_fulfillments.sql`, modify `services/shop/fulfillment.ts`

- [ ] **Step 1: Migration**

```sql
-- @feature shop
CREATE TABLE IF NOT EXISTS shop_order_fulfillments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id          UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
    provider          VARCHAR(32) NOT NULL,
    external_order_id VARCHAR(128),
    status            VARCHAR(32) NOT NULL DEFAULT 'pending',
    carrier           VARCHAR(64),
    tracking_numbers  TEXT[],
    submitted_at      TIMESTAMPTZ,
    shipped_at        TIMESTAMPTZ,
    last_error        TEXT,
    raw               JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, provider)
);
-- Backfill the existing single-provider column so live orders keep their link.
INSERT INTO shop_order_fulfillments (order_id, provider, external_order_id, status)
SELECT id, 'printify', printify_order_id, 'submitted'
FROM shop_orders WHERE printify_order_id IS NOT NULL
ON CONFLICT (order_id, provider) DO NOTHING;
```

Migration 076 added **four** columns, not one: `printify_order_id`, `printify_status`,
`tracking_url`, `carrier` (and 088 added `shipping_method`). The two `printify_*` columns are
superseded by this table and become read-only; `tracking_url` / `carrier` / `tracking_number` stay
useful at order level as the *aggregate* (populated from the first shipped fulfilment) so existing
order views and emails keep working unchanged. Nothing is dropped in this pass — a later migration
can remove the `printify_*` pair once this has run in production for a while.

- [ ] **Step 2:** `shop_order_items` gains `fulfillment_group VARCHAR(32)`, written at order
      creation. Stored rather than derived, because a product's `external_provider` can change after
      the order and the order must remain a faithful record of what was actually ordered.

- [ ] **Step 3:** Replace `submitOrderToPrintify(orderId)` with
      `submitOrderToProviders(orderId)` which loops the order's groups, calls
      `provider.submitOrder`, and writes one `shop_order_fulfillments` row each. **One provider
      failing must not roll back the others** — record `last_error` on that row and let the retry
      sweep pick it up.

- [ ] **Step 4:** Generalise `retryPendingPrintifyFulfillment` and `pollOrderStatuses` to iterate
      providers, skipping those with `verifyWebhook` (push) rather than polling them.

- [ ] **Step 5: Tests** — a two-provider order creates two rows; a failing provider leaves the other
      submitted; re-running is idempotent (the UNIQUE constraint holds).

- [ ] **Step 6: Commit.**

---

## Task 6: Apliiq client + provider

**Files:** Create `providers/apliiq/client.ts`, `provider.ts`, tests

- [ ] **Step 1: Client with the verified auth scheme.** Both details below were determined
      empirically; the published docs are ambiguous and the other three combinations 401.

```ts
// APPID is the base64 string EXACTLY as issued (not decoded); the shared secret
// is used as a raw UTF-8 string (NOT base64-decoded). Verified against the live
// API — the other three permutations all return 401.
const sig = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${appId}${rts}${nonce}${base64Body}`, 'utf8').digest('base64');
headers.Authorization = `x-apliiq-auth ${rts}:${sig}:${appId}:${nonce}`;
```

- [ ] **Step 2: Test the signer** against a frozen timestamp/nonce with a known-good expected
      signature, so a refactor cannot silently break auth.

- [ ] **Step 3: `submitOrder`** → `POST /v1/Order`, Shopify-shaped body, line items keyed by
      `sku` (the `APQ-…` variant SKU), `shipping_lines: [{ code: 'standard' }]`.
      **Note:** a SKU not present in the Apliiq account returns **202** with
      `"we did not find any matching product(s) in this account."` — a 202 is *not* success here.
      Treat any response without an `id` as a failure.

- [ ] **Step 4: `verifyWebhook`** — `x-apliiq-hmac` = `base64(HMACSHA256(base64(payload), secret))`.
      Compare with `crypto.timingSafeEqual`.

- [ ] **Step 5:** No `syncProducts` and no `quoteShipping` (neither endpoint exists). Shipping falls
      back to the flat rate per Task 4. Record this in the provider's admin help text so the
      operator knows why Apliiq shipping is an estimate.

- [ ] **Step 6: Commit.**

---

## Task 7: Apliiq product ingestion (from the add-to-store webhook)

**Files:** `providers/apliiq/ingest.ts`

Rewritten from an earlier draft that assumed we could import by Design ID. We cannot — see
decision 3. Ingestion is driven by the webhook in Task 13, which is a hard dependency: **do Task 13
first.**

- [ ] **Step 1: `ingestStoreProduct(payload)`** — map the add-to-store body onto one
      `shop_products` row (`external_provider='apliiq'`, `external_id` = the SKU stem shared by the
      variants, e.g. `4633445` from `APQ-4633445S6A1`) plus one `shop_variants` row per entry
      (`external_id` = full SKU, price from `price` in **dollars → cents**, weight normalised to
      grams from `weight`/`weightUnit`). Images come from `imageUrls`/`variants[].imageUrl` as
      `external_url`, matching how Printify media is stored.
- [ ] **Step 2:** Reuse `shopProducts.repo`'s UPSERT-on-`external_id` writer so re-adding the same
      product keeps variant UUIDs stable — carts and past orders reference them.
- [ ] **Step 3:** `replaceProduct: true` replaces structure; `false` on an existing external id is a
      no-op returning the existing `storeProductId`, so a double-click in Apliiq's UI is harmless.
- [ ] **Step 4:** Status is always `'draft'` on first ingest (see decision 3a).
- [ ] **Step 5: Tests** against the documented payload as a fixture: dollar→cent conversion, oz→g
      conversion, idempotent re-ingest, and that an unknown `weightUnit` fails loudly rather than
      silently recording 0 g.
- [ ] **Step 6:** `POST /v1/Design` (`providers/apliiq/designs.ts`) stays available for creating
      designs programmatically later, but is **not** required for selling — it is deferred.
- [ ] **Step 7: Commit.**

---

## Task 8: Providers tab (admin)

**Files:** Modify `pages/admin/shop/ShopSettings.tsx:17` (TABS), create `ProvidersPanel.tsx`,
`ProviderDetail.tsx`, routes `routes/shopProviders.ts`

- [ ] **Step 1:** Add `{ key: 'providers', label: 'Providers' }` to `TABS`.
- [ ] **Step 2:** `ProvidersPanel` lists each registry provider: label, enabled toggle, configured
      badge, last sync, **Configure →**. Include a note that Shopify is a plugin and why.
- [ ] **Step 3:** `ProviderDetail` renders `configSchema` via `FormField`, plus Test connection,
      Sync now (only when `syncProducts` exists), auto-sync toggle + interval.
- [ ] **Step 4:** Routes, `admin` tier, new permissions `shop.providers:read` / `:write` per the
      CLAUDE.md permissions rule. Secrets never returned unmasked.
- [ ] **Step 5: Commit.**

---

## Task 9: Display settings

**Files:** modify `services/shop/settings.ts`, `ShopSettings.tsx` General tab

Three independent settings — no `paymentMode` (see decision 1):

```ts
cartDisplay: 'combined' | 'grouped';               // default 'combined'
orderEmailDisplay: 'combined' | 'grouped';         // default 'combined'
adminNotificationDisplay: 'grouped' | 'combined';  // default 'grouped'
```

- [ ] **Step 1:** Add to the settings type + zod schema + General tab, each with subtext explaining
      the visual effect ("Buyers see one list" vs "Buyers see a section per supplier, each with its
      own shipping").
- [ ] **Step 2:** `orderEmailDisplay` is only offered when `cartDisplay === 'grouped'` — showing a
      buyer a grouped email after a combined cart is incoherent. Enforce in the UI *and* server-side.
- [ ] **Step 3: Commit.**

---

## Task 10: Storefront cart + checkout grouping

**Files:** create `components/shop/CartGroups.tsx`, modify `pages/shop/ShopCart.tsx`,
`pages/shop/ShopCheckout.tsx`

- [ ] **Step 1:** The client does **not** compute grouping. `CartItem` deliberately has no provider
      field — it would go stale when a product is re-assigned. `previewCheckout` returns `groups`
      and the pages render what the server says.
- [ ] **Step 2:** `/shop/cart` calls preview (debounced) to obtain groups when `cartDisplay` is
      `grouped`; renders one section per group with its own shipping line, and one combined total.
- [ ] **Step 3:** `/shop/checkout` renders per-group shipping selectors when grouped, one when
      combined. The **Continue → Confirm** two-step flow and the single PaymentIntent are unchanged.
- [ ] **Step 4:** Tests for both display modes. **Commit.**

---

## Task 11: Emails + notifications

**Files:** modify `services/shop/orderEmails.ts`

- [ ] **Step 1:** `renderItemsTable(order)` gains an optional `groups` argument; when grouped it
      emits a sub-header row per supplier. Default path unchanged (combined).
- [ ] **Step 2:** Buyer confirmation + receipt honour `orderEmailDisplay`; the seller notification
      honours `adminNotificationDisplay` (default **grouped**, since the operator needs the
      fulfilment breakdown).
- [ ] **Step 3:** The PDF receipt (`services/shop/receipt.ts`) follows `orderEmailDisplay` too.
- [ ] **Step 4: Tests** asserting a grouped buyer email never leaks supplier names when combined is
      selected. **Commit.**

---

## Task 12: Printful scaffold + Printify plugin retirement

- [ ] **Step 1:** `providers/printful.ts` — config schema (`apiKey`, `storeId`) + `isConfigured` +
      `testConnection`; `syncProducts`/`submitOrder` throw `ProviderNotImplementedError` until
      credentials exist. Registry entry present so it appears in the tab from day one with an
      honest "not yet implemented" state rather than being hidden.
- [ ] **Step 2:** Mark the `printify` plugin deprecated: `server.js` `onEnable` becomes a no-op that
      logs "managed under Shop → Providers". Do **not** delete the plugin directory in this pass —
      leave one release of overlap so a rollback is possible.
- [ ] **Step 3:** Update `CLAUDE.md` (Shop section) and `docs/API.md` (`npm run docs:api`).
- [ ] **Step 4: Commit.**

---

## Task 13: Generic inbound provider webhooks

**Files:** migration `099_shop_provider_webhooks.sql`, `services/shop/providers/webhooks.ts`,
`routes/shopWebhooks.ts`, `pages/admin/shop/settings/ProviderWebhooks.tsx`

Direction is **provider → us** only, for now. Outbound (us → provider) is explicitly deferred; the
table carries a `direction` column so adding it later is not a migration of existing rows.

**We own the URLs.** They are generated here, shown in our admin, and the operator pastes them into
the provider's dashboard — not the other way round. Nothing needs to be obtained from Apliiq first.
The `path` segment is operator-editable so a URL can be matched to whatever a provider expects or
kept stable across a token regeneration.

**Not every event is a POST.** Apliiq's own examples show `productSearch` as a **GET** with a query
string:

```
https://your-domain.com/productAddOrUpdate-webhook-url        POST
https://your-domain.com/productSearch-webhook-url?search=     GET
https://your-domain.com/fulfillment-webhook-url               POST
https://your-domain.com/shipmentComplete                      POST
```

so `ProviderWebhookEvent` declares its `method`, and the route registers both verbs.

### Our route scheme

```
{POST|GET} /api/v1/shop/webhooks/:provider/:path/:token
```

e.g. `https://surgemedia.us/api/v1/shop/webhooks/apliiq/product-add-or-update/f3a9…`
     `https://surgemedia.us/api/v1/shop/webhooks/apliiq/product-search/f3a9…?search=tee`
     `https://surgemedia.us/api/v1/shop/webhooks/apliiq/fulfillment/f3a9…`
     `https://surgemedia.us/api/v1/shop/webhooks/apliiq/shipment-complete/f3a9…`

Namespaced under the shop feature, provider-scoped, event named in the path (readable in the
provider's dashboard and in our logs), token last so it is easy to redact when pasting a URL into a
support ticket.

- [ ] **Step 1: Migration**

```sql
-- @feature shop
-- One row per (provider, event). `token` is the unguessable path segment — it is
-- the ONLY credential on webhooks the provider does not sign (Apliiq's
-- add-to-store), so it is generated with 32 random bytes and is revocable.
CREATE TABLE IF NOT EXISTS shop_provider_webhooks (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider    VARCHAR(32) NOT NULL,
    event       VARCHAR(64) NOT NULL,
    /** Operator-editable URL segment, so a URL can be matched to whatever a
     *  provider expects and stays stable across a token regeneration. */
    path        VARCHAR(64) NOT NULL,
    method      VARCHAR(4)  NOT NULL DEFAULT 'POST',
    direction   VARCHAR(8)  NOT NULL DEFAULT 'inbound',
    token       VARCHAR(64) NOT NULL UNIQUE,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    /** Operator-defined events live alongside the provider's standard ones. */
    is_custom   BOOLEAN NOT NULL DEFAULT false,
    label       VARCHAR(120),
    last_seen_at TIMESTAMPTZ,
    last_status  INTEGER,
    last_error   TEXT,
    call_count   INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, event),
    UNIQUE (provider, path)
);
```

- [ ] **Step 2: Declare each provider's standard events** on `ShopProvider`:

```ts
export interface ProviderWebhookEvent {
    event: string;              // 'product_add_or_update' | 'fulfillment' | …
    label: string;              // as the provider's own UI names it
    /** Default path segment; the operator may override it per install. */
    path: string;               // 'product-add-or-update'
    method: 'POST' | 'GET';     // productSearch is a GET with ?search=
    /** false when the provider does not sign this one — the admin must be told. */
    signed: boolean;
    handler: (ctx: WebhookCtx, input: { body: unknown; query: Record<string, string>; },) => Promise<unknown>;
}
webhookEvents?: ProviderWebhookEvent[];
```

Apliiq registers all four it offers:

| event | Apliiq's field | method | signed |
| --- | --- | --- | --- |
| `product_add_or_update` | Add product to store URL | POST | no |
| `product_search` | Product Search URL | GET | no |
| `fulfillment` | Fulfillment URL | POST | **yes** (`x-apliiq-hmac`) |
| `warehouse_shipment_complete` | Warehouse Shipment Complete URL | POST | no |

`product_search` answers Apliiq's lookup of *our* catalogue (`?search=`) so their UI can tell
whether a product is already in the store — it returns matches from `shop_products` scoped to
`external_provider='apliiq'`, and must never leak products from other providers or drafts belonging
to nobody.

- [ ] **Step 3: One public route** `{POST,GET} /api/v1/shop/webhooks/:provider/:path/:token`
      (`auth: 'public'`, `raw: true` so the exact bytes are available for HMAC).
      It must: look up the row by `(provider, path, token)` (constant-time token compare), 404 on
      unknown/disabled/wrong-method, call `provider.verifyWebhook` when the event is `signed`, then
      dispatch to the handler.
      Record `last_seen_at`/`last_status`/`call_count` on every call — the admin needs to see
      whether a webhook has ever actually fired.

- [ ] **Step 4: Custom events.** The admin can add N extra rows with `is_custom = true` and a free
      label. These get a URL and are logged, but have no handler — they exist so an operator can
      register a URL now and wire behaviour later. Return `202 {"received":true}` for those, and say
      so plainly in the UI rather than implying they do something.

- [ ] **Step 5: Admin UI** on the provider detail page: an "Enable webhooks" toggle, then a table of
      event / URL (copy button) / signed? / last seen / calls, plus **Add custom endpoint** and
      **Regenerate token** (which invalidates the old URL — warn that it must be re-pasted into the
      provider's dashboard).

- [ ] **Step 6: Tests** — unknown token 404s; a disabled row 404s; a tampered signed payload is
      rejected; an unsigned `add_to_store` body still passes shape validation and creates a
      **draft** product; token comparison is constant-time.

- [ ] **Step 7:** The `apliiq.product_add_or_update` handler does NOT write directly — it builds an
      `IncomingStoreProduct` and calls `runStoreAdd()` (Task 14), so the pre-add hook, dedupe and
      logging are shared with sync-based providers. It then replies with
      `{ storeProductId, stepsCompleted, hasError, errorMessages }`, mapping a `reject` decision to
      `hasError: true` with the reason in `errorMessages` — Apliiq surfaces that to the operator,
      so the message must be human-readable.

- [ ] **Step 8: Commit.**


---

## Task 14: Provider product references + pre-add hook

**Files:** migration `100_shop_product_external_refs.sql`, `providers/types.ts`,
`services/shop/providers/storeAdd.ts`

Every product must be traceable back to the thing it came from at the provider, and each provider
must be able to run its own pre-flight logic before we write anything.

### Schema — generic across providers

`shop_products` already has `external_provider` / `external_id` / `external_url` /
`external_synced_at` (migration 075). Two gaps: there is nowhere to record the **design/template**
a product derives from (distinct from the product itself), and nowhere for provider-specific refs
we cannot anticipate.

```sql
-- @feature shop
-- The design/template this product was generated from, as opposed to the
-- product record itself. For Apliiq that is the design stem shared by its
-- variants (APQ-4633445S6A1 -> 4633445); for Printify the blueprint/product id.
-- Kept as its own column rather than buried in JSONB because it is the field
-- the admin deep-links from and dedupe keys on.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS external_design_id VARCHAR(128);

-- Escape hatch for refs a future provider needs that we cannot name yet
-- (shop id, catalog id, print-area id, …). Never used for anything we query on;
-- promote a key to a real column the moment it needs an index.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS external_ref JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_shop_products_design
    ON shop_products (external_provider, external_design_id)
    WHERE external_design_id IS NOT NULL;
```

Variants keep `external_id` (the per-variant SKU). No change needed there.

### Deep-link back to the design

Provider settings gain an operator-editable template:

```ts
{ key: 'designUrlTemplate', label: 'Design URL template', type: 'string',
  help: 'Used to link an imported product back to its design. {designId} and {externalId} are substituted.',
  default: 'https://www.apliiq.com/product/{designId}' }   // Apliiq
```

`designUrl(product)` resolves it; the admin product editor shows **View design ↗** when the product
has an `external_provider` and the template is set. A missing template simply hides the link — it is
never a hard-coded per-provider URL in the UI.

### The pre-add hook

- [ ] **Step 1: Extend `ShopProvider`**

```ts
/** What the ingest pipeline should do with an incoming product. */
export type StoreAddDecision =
    | { action: 'create'; }
    | { action: 'update'; productId: string; }
    /** Already present and unchanged — reply success without writing. */
    | { action: 'skip'; productId: string; reason: string; }
    /** Refuse: malformed, unsupported, or violates a provider rule. */
    | { action: 'reject'; reason: string; };

export interface IncomingStoreProduct {
    externalId: string | null;
    externalDesignId: string | null;
    name: string;
    variants: Array<{ sku: string; priceCents: number; }>;
    replaceProduct?: boolean;
    raw: unknown;
}

/**
 * Runs BEFORE anything is written, for both pushed (webhook) and pulled (sync)
 * products. Optional: providers that do not implement it get `defaultStoreAddCheck`,
 * which dedupes on (provider, externalId) then (provider, externalDesignId).
 */
beforeStoreAdd?(
    config: ProviderConfig,
    incoming: IncomingStoreProduct,
): Promise<StoreAddDecision>;
```

- [ ] **Step 2: `defaultStoreAddCheck(provider, incoming)`** in `storeAdd.ts` — the shared fallback.
      Looks up `(external_provider, external_id)`, then `(external_provider, external_design_id)`;
      returns `update` when `replaceProduct` is set, `skip` when the row exists and is unchanged,
      `create` otherwise.

- [ ] **Step 3: Apliiq's `beforeStoreAdd`** — derives the design stem from the SKU
      (`APQ-<stem><size><attr>`), rejects a payload whose variants disagree on the stem (that would
      be two designs in one product), and rejects SKUs not matching `^APQ-`.

- [ ] **Step 4: One ingest pipeline** used by both webhook and sync:
      `runStoreAdd(provider, incoming)` → hook (or default) → switch on the decision → write. The
      decision is logged either way, so "why didn't my product import?" is answerable from the
      admin.

- [ ] **Step 5: Tests** — each decision arm; a provider without the hook falls back to the default;
      an Apliiq payload with mismatched stems is rejected rather than half-imported; re-sending an
      identical payload yields `skip` and does **not** bump `updated_at`.

- [ ] **Step 6: Commit.**


---

## Verification checklist

- [ ] `npm run build` clean; `npm test` green.
- [ ] Live Printify integration on surgemedia.us still syncs and submits after the credential
      migration (Task 2 Step 4) — verify on the demo first.
- [ ] A two-provider cart shows two shipping lines, one total, one Stripe charge, and produces two
      `shop_order_fulfillments` rows.
- [ ] Apliiq webhook signature verification accepts a real payload and rejects a tampered one.
- [ ] Combined vs grouped renders correctly on `/cart`, `/checkout`, buyer email, admin email, PDF.
- [ ] Apliiq **Add to Store** from their dashboard lands a draft product in our shop with its
      `APQ-…` SKUs, and Apliiq shows the add as succeeded (it reads our JSON response).
- [ ] An add-to-store POST with a wrong token 404s and creates nothing.
- [ ] A real end-to-end Apliiq sale: buy → `POST /v1/Order` accepted **with an `id` in the response**
      (a 202 carrying "we did not find any matching product(s)" is a FAILURE, not a success) →
      fulfilment webhook returns tracking.
