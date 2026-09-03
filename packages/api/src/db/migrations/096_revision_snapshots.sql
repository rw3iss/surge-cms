-- Full-tree revision snapshots.
--
-- Revisions previously stored the page/post ROW only, so restoring a version
-- brought back the title and status but none of the content — a block deleted
-- by mistake was unrecoverable from history. Snapshots now carry the whole
-- block tree, which needs two supporting columns.

-- Deduplicates no-op saves: a save that changes nothing produces the same hash
-- as the previous revision, so it is skipped instead of adding a copy.
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Snapshot shape marker. NULL / 1 = the legacy entity-row-only shape (blocks
-- absent); 2 = { entity, blocks }. Restore reads this to decide whether it can
-- put content back or only metadata, rather than guessing from the payload.
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS snapshot_version SMALLINT NOT NULL DEFAULT 1;

-- The retention sweep and the dedupe check both look up "the newest revisions
-- for this entity"; the existing (entity_type, entity_id, version DESC) index
-- already serves that. This one serves the age-based sweep.
CREATE INDEX IF NOT EXISTS idx_revisions_entity_created
    ON revisions (entity_type, entity_id, created_at DESC);
