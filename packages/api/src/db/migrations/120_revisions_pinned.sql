-- Pinned revisions survive retention.
--
-- A revision that something else depends on — the template version a mailing
-- list job was sent with, which its "view in browser" archive and the job page
-- read back — must not be swept by the age-based prune (default 10 days) or
-- the per-entity ceiling. Unpinned revisions behave exactly as before.
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
