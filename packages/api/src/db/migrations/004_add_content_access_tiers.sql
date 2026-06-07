-- Add access level to pages and posts
DO $$ BEGIN
  CREATE TYPE content_access_level AS ENUM ('public', 'member', 'patron');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE pages ADD COLUMN IF NOT EXISTS access_level content_access_level DEFAULT 'public';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS access_level content_access_level DEFAULT 'public';

-- 'public' = anyone can view
-- 'member' = any logged-in user
-- 'patron' = only Patreon patrons with active membership
