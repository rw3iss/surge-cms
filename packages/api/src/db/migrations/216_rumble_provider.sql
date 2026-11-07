-- Rumble as a social connection + feed platform.
--
-- No official API: the connection holds the public channel URL (basic tier:
-- channel pages → social_posts + per-video numbers) and, optionally, the
-- owner's Live Stream API URL (a secret; subscribers, follower history, live
-- stats). See docs/how-it-works/SOCIAL.md → Rumble.
--
-- ADD VALUE runs inside the migration transaction (allowed since PG 12); the
-- new values are not USED here, which is the one thing a transaction forbids.
ALTER TYPE connection_provider ADD VALUE IF NOT EXISTS 'rumble';
ALTER TYPE social_platform ADD VALUE IF NOT EXISTS 'rumble';
