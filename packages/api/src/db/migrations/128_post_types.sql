-- Post TYPES (article / video / live / custom, plus site-registered keys —
-- see @sitesurge/types utils/postTypes.ts). Every existing post becomes an
-- article. `type_settings` holds per-type options (a live show's chat mode,
-- reactions, archive flag). The live_* columns track a live show's lifecycle:
-- live_status is NULL for non-live posts; live_ended_at set = the show is over
-- (its room is closed for good).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS post_type VARCHAR(32) NOT NULL DEFAULT 'article';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS type_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS live_started_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS live_ended_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS live_status VARCHAR(16);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_live_status_chk') THEN
        ALTER TABLE posts ADD CONSTRAINT posts_live_status_chk
            CHECK (live_status IS NULL OR live_status IN ('idle', 'live', 'paused', 'ended'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS posts_post_type ON posts (post_type);
