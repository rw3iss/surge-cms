-- Media: large files + video metadata (core — not tied to the video feature).
--
-- size INTEGER capped files at 2 GiB; a 20 GB video upload needs BIGINT.
-- updated_at: the media list's "updated" sort already read COALESCE(updated_at,
--   created_at), but the column never existed — that sort errored.
-- width/height/duration_ms: probed for video (and usable for images).
-- status: a video is 'processing' until its first rendition is playable.
-- access_level: 'public' | 'private'. Private videos are encrypted and play
--   only for viewers with the media.private:view permission.
ALTER TABLE media ALTER COLUMN size TYPE BIGINT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE media ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE media ADD COLUMN IF NOT EXISTS height INTEGER;
ALTER TABLE media ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE media ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'ready';
ALTER TABLE media ADD COLUMN IF NOT EXISTS access_level VARCHAR(16) NOT NULL DEFAULT 'public';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_status_chk') THEN
        ALTER TABLE media ADD CONSTRAINT media_status_chk CHECK (status IN ('uploading', 'processing', 'ready', 'failed'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'media_access_level_chk') THEN
        ALTER TABLE media ADD CONSTRAINT media_access_level_chk CHECK (access_level IN ('public', 'private'));
    END IF;
END $$;
