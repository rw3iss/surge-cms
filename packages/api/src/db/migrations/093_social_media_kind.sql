-- Content kind for a synced social post (YouTube: short | live | video).
-- Untagged (no @feature): social_posts is a base table and the social module is
-- always-on, so this ALTER runs unconditionally like the rest of its schema.
-- A column rather than a raw_data lookup so the block picker can filter and
-- index on it; NULL means "unclassified", which is every pre-existing row.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS media_kind VARCHAR(16);

CREATE INDEX IF NOT EXISTS idx_social_posts_platform_kind
    ON social_posts (platform, media_kind)
    WHERE media_kind IS NOT NULL;
