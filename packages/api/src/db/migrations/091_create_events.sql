-- @feature events
--
-- Events + calendar module.
--
-- `events` is the content. `event_subscribers` is who wants to hear about them
-- (site-wide when event_id IS NULL, or one specific event), and
-- `event_push_subscriptions` holds Web Push endpoints for desktop notifications.
-- `event_notifications_sent` is the idempotency ledger — without it a worker
-- restart or a double publish would mail the same people twice.

CREATE TABLE IF NOT EXISTS events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(255) NOT NULL,
    slug            VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT,
    -- Timestamps are stored with a zone; an all-day event pins to 00:00 in the
    -- site's zone and `all_day` tells the UI to hide the time.
    starts_at       TIMESTAMPTZ NOT NULL,
    ends_at         TIMESTAMPTZ,
    all_day         BOOLEAN NOT NULL DEFAULT false,
    location        VARCHAR(255),
    url             VARCHAR(500),
    featured_image  VARCHAR(500),
    status          VARCHAR(20) NOT NULL DEFAULT 'published'
                    CHECK (status IN ('draft', 'published', 'cancelled')),
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The calendar always queries "events within a window", so the range scan on
-- starts_at is the one index that matters.
CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events (starts_at);
CREATE INDEX IF NOT EXISTS idx_events_status_starts ON events (status, starts_at);

CREATE TABLE IF NOT EXISTS event_subscribers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL = subscribed to ALL events; otherwise this one event.
    event_id        UUID REFERENCES events(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    notify_email    BOOLEAN NOT NULL DEFAULT true,
    notify_push     BOOLEAN NOT NULL DEFAULT false,
    -- One-click unsubscribe, same pattern as mailing lists.
    unsubscribe_token TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (event, email). The COALESCE lets a site-wide subscription
-- (event_id NULL) coexist with per-event ones without a partial-index pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_subscribers_unique
    ON event_subscribers (COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(email));
CREATE INDEX IF NOT EXISTS idx_event_subscribers_event ON event_subscribers (event_id);

CREATE TABLE IF NOT EXISTS event_push_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    email           VARCHAR(255),
    -- The browser's Push endpoint + the two keys needed to encrypt to it.
    endpoint        TEXT NOT NULL UNIQUE,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    user_agent      VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event_notifications_sent (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    -- 'published' | 'updated' | 'reminder' — one send per kind per recipient.
    kind            VARCHAR(30) NOT NULL,
    channel         VARCHAR(20) NOT NULL,
    recipient       VARCHAR(255) NOT NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_notifications_once
    ON event_notifications_sent (event_id, kind, channel, LOWER(recipient));
