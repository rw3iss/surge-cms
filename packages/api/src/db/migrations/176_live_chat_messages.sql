-- Live-show chat kept after the show: replay viewers can read it, moderators
-- keep a record (a deleted message is marked, not dropped), and the host can
-- download a transcript. Written best-effort beside the Redis room history.
CREATE TABLE IF NOT EXISTS live_chat_messages (
    id          UUID PRIMARY KEY,
    post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    handle      TEXT,
    role        TEXT,
    body        TEXT NOT NULL,
    reply_to    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ,
    deleted_by  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_live_chat_messages_post ON live_chat_messages (post_id, created_at);
