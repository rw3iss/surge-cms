-- Live-show bans can be time-limited, and record the show they came from.
-- expires_at NULL = permanent (every ban before this migration).
ALTER TABLE live_bans ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE live_bans ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_live_bans_expires ON live_bans (expires_at) WHERE expires_at IS NOT NULL;
