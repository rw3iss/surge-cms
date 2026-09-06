-- @feature shop
-- When a product's "new merchandise" announcement was emailed.
--
-- The stamp is what makes the announcement fire ONCE per product. Operators
-- publish in batches, un-publish to fix a typo and re-publish, and re-sync
-- supplier catalogues — without this, each of those would mail the list again.
--
-- NULL = never announced. Existing products are therefore all NULL, which would
-- announce the entire back catalogue the first time auto-send is switched on —
-- so they are backfilled to now(): everything that exists today counts as
-- already announced, and only genuinely new products trigger an email.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS merch_announced_at TIMESTAMPTZ;

UPDATE shop_products SET merch_announced_at = NOW() WHERE merch_announced_at IS NULL;
