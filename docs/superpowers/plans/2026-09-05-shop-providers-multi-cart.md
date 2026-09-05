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

It stays where it is. The Providers tab gains a short note pointing at it.

### 3. Apliiq has no product-list endpoint — we are the system of record

Verified against the live API with the issued credentials:

| Endpoint | Result |
| --- | --- |
| `GET /v1/Product/` | 200 — 1,535 **blank** garments (15 MB) |
| `GET /v1/Product/:id` | 200 — colors, services, print locations |
| `POST /v1/Design` | 400 `Missing_ProductCode` (route live, validates) |
| `GET /v1/Design/:id` | 200, account-scoped, `{}` when not ours |
| `GET /v1/Order` | 200 `[]` |
| `POST /v1/Order` | 202 *"we did not find any matching product(s) in this account"* |

There is **no** "list my designs" endpoint (`/v1/Designs`, `/v1/MyProducts`, `/v1/StoreProduct` all
404). So Printify's `sync.ts` model — *pull* the supplier's catalogue — has no Apliiq equivalent.
Instead:

- Designs are **created through us** (`POST /v1/Design`), and we persist the returned
  `Variants[].SKU` as `shop_variants.external_id`. We own the mapping.
- For designs created on Apliiq's website, the operator supplies the **Design ID**, and we import it
  via `GET /v1/Design/:id`.

This is why `ShopProvider.syncProducts` is optional in the interface below.

---

## Open questions (answer before Task 8)

1. **Which two providers does Surge Media actually run?** The brief says "Printiful and Apliiq".
   Printify is the one that is built and live on surgemedia.us; **Printful** is a different company
   and is not built. This plan scaffolds Printful (registry entry + config schema, Task 12) but does
   not implement its sync/order calls.
2. **The design just saved in Apliiq** — its Design ID or a variant SKU is needed. There is no way to
   discover it from the API (see decision 3).

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

Modified: `services/shop/checkout.ts`, `services/shop/fulfillment.ts`,
`services/shop/orderEmails.ts`, `pages/admin/shop/ShopSettings.tsx`,
`pages/shop/ShopCart.tsx`, `pages/shop/ShopCheckout.tsx`.

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

- [ ] **Step 4: Migrate Printify's existing plugin credentials.** In the same migration, copy the
      `printify` plugin config row into `shop_providers` so the live surgemedia.us integration keeps
      working across the deploy. Verify on staging before production.

- [ ] **Step 5: Commit.**

---

## Task 3: Fulfilment groups

**Files:** Create `packages/api/src/services/shop/groups.ts`, Test `groups.test.ts`

The grouping key is **not** just `external_provider` — `CartItem.kind` already distinguishes virtual
event tickets, and self-fulfilled stock is its own group.

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

`shop_orders.printify_order_id` is **kept and left in place** (read-only) so a rollback does not
lose the link. A later migration can drop it once this has run in production for a while.

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

## Task 7: Apliiq design import + creation

**Files:** Create `providers/apliiq/designs.ts`

- [ ] **Step 1: `importDesign(designId)`** — `GET /v1/Design/:id`, map to one `shop_products` row
      (`external_provider='apliiq'`, `external_id=<designId>`) plus one `shop_variants` row per
      returned variant (`external_id=<SKU>`), using the design's mockup `ImagePath` as the image.
      Reuse the existing `shopProducts.repo` UPSERT-on-`external_id` writer so variant UUIDs stay
      stable across re-imports.
- [ ] **Step 2: `createDesign(input)`** — `POST /v1/Design`, then hand off to `importDesign`.
- [ ] **Step 3:** Admin UI: "Import from Apliiq" (paste Design ID) on the Apliiq provider page.
      Design *creation* UI is deferred — import unblocks selling immediately.
- [ ] **Step 4: Tests** with a recorded fixture response. **Commit.**

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

- [ ] **Step 1:** `providers/printful.ts` — config schema + `isConfigured` + `testConnection` only;
      `submitOrder` throws `NotImplementedError`. Registry entry present so it appears in the tab as
      "Coming soon" (disabled toggle).
- [ ] **Step 2:** Mark the `printify` plugin deprecated: `server.js` `onEnable` becomes a no-op that
      logs "managed under Shop → Providers". Do **not** delete the plugin directory in this pass —
      leave one release of overlap so a rollback is possible.
- [ ] **Step 3:** Update `CLAUDE.md` (Shop section) and `docs/API.md` (`npm run docs:api`).
- [ ] **Step 4: Commit.**

---

## Verification checklist

- [ ] `npm run build` clean; `npm test` green.
- [ ] Live Printify integration on surgemedia.us still syncs and submits after the credential
      migration (Task 2 Step 4) — verify on the demo first.
- [ ] A two-provider cart shows two shipping lines, one total, one Stripe charge, and produces two
      `shop_order_fulfillments` rows.
- [ ] Apliiq webhook signature verification accepts a real payload and rejects a tampered one.
- [ ] Combined vs grouped renders correctly on `/cart`, `/checkout`, buyer email, admin email, PDF.
