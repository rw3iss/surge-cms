-- 070_social_posts_capture.sql
-- Capture-first social feed: let posts enter the local cache by manual paste
-- (an editor supplies a permalink) or by POSSE (published from the CMS), not
-- just provider read-syncs. Adds provenance + admin curation columns.
-- `social` is a core capability, so no @feature header.

-- How the row entered the cache:
--   'sync'   = pulled from a provider read-API (paid X path / IG / FB / YT)
--   'manual' = an editor pasted the post URL
--   'posse'  = published from the CMS compose flow
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'sync';

-- Canonical permalink (e.g. the X tweet URL). Used to re-hydrate / oEmbed.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS post_url TEXT;

-- Staff user who added / published the row (NULL for automated syncs).
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

-- Admin can hide a post from the public feed without deleting it.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

-- Manual ordering within a platform's feed (lower = earlier). Ties fall back
-- to published_at DESC.
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_social_posts_hidden ON social_posts(is_hidden);
