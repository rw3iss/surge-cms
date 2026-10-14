-- A membership level shown only to admins/sysadmins (for testing a new level on the live site).
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS dev_only BOOLEAN NOT NULL DEFAULT false;
