-- Migration 028: drop legacy single-post 'social_media' block rows.
--
-- Social Media Post and Social Feed have been merged into a single
-- "Social" block (DB type: social_feed) that supports either an
-- auto-feed or per-slot pinned posts. Existing 'social_media' rows
-- are deleted here per the operator's "start fresh" guidance — the
-- enum value remains so historical audit logs can still reference it.

DELETE FROM blocks WHERE type = 'social_media';
