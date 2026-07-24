# Printify plugin

Syncs your Printify print-on-demand catalog into the built-in Shop.

- **Enable** the plugin, then set your **API token** + **Shop ID** here and click
  **Test connection** to confirm.
- Go to **Shop → Products** and click **Sync from Printify** to import the
  catalog (products, variants, images, product-type categories, tags). Products
  also auto-refresh on the configured interval.
- Printify products are read-only in the admin (edit them in Printify); reviews,
  categories, collections, search and checkout all work natively.
- Checkout uses your Stripe integration; paid orders are submitted to Printify
  for fulfillment (see `docs/PRINTIFY.md`).

## How payment & fulfillment work

- **The buyer pays you.** Checkout runs on your own Stripe account at the retail
  price (product price + Printify's live shipping quote + tax). Money lands in
  your Stripe balance.
- **Printify charges you.** When a paid order is sent to production, Printify
  **automatically charges the payment method on your Printify account** (saved
  card or Printify wallet balance) for the wholesale cost + Printify shipping.
  You are not invoiced to pay manually — it's charged at production time.
- **You keep the spread** (retail − wholesale − Printify shipping − Stripe fees).

> **Required:** add a valid payment method (card) or wallet balance in your
> Printify account **before** taking orders. Without one, `send to production`
> is held and the order won't be fulfilled even though the buyer has paid. The
> cron re-attempts held orders automatically once a payment method is present.

Set **Auto-fulfill off** in this plugin's config to have paid orders created in
Printify but *held* for manual review (send them to production from the Printify
dashboard) — a safety valve for first tests.

Credentials live in this plugin's config; the sync + fulfillment engine is in the
CMS core (`services/printify/*`).
