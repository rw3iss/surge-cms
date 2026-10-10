-- @feature comments

-- Per-item comment settings + counters, for ANY target type (post, event, …).
-- One generic table rather than columns on posts/events: a feature migration
-- does not alter core tables, and new entity types opt in with no schema change.
CREATE TABLE IF NOT EXISTS comment_threads (
    target_type VARCHAR(32) NOT NULL,
    target_id UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    allow_anonymous BOOLEAN NOT NULL DEFAULT false,
    -- Readable, but no new comments.
    locked BOOLEAN NOT NULL DEFAULT false,
    comment_count INT NOT NULL DEFAULT 0,
    last_comment_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (target_type, target_id)
);
