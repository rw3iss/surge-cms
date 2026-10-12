-- Subscription-required mode: a page an operator marks "Open without a
-- subscription" stays reachable for signed-in members who have no active
-- subscription (landing, about, legal pages). Core: harmless when the mode is off.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS open_access BOOLEAN NOT NULL DEFAULT false;
