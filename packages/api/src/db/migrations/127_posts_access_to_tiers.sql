-- Posts: the old Access level (public / member / patron) is folded into
-- subscription-tier gating (migration 126). One Access control now:
-- public, or a subscription tier.
--   member → the Free tier ("signed in", Free ranks lowest)
--   patron → the `subscriber` tier, else the lowest-ranked paid tier
-- Only posts without a tier already are converted; then the column goes.
-- Pages keep their own access_level until they move to tiers too.
DO $$
DECLARE
    free_id UUID;
    paid_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'posts' AND column_name = 'access_level') THEN
        RETURN;
    END IF;
    SELECT id INTO free_id FROM subscription_plans WHERE is_free ORDER BY sort_order LIMIT 1;
    SELECT id INTO paid_id FROM subscription_plans WHERE slug = 'subscriber' LIMIT 1;
    IF paid_id IS NULL THEN
        SELECT id INTO paid_id FROM subscription_plans WHERE NOT is_free ORDER BY sort_order, created_at LIMIT 1;
    END IF;
    IF free_id IS NOT NULL THEN
        EXECUTE 'UPDATE posts SET required_tier_id = $1 WHERE required_tier_id IS NULL AND access_level::text = ''member''' USING free_id;
    END IF;
    IF paid_id IS NOT NULL THEN
        EXECUTE 'UPDATE posts SET required_tier_id = $1 WHERE required_tier_id IS NULL AND access_level::text = ''patron''' USING paid_id;
    END IF;
    ALTER TABLE posts DROP COLUMN access_level;
END $$;
