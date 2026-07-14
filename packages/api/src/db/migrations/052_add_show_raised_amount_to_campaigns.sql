-- Add per-campaign "show raised amount" toggle.
--
-- When false, public campaign renderings (the campaign block, the
-- campaign detail page, the donate listing) show no monetary
-- information at all — not the amount raised, not the goal, not the
-- progress bar — only the basic campaign info. When true (default),
-- the raised amount is shown, and the goal / progress bar appear only
-- if a fundraising goal was also set.

ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS show_raised_amount BOOLEAN NOT NULL DEFAULT true;
