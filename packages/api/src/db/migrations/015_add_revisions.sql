-- Revision history for content entities (posts, pages).
-- Stores JSON snapshots of the entity state on each save.

CREATE TABLE IF NOT EXISTS revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(32) NOT NULL,
    entity_id UUID NOT NULL,
    version INTEGER NOT NULL,
    snapshot JSONB NOT NULL,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, entity_id, version)
);

CREATE INDEX IF NOT EXISTS idx_revisions_entity ON revisions(entity_type, entity_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_created_at ON revisions(created_at DESC);
