-- Live-show recordings (method `browser`): the host page records its camera
-- with MediaRecorder and uploads equal-size parts straight to object storage
-- (S3/R2 multipart) while live. One row per multipart upload; completing it
-- creates the replay's `media` row (encoded by the video pipeline).
CREATE TABLE IF NOT EXISTS live_recordings (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    method VARCHAR(16) NOT NULL DEFAULT 'browser',
    status VARCHAR(16) NOT NULL DEFAULT 'recording',
    mime_type VARCHAR(128) NOT NULL,
    object_key TEXT NOT NULL,
    upload_id TEXT NOT NULL,
    part_size BIGINT NOT NULL,
    media_id UUID REFERENCES media(id) ON DELETE SET NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'live_recordings_status_chk') THEN
        ALTER TABLE live_recordings ADD CONSTRAINT live_recordings_status_chk
            CHECK (status IN ('recording', 'finalizing', 'completed', 'aborted', 'failed'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS live_recordings_post ON live_recordings (post_id, created_at DESC);
-- At most one open recording per show (start resumes it).
CREATE UNIQUE INDEX IF NOT EXISTS live_recordings_one_open ON live_recordings (post_id) WHERE status = 'recording';
