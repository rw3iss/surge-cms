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

Credentials live in this plugin's config; the sync + fulfillment engine is in the
CMS core (`services/printify/*`).
