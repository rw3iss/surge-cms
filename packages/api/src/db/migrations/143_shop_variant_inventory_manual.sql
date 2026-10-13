-- @feature shop
-- A variant's inventory set by hand in the admin. A provider sync (Printify,
-- Apliiq) no longer overwrites it: it only LOWERS it when the provider reports
-- fewer units than ours. Cleared (false) when the admin empties the field, so
-- the next sync takes the provider value again.
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS inventory_manual BOOLEAN NOT NULL DEFAULT false;
