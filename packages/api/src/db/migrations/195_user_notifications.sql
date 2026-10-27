-- In-app notifications (the admin's Notifications widget + /admin/notifications):
-- one row per recipient user, created by `notify()` for types whose in-app
-- channel is on. Cleared rows are hidden and swept; everything expires after
-- the retention period (Settings → Notifications).
CREATE TABLE IF NOT EXISTS user_notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(64) NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    url         TEXT,
    read_at     TIMESTAMPTZ,
    cleared_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications (user_id, created_at DESC) WHERE cleared_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread ON user_notifications (user_id) WHERE read_at IS NULL AND cleared_at IS NULL;

-- Desktop (Web Push) subscriptions of signed-in users, one per browser.
CREATE TABLE IF NOT EXISTS user_push_subscriptions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT NOT NULL UNIQUE,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_push_subscriptions_user ON user_push_subscriptions (user_id);
