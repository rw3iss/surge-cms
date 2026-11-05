-- Threads (Meta) as a social connection + platform — analytics only for now.
--
-- The connection holds the Threads OAuth token (threads_basic +
-- threads_manage_insights). The analytics collector stores the account's own
-- threads in social_posts (platform 'threads', is_hidden = true) so per-post
-- metrics have a row to attach to; they never show in the public feed.
--
-- ADD VALUE runs inside the migration transaction (allowed since PG 12); the
-- new values are not USED here, which is the one thing a transaction forbids.
ALTER TYPE connection_provider ADD VALUE IF NOT EXISTS 'threads';
ALTER TYPE social_platform ADD VALUE IF NOT EXISTS 'threads';
