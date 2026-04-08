-- Partial indexes for the scheduled publisher job.
-- Split from 014 because Postgres forbids using a newly-added enum value
-- in the same transaction that added it (error 55P04).

CREATE INDEX IF NOT EXISTS idx_posts_publish_at
    ON posts(publish_at) WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_pages_publish_at
    ON pages(publish_at) WHERE status = 'scheduled';
