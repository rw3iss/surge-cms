-- Recurring donations: a donor can make a campaign donation repeat (weekly,
-- monthly, every 3 or 6 months, yearly). Stripe runs the schedule as a
-- Subscription; every paid invoice becomes one `donations` row.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS allow_recurring_donations BOOLEAN NOT NULL DEFAULT false;
-- The Stripe Product a campaign's recurring prices hang off (created on first use).
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;
-- Set on donations that came from a recurring schedule.
ALTER TABLE donations ADD COLUMN IF NOT EXISTS recurring_interval VARCHAR(16);
ALTER TABLE donations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
CREATE INDEX IF NOT EXISTS idx_donations_stripe_subscription ON donations (stripe_subscription_id)
    WHERE stripe_subscription_id IS NOT NULL;
