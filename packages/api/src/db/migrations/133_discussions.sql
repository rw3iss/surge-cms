-- @feature discussions

-- The discussion engine behind Comments and the Forum (hidden base feature).
-- A comment belongs to a TARGET (target_type + target_id): a post, an event,
-- a forum thread, or any entity type later. Replies nest via parent_id.
-- Plan: docs/plans/completed/2026-10-10-comments-and-forum.md
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(32) NOT NULL,
    target_id UUID NOT NULL,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    root_id UUID,
    depth SMALLINT NOT NULL DEFAULT 0,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Anonymous comments only (author_id NULL). The email is never shown.
    guest_name VARCHAR(80),
    guest_email VARCHAR(255),
    guest_ip INET,
    body TEXT NOT NULL,
    -- visible | pending (awaiting approval) | hidden (moderated) | deleted (soft)
    status VARCHAR(12) NOT NULL DEFAULT 'visible',
    -- The first post of a forum thread (the thread's body).
    is_opening BOOLEAN NOT NULL DEFAULT false,
    edited_at TIMESTAMPTZ,
    edit_count INT NOT NULL DEFAULT 0,
    reaction_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
    reply_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comments_target ON comments (target_type, target_id, status, created_at);
CREATE INDEX IF NOT EXISTS comments_author ON comments (author_id, created_at DESC) WHERE status = 'visible';
CREATE INDEX IF NOT EXISTS comments_parent ON comments (parent_id);
CREATE INDEX IF NOT EXISTS comments_recent ON comments (created_at DESC) WHERE status = 'visible';
CREATE INDEX IF NOT EXISTS comments_pending ON comments (created_at) WHERE status = 'pending';

-- Edit history (last edits, for moderation).
CREATE TABLE IF NOT EXISTS comment_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    edited_by UUID,
    edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comment_edits_comment ON comment_edits (comment_id, edited_at DESC);

CREATE TABLE IF NOT EXISTS comment_reactions (
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (comment_id, user_id, kind)
);

CREATE TABLE IF NOT EXISTS comment_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'open',   -- open | resolved | dismissed
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_by UUID,
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS comment_reports_open ON comment_reports (created_at) WHERE status = 'open';
CREATE UNIQUE INDEX IF NOT EXISTS comment_reports_once ON comment_reports (comment_id, reporter_id) WHERE status = 'open';

-- Denormalised per-user activity: VISIBLE comments, forum threads and replies.
-- Kept in step by the write path; a nightly reconcile recomputes it.
CREATE TABLE IF NOT EXISTS user_activity (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    comments INT NOT NULL DEFAULT 0,
    forum_threads INT NOT NULL DEFAULT 0,
    forum_replies INT NOT NULL DEFAULT 0,
    total INT GENERATED ALWAYS AS (comments + forum_threads + forum_replies) STORED,
    last_active_at TIMESTAMPTZ
);
