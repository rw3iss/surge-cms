-- Subscription tiers: Stripe's interval COUNT (a price billed "every 2 weeks"
-- was stored as just "week" and shown as weekly), and an optional DISPLAY
-- price/frequency shown to members instead of the Stripe billing (e.g. show a
-- monthly price while Stripe bills half of it every 2 weeks). NULL display =
-- show the Stripe price.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS interval_count INT NOT NULL DEFAULT 1;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_price_cents INT;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_interval TEXT;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_interval_count INT;
