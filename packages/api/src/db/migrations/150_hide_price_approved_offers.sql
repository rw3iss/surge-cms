-- "Hide price" for levels that require approval: no prices are shown and no
-- card is taken until an admin approves; approval then makes an OFFER the
-- member accepts by choosing billing and paying (activated_at set then).
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS hide_price BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE membership_applications ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
-- Existing approvals already started billing.
UPDATE membership_applications SET activated_at = COALESCE(decided_at, NOW()) WHERE status = 'approved' AND activated_at IS NULL;
