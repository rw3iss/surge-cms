-- @feature video

-- Quick replay: a live recording is first COPIED (no re-encode) into a
-- seekable, faststart MP4 — H.264 video kept as-is, audio → AAC — that plays
-- in every browser within a minute or two of the show ending, at the camera's
-- original quality. The normal HLS ladder is encoded afterwards and takes
-- over; the MP4 stays as the "Original" download.
ALTER TABLE media_videos ADD COLUMN IF NOT EXISTS quick_replay BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE media_videos ADD COLUMN IF NOT EXISTS quick_replay_path TEXT;
ALTER TABLE media_videos ADD COLUMN IF NOT EXISTS quick_replay_bytes BIGINT;
