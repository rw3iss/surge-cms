-- Post subscription gating: a post may require a subscription TIER
-- (subscription_plans). A viewer passes when their tier's sort_order is at
-- least the required tier's (staff always pass). For everyone else:
--   gate_hidden        → the post is left out of every listing and 404s
--   gate_show_sample   → (when not hidden) the page shows a sample of the
--                        content, gate_sample_percent of the article text
--   neither            → the page shows title/banner + an upgrade prompt
ALTER TABLE posts ADD COLUMN IF NOT EXISTS required_tier_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS gate_hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS gate_show_sample BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS gate_sample_percent SMALLINT NOT NULL DEFAULT 25;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_gate_sample_percent_chk') THEN
        ALTER TABLE posts ADD CONSTRAINT posts_gate_sample_percent_chk CHECK (gate_sample_percent BETWEEN 1 AND 100);
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS posts_required_tier ON posts (required_tier_id) WHERE required_tier_id IS NOT NULL;
