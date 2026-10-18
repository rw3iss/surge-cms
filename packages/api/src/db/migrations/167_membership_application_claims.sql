-- Membership applications: approval claim + offer expiry.
--
-- approving_at  set by the admin's Approve BEFORE Stripe is called, in one
--               conditional UPDATE, so two approvals at once (two admins, two
--               tabs, a retried request) cannot both charge the card. The
--               status stays 'pending' while it is set; a claim older than
--               5 minutes is stale (a crash mid-approval) and may be retaken.
-- offer_expires_at  a "hide price" approval is an OFFER the member accepts by
--               paying; it now ends (default 30 days, Users → Settings).
--               Older unstarted offers get 30 days from the upgrade.
ALTER TABLE membership_applications ADD COLUMN IF NOT EXISTS approving_at TIMESTAMPTZ;
ALTER TABLE membership_applications ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ;
-- Existing unstarted offers get 30 days from NOW (not from their decision
-- date — expiring them silently on upgrade would surprise members).
UPDATE membership_applications SET offer_expires_at = NOW() + INTERVAL '30 days'
 WHERE status = 'approved' AND activated_at IS NULL AND offer_expires_at IS NULL;
