-- @feature forum

-- "Hide from forum index": a category left out of the forum index, unscoped
-- discovery lists and the sitemap. Its threads still open by link, and a
-- forum block / query naming the category still lists them.
ALTER TABLE forum_categories ADD COLUMN IF NOT EXISTS hidden_from_index BOOLEAN NOT NULL DEFAULT false;

-- Guest threads (Forum → Settings → Allow anonymous posting) have no author.
-- 135 already declares the column nullable; kept explicit for older installs.
ALTER TABLE forum_threads ALTER COLUMN author_id DROP NOT NULL;
