-- Migration 029: rename `social_feed` block type to `social`.
--
-- Social Media Post and Social Feed have already been merged into one
-- block (migration 028 deleted the old single-post `social_media`
-- rows). The remaining type — `social_feed` — is being renamed to
-- `social` to match the new spec where one block handles both feeds
-- and pinned-post lists.
--
-- Postgres can't drop enum values, so we add `social` and migrate any
-- existing rows. Per the operator's "start fresh" stance, leftover
-- `social_feed` rows can also be deleted; we migrate them in place
-- because there's no cost to it and the data shape is compatible.

ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'social';

-- Need a separate transaction for the value to be visible.
COMMIT;

UPDATE blocks SET type = 'social' WHERE type = 'social_feed';
