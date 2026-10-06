# Shop go-live checklist (self-hosted, Stripe)

The built-in shop (`shop` feature) is a self-hosted Stripe storefront: catalog +
variants/inventory in Postgres, client-side cart, on-site Stripe Elements
checkout (PaymentIntent + Stripe Tax), webhook-confirmed orders, digital
downloads. This is the checklist to make a deployment production-ready and
secure. Items marked **⚠️** are security-critical — do not launch without them.

## 1. Stripe configuration

- [ ] **⚠️ Set `STRIPE_WEBHOOK_SECRET`.** Without it, `services/payment/webhook.ts`
      runs in dev mode and **skips signature verification** — a forged "paid"
      webhook could mark orders paid. With it set, every webhook is verified
      against the raw body. This is the single most important production toggle.
- [ ] Use **live** keys: `STRIPE_SECRET_KEY` (sk_live_…), `STRIPE_PUBLISHABLE_KEY`
      (pk_live_…). Consider a **restricted** secret key scoped to
      PaymentIntents + Checkout + Tax rather than a full-access key.
- [ ] Register the webhook endpoint in the Stripe Dashboard → Developers →
      Webhooks, pointing at the deployment's payments webhook URL, subscribed at
      least to `payment_intent.succeeded` (the fulfillment trigger). Copy its
      signing secret into `STRIPE_WEBHOOK_SECRET`.
- [ ] Verify the webhook round-trips: place a test order, confirm the order flips
      to paid and (for digital items) a download token is issued. Fulfillment is
      **idempotent**, so Stripe's retries are safe.
- [ ] Enable **Stripe Radar** and set fraud rules — this is your only fraud layer
      (there is no Shopify-style fraud scoring). Review 3DS/SCA settings.
- [ ] Decide on **Stripe Tax**: if you want tax calculated, activate Stripe Tax on
      the account and enable it in Shop Settings. If Tax isn't active, checkout
      falls back to 0 tax (logged) rather than blocking — so an unactivated Tax
      account silently means no tax collected.

## 2. What the code already guarantees (no action, just know it)

- **Amounts are computed server-side from DB prices** — the client cart cannot
  change what is charged (`checkout.ts`: *"never trust the client"*).
- **Inventory is validated at checkout** (409 on insufficient) and **decremented
  oversell-guarded at webhook time**.
- **Card data never touches the server** (Stripe Elements tokenizes in-browser)
  → PCI **SAQ A**, the lowest burden. Keep it that way: never accept/log raw PAN.
- **Digital-download tokens** are 24-byte `crypto.randomBytes` hex (unguessable).

## 3. Tax, legal, and money

- [ ] Register for sales-tax / VAT where you have **nexus**. Stripe Tax *calculates*
      but does **not** register or remit for you — filing is your responsibility.
- [ ] Publish **Terms**, **Privacy Policy**, **Refund/Return Policy**, and (if
      shipping physical goods) a **Shipping Policy** as pages.
- [ ] Confirm the receipt/confirmation email sender domain is authenticated
      (SPF/DKIM) so order emails don't land in spam.

## 4. Shipping & inventory reality

- [ ] Shipping is **flat rate + free-over-threshold only** (Shop Settings →
      shipping). There are **no carrier-calculated rates or labels**. If you need
      real-time UPS/USPS/FedEx quotes, that's a gap to close before selling
      physical goods at scale (see "Known gaps" below).
- [ ] Set inventory levels per variant. Note the concurrency edge: inventory is
      checked at checkout and decremented at webhook time, so under heavy
      simultaneous load two buyers can both pass on the last unit — one then needs
      a refund. Fine at low/moderate volume; watch it for hype drops.

## 5. Data & operations

- [ ] **Automated Postgres backups** — orders, customers, and PII now live in your
      DB. Verify a restore works, not just that backups run.
- [ ] Confirm **HTTPS** end-to-end (already true on surge.ryanweiss.net).
- [ ] Rate-limit / monitor the checkout + PaymentIntent endpoints against abuse.
- [ ] Set a **data-retention / deletion** process for customer PII (GDPR/CCPA if
      applicable) — you're the data controller now.
- [ ] Monitor the payments webhook for failures (Stripe Dashboard shows delivery
      status + retries).

## 6. Pre-launch smoke test

- [ ] Guest checkout: add to cart → checkout → pay with a real card (small amount)
      → order confirmation → receipt email → refund it from the admin.
- [ ] Digital item: confirm the download link works and is token-gated.
- [ ] Out-of-stock: confirm the 409 path shows a clean message.
- [ ] Tax + shipping totals match expectations for a representative address.

## Known gaps vs a hosted platform (Shopify/etc.)

These are **not** implemented in the built-in shop today. None block launch for a
simple/flat-rate/digital store; build them if your model needs them:

- Discount / promo codes, gift cards
- Carrier-calculated shipping rates + label printing
- Abandoned-cart recovery
- Multi-currency
- Built-in fraud scoring beyond Stripe Radar

## Shopify plugin note

The optional `shopify` plugin OVERRIDES this built-in shop when **enabled *and*
configured** (shop domain set). If it's enabled but not configured, the
storefront now **falls back to the built-in shop** and the admin shop pages show
a warning banner — so an unconfigured plugin can't silently blank your store.
Leave the plugin disabled to use the built-in shop.
