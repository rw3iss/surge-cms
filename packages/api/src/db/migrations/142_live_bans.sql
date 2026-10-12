-- Live-show bans: a viewer banned from ALL live shows going forward.
-- Signed-in viewers by user; guests by their browser key (a:<anonId>) and a
-- hash of their IP (a cleared localStorage alone must not undo a ban).
CREATE TABLE IF NOT EXISTS live_bans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    anon_key    TEXT,
    ip_hash     TEXT,
    reason      TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (user_id IS NOT NULL OR anon_key IS NOT NULL OR ip_hash IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_bans_user ON live_bans (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_bans_anon ON live_bans (anon_key) WHERE anon_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_live_bans_ip ON live_bans (ip_hash) WHERE ip_hash IS NOT NULL;
