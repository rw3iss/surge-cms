-- Migration 027: Drop existing rows for legacy/removed block types.
--
-- The 'post' (single-embed) block is being merged into 'post_list'
-- (renamed to "Posts" in the picker), and 'gallery' is folded into
-- the multi-image upgrade of 'image'. We're starting fresh on these
-- block types — existing rows are deleted so the editor and renderer
-- don't have to keep legacy code paths beyond a polite fallback.
--
-- The block_type ENUM values are kept (Postgres enums can't drop
-- values without rewriting the type), but no rows reference them.
-- Pages with these blocks will simply have a smaller block list
-- after this runs.

DELETE FROM blocks WHERE type IN ('post', 'gallery');
