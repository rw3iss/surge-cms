-- Per-member opt-out of reply emails (comment replies, forum replies).
-- Core, like 132: the column exists whether or not Comments/Forum are on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reply_emails BOOLEAN NOT NULL DEFAULT true;
