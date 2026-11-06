-- Social analytics digests: a periodic report, stored as a SNAPSHOT so it can
-- be read again (browser or email) at any time, kept for the configured
-- retention. Settings live in site_settings `social_analytics_settings`.
CREATE TABLE IF NOT EXISTS social_analytics_digests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    frequency     TEXT NOT NULL,                 -- daily | weekly | monthly | manual
    trigger       TEXT NOT NULL DEFAULT 'manual', -- schedule | manual
    -- One scheduled digest per slot (the local date it was due), so overlapping
    -- crons or processes cannot produce two.
    schedule_key  TEXT,
    period_from   DATE NOT NULL,
    period_to     DATE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'generating', -- generating | ready | failed
    headline      TEXT,
    data          JSONB,
    error         TEXT,
    emailed_at    TIMESTAMPTZ,
    email_count   INTEGER NOT NULL DEFAULT 0,
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS social_analytics_digests_schedule_uq
    ON social_analytics_digests (schedule_key) WHERE schedule_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_analytics_digests_created_idx ON social_analytics_digests (created_at DESC);
