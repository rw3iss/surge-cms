# Multi-Provider Commerce — Payments & Fulfillment Analysis

> Scope: can SiteSurge run **Printify + Shopify + Squarespace** simultaneously, pull
> catalogs from all three, and let a buyer check out and be fulfilled by each?
> This document answers the payment/fulfillment feasibility question **before** any
> Squarespace plugin is designed. It does not build the plugin.

## TL;DR

- The three providers are **not the same kind of integration**. They fall into two
  archetypes with fundamentally incompatible money flows.
- **You cannot merge two hosted-checkout providers into one cart.** A Shopify
  checkout only accepts Shopify line items; a Squarespace checkout only accepts
  Squarespace line items; neither can carry a Printify or native line. So "one cart,
  one payment, all three fulfil" is **impossible** for Shopify/Squarespace as long as
  you use *their* checkout.
- **Squarespace is the worst fit of the three**: its Commerce API has **no headless
  checkout / cart API** (confirmed against their docs). It can read catalog, adjust
  inventory, and *read/import* orders — but you cannot create a payable cart on an
  external site. So Squarespace can only be a *display + deep-link-out* integration or
  a *full takeover* — never an ingest-and-sell-through-us provider.
- **The clean design is two mutually-exclusive storefront modes**, generalised from
  the seam we already have for Shopify (`isShopifyActive()`):
  - **Unified mode** — native products **+** any number of *ingest* providers
    (Printify, future Printful/Gelato). One catalog, one cart, **one Stripe payment**,
    fulfilment fanned out per line item. Multiple *shipments*, but a single payment.
  - **Hosted-takeover mode** — exactly **one** hosted provider (Shopify **or**
    Squarespace) owns the whole storefront + checkout + payment. Native/ingest shop
    hidden. This is the current Shopify behaviour.
- Multiple **shipments** are fine and normal (Amazon-style "arrives in N shipments").
  Multiple **payments** are what we avoid — and mode exclusivity avoids them.

---

## 1. The three commerce archetypes

Every commerce backend answers three questions: *who owns the catalog, who owns the
checkout/payment, and who owns fulfilment?* That split is what determines whether two
providers can coexist.

| Provider | Catalog | Checkout & payment | Fulfilment | Archetype |
|---|---|---|---|---|
| **Native shop** | us (`shop_products`) | **us** (Stripe) | us (manual) | own |
| **Printify** | provider → ingested to `shop_products` | **us** (Stripe) | provider (POD API) | **ingest** |
| **Shopify** | provider (live) | **provider** (hosted checkout) | provider | **hosted** |
| **Squarespace** | provider (live) | **provider** (hosted, *no API*) | provider | **hosted (read-only API)** |

**Archetype A — "ingest / headless fulfilment" (Printify, native).**
Provider has no storefront of its own; it exposes *catalog read* + *order injection* +
*fulfilment*. We own everything the buyer sees, we collect payment via Stripe, and
after payment we hand the relevant line items to the provider to make + ship. These
**compose freely**: native + Printify + a future Printful all pour into one catalog,
one cart, one Stripe charge, with fulfilment routed per line.

**Archetype B — "hosted storefront" (Shopify, Squarespace).**
Provider owns the storefront, the checkout, the payment rail (Shopify Payments /
Squarespace's processor), tax, and fulfilment. The most it offers a headless site is a
*redirect to its own checkout* (Shopify) or *nothing* (Squarespace — see §3). These are
**mutually exclusive**: you can only redirect a buyer to one hosted checkout, and that
checkout only knows its own products.

The incompatibility is not a limitation of our code — it's the payment rails. Shopify's
checkout literally cannot accept a Printify line item, because Printify isn't a Shopify
product and Shopify Payments would have nothing to charge for it.

---

## 2. Why a mixed cart forces multiple payments (the core roadblock)

Consider a buyer's cart with one native mug, one Printify hoodie, one Shopify book, one
Squarespace print. Payment must clear through **whoever owns the checkout**:

- native mug + Printify hoodie → **our Stripe** (one charge, we later pay Printify).
- Shopify book → **Shopify's checkout** (separate charge, Shopify's rail).
- Squarespace print → **Squarespace's checkout** — but there's **no API to build one**
  (§3), so at best a deep-link to the product page on the Squarespace site.

That is **three separate payments** — one per payment rail — and there is no API on any
side to collapse them. This is a structural property of hosted providers, not something
a cleverer plugin fixes. Shopify would have to let external Printify items ride its
checkout (it doesn't; it can't charge for them), or we'd have to charge everything on
our Stripe and *inject paid orders* into Shopify/Squarespace for fulfilment — which
means abandoning Shopify Payments, handling tax ourselves for their goods (compliance
risk), and, for Squarespace, is simply not offered.

**Conclusion:** the only way to guarantee the buyer pays **once** is to ensure only
**one payment rail** is ever live for the storefront. Hence mode exclusivity (§5).

### Shipments ≠ payments

Multiple *shipments* under a *single payment* are completely fine and already the plan:
- native goods ship from us, Printify goods ship from Printify's facility.
- one Stripe charge, N fulfilments, N tracking numbers.
- our order model already carries per-line fulfilment (migration `076_shop_order_fulfillment`).

So Unified mode can have several fulfillers and still bill the buyer once. Good UX
("arriving in 2 shipments"), no payment split.

---

## 3. Squarespace specifically — the hard blocker

Verified against `developers.squarespace.com/commerce-apis`:

| Squarespace API | Capability | Use to us |
|---|---|---|
| Products | read/write catalog + variants + images | ✅ ingest catalog for display |
| Inventory | read/adjust stock | ✅ stock sync |
| Orders | **read + import** (import 3rd-party sales into SQSP) | ⚠️ read-back only; can't create a payable order for *us* |
| Transactions | read-only financials | dashboard only |
| Discounts / Contacts / Analytics / Webhooks | various | peripheral |
| **Cart / Checkout / Storefront** | **does not exist** | ❌ **no headless checkout** |

- **No cart-to-checkout-URL API** (nothing like Shopify Storefront's `checkoutUrl`). So
  Squarespace **cannot** be a redirect-takeover provider the way Shopify is — there's no
  URL to redirect to that carries a programmatic cart.
- The Orders API's "import" is for pulling *external* sales **into** Squarespace's
  records, not for us to create an order Squarespace will charge + fulfil.
- **API access requires a paid Commerce plan** (Business/Commerce tier) — you already
  flagged this. API keys / OAuth exist once you're on that tier.

**Net:** Squarespace can only be one of:
1. **Display + deep-link** — list SQSP products on our site, "Buy on our store" links out
   to the Squarespace product page (separate session, separate payment). Read-only,
   low value, and honestly not worth a plugin.
2. **Full takeover** — but with *no checkout API*, "takeover" means iframing/linking the
   Squarespace store, which is strictly worse than what Shopify's plugin does.

Given both options are weak and API access is paywalled, **Squarespace is the weakest of
the three and the lowest priority** — which matches your instinct that you likely won't
use it.

---

## 4. Roadblocks summary (all three active)

| # | Roadblock | Affected | Why it hurts |
|---|---|---|---|
| 1 | Each hosted checkout only accepts its own catalog | Shopify, SQSP | Mixed cart → multiple payments; unavoidable |
| 2 | Squarespace has no headless checkout API | SQSP | Can't sell SQSP goods through our site at all |
| 3 | Different money flow per rail | all | Printify = we hold funds & pay out; hosted = they hold funds & pay merchant. Can't share one ledger |
| 4 | Tax computed by whoever owns checkout | all | Mixing rails → inconsistent/duplicated tax handling → compliance risk |
| 5 | Refunds split across rails | Shopify, SQSP | Native/Printify refund = Stripe refund + Printify cancel; hosted refunds live on their side |
| 6 | Order reconciliation | Shopify, SQSP | Orders placed on their checkout only enter our DB via read-API sync (dashboard is read-only) |
| 7 | Inventory truth / oversell window | ingest | Ingested stock is a periodic snapshot; re-validate at checkout (we do this for Printify) |

Roadblocks 1–5 all point the same direction: **do not let two payment rails be live at
once.**

---

## 5. Recommended model — two mutually-exclusive storefront modes

Generalise the existing `isShopifyActive()` override seam into a **storefront mode**
resolved once, server-side, and mirrored to the admin.

### Mode U — Unified (own checkout) — *the default & the "clean" buyer experience*
- Sources: **native** + any number of **ingest** providers (Printify, future POD).
- One catalog (`shop_products` with `external_provider`/`external_id` provenance),
  one cart, **one Stripe checkout**.
- Shipping = native rules + each ingest provider's shipping quote as line costs
  (`calcPrintifyShipping` already does this).
- After payment: **fulfilment router** groups order lines by `external_provider` and
  dispatches each group — native → manual queue, `printify` → `submitOrderToPrintify`.
- Reviews, categories, collections, search all work natively (that's why Printify was
  built as ingest, not override).
- Buyer pays **once**; may receive **several shipments**. This is the cleanest UX.

### Mode H — Hosted takeover (delegate checkout) — *current Shopify behaviour*
- Exactly **one** hosted provider owns `/shop/*`: catalog live-read, checkout redirects
  to the provider, payment + tax + fulfilment theirs.
- Native/ingest shop is hidden; admin shop becomes a read-only dashboard over their API
  (the `ShopifyManagedBanner` pattern).
- Squarespace *could* nominally sit here but has no checkout API, so in practice only
  Shopify qualifies today.

### The exclusivity rules (enforce in the feature/plugin planner)
1. **At most one hosted provider enabled at a time.** Enabling a second hosted provider
   is rejected with a clear message.
2. **Hosted mode and Unified mode are mutually exclusive.** Turning on a hosted provider
   puts the shop in takeover (hides native + ingest); turning it off restores Unified.
   (Matches today: Shopify enabled+configured ⇒ override; else built-in shop.)
3. **Ingest providers stack freely** within Unified mode. Printify + Printful + native =
   fine, one checkout.

This guarantees a single payment rail is ever live, which dissolves roadblocks 1, 3, 4,
5 and most of 6.

---

## 6. How this maps to the codebase (abstraction sketch — not built here)

Introduce a `CommerceProvider` contract with a declared archetype so adding a provider
is Open/Closed (no checkout rewrites):

```ts
type CommerceArchetype = 'ingest' | 'hosted';

interface CommerceProvider {
  key: string;                       // 'printify' | 'shopify' | 'squarespace'
  archetype: CommerceArchetype;

  // ingest providers implement these (Unified mode):
  syncCatalog?(ctx): Promise<SyncResult>;          // → upsertExternalProduct
  calcShipping?(lines): Promise<Cents>;            // → added to Stripe total
  submitFulfillment?(order, lines): Promise<void>; // post-payment fan-out

  // hosted providers implement these (Takeover mode):
  isActive?(): boolean;              // configured + enabled → owns storefront
  buildCheckout?(cart): Promise<{ redirectUrl: string }>;
  syncDashboard?(): Promise<DashboardSnapshot>;    // read-only admin view
}
```

- **Fulfilment router** (new, small): on order paid, `groupBy(line.externalProvider)` →
  call each provider's `submitFulfillment`. Native lines → manual queue. Generalises the
  current post-commit `submitOrderToPrintify(orderId)` hook.
- **Storefront-mode resolver** (new, small): generalises `isShopifyActive()` →
  `resolveStorefrontMode()` returning `{ mode: 'unified' | 'hosted', hostedProvider? }`.
  `services/shopifySource.ts` becomes one hosted adapter behind it.
- **Registry + planner guard**: reuse the plugin/feature lifecycle; add the exclusivity
  checks from §5 to `validateEnable` so a second hosted provider (or hosted+native) is
  rejected at enable time with a helpful error.

Adding Printful later ⇒ one new *ingest* provider, **zero** checkout changes. Adding a
"BigCommerce hosted" ⇒ one new *hosted* provider. That's the payoff of the archetype
split.

---

## 7. Recommendation

1. **Build the abstraction, not three bespoke plugins.** Formalise `CommerceProvider`
   (ingest vs hosted) + the fulfilment router + the storefront-mode resolver. Printify
   and Shopify retrofit into it cleanly; it's the right home before adding a third.
2. **Keep the two modes mutually exclusive** and enforce it in the planner. This is what
   keeps the buyer to a single payment.
3. **Deprioritise / skip Squarespace.** No headless checkout API + paywalled access =
   at best a read-only display+deep-link integration. If you ever want it, slot it as a
   *hosted* provider that only supports `syncDashboard` + deep-links — but it can't
   deliver "sell SQSP goods through our checkout."
4. **If you truly need to surface all three catalogs at once:** native + Printify sell
   through our Stripe checkout; Shopify/Squarespace items render as cards that
   **deep-link out** to buy on the provider (explicit separate transaction). Be honest
   in the UI that those are separate purchases — never silently split a cart mid-checkout.

**Bottom line:** "one cart, one payment, all three fulfil" is achievable only for the
*ingest* family (native + Printify + future POD). Hosted providers (Shopify, and a
hypothetical Squarespace) can each own the whole shop by themselves, but can never share
a cart with each other or with the native shop. Design around that and the system stays
clean; fight it and you inherit split payments, split tax, and split refunds.
