-- @feature video

-- Self-hosted adaptive video (docs/plans/completed/2026-10-08-self-hosted-video.md).
--
-- Large files go browser → R2 directly (multipart, presigned parts) through a
-- resumable upload SESSION. An encode JOB turns the original into HLS
-- RENDITIONS (one at a time), plus a TEASER (first N seconds, never
-- encrypted) and per-rung MP4 DOWNLOADS. Private videos are AES-128 encrypted
-- with a SHARED key; keys are versioned so a rotation never breaks videos
-- encoded with an older one.

CREATE TABLE IF NOT EXISTS media_upload_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    filename      VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100) NOT NULL,
    size          BIGINT NOT NULL,
    fingerprint   VARCHAR(128) NOT NULL,
    object_key    TEXT NOT NULL,
    upload_id     TEXT NOT NULL,
    part_size     BIGINT NOT NULL,
    part_count    INTEGER NOT NULL,
    status        VARCHAR(16) NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading', 'completed', 'aborted', 'expired')),
    options       JSONB NOT NULL DEFAULT '{}',
    media_id      UUID REFERENCES media(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);
CREATE INDEX IF NOT EXISTS media_upload_sessions_resume
    ON media_upload_sessions (user_id, fingerprint) WHERE status = 'uploading';
CREATE INDEX IF NOT EXISTS media_upload_sessions_expiry
    ON media_upload_sessions (expires_at) WHERE status = 'uploading';

-- Shared encryption keys for private videos. Never in media/media_videos, so
-- a SELECT * there can never leak key bytes. Rotation adds a version; old ones
-- stay (retired) because already-encoded videos reference them.
CREATE TABLE IF NOT EXISTS video_keys (
    version     SERIAL PRIMARY KEY,
    key_bytes   BYTEA NOT NULL CHECK (octet_length(key_bytes) = 16),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS media_videos (
    media_id             UUID PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
    encode_id            VARCHAR(24) NOT NULL,
    -- video/<mediaId>/<encodeId>-<secret>: the secret segment keeps the full
    -- stream's path unguessable from the (public) teaser path.
    storage_prefix       TEXT NOT NULL,
    teaser_prefix        TEXT,
    source_key           TEXT,
    source_size          BIGINT,
    keep_original        BOOLEAN NOT NULL DEFAULT true,
    original_expires_at  TIMESTAMPTZ,
    probe                JSONB,
    poster_url           TEXT,
    thumbnails_vtt       TEXT,
    encrypted            BOOLEAN NOT NULL DEFAULT false,
    key_version          INTEGER REFERENCES video_keys(version),
    iv_hex               VARCHAR(32),
    teaser_enabled       BOOLEAN NOT NULL DEFAULT true,
    teaser_start_ms      INTEGER NOT NULL DEFAULT 0,
    teaser_duration_ms   INTEGER NOT NULL DEFAULT 60000,
    hls_version          INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_jobs (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    media_id         UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    -- encode = from the original; repackage = re-segment the stored per-rung
    -- MP4s (key rotation / access change) without re-encoding.
    kind             VARCHAR(16) NOT NULL DEFAULT 'encode' CHECK (kind IN ('encode', 'repackage')),
    status           VARCHAR(16) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'downloading', 'probing', 'encoding', 'uploading',
                          'finalizing', 'ready', 'failed', 'cancelled')),
    blocked_reason   VARCHAR(32),
    priority         INTEGER NOT NULL DEFAULT 100,
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 3,
    next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner      TEXT,
    lease_until      TIMESTAMPTZ,
    cancel_requested BOOLEAN NOT NULL DEFAULT false,
    progress         NUMERIC(5,2) NOT NULL DEFAULT 0,
    error            TEXT,
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at       TIMESTAMPTZ,
    finished_at      TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS video_jobs_one_active
    ON video_jobs (media_id) WHERE status NOT IN ('ready', 'failed', 'cancelled');
CREATE INDEX IF NOT EXISTS video_jobs_claim
    ON video_jobs (priority, created_at) WHERE status NOT IN ('ready', 'failed', 'cancelled');

CREATE TABLE IF NOT EXISTS video_renditions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- The job that last wrote this rendition. Renditions belong to the MEDIA
    -- (one row per variant+quality); a re-encode replaces them.
    job_id          UUID REFERENCES video_jobs(id) ON DELETE SET NULL,
    media_id        UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    variant         VARCHAR(8) NOT NULL DEFAULT 'full' CHECK (variant IN ('full', 'teaser')),
    name            VARCHAR(16) NOT NULL,
    sort_order      INTEGER NOT NULL,
    width           INTEGER,
    height          INTEGER,
    bandwidth       INTEGER,
    avg_bandwidth   INTEGER,
    codecs          VARCHAR(64),
    status          VARCHAR(16) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'encoding', 'uploading', 'ready', 'failed', 'skipped')),
    progress        NUMERIC(5,2) NOT NULL DEFAULT 0,
    attempts        INTEGER NOT NULL DEFAULT 0,
    error           TEXT,
    playlist_path   TEXT,
    bytes           BIGINT,
    -- Per-rung MP4 for downloads (full variant only), under a secret path.
    download_path   TEXT,
    download_bytes  BIGINT,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    UNIQUE (media_id, variant, name)
);
CREATE INDEX IF NOT EXISTS video_renditions_media ON video_renditions (media_id, variant, status);

-- Kept originals are deleted after video_settings.originalRetentionDays.
CREATE INDEX IF NOT EXISTS media_videos_original_expiry
    ON media_videos (original_expires_at) WHERE source_key IS NOT NULL;
