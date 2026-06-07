-- Migration: Add post_content_blocks table
-- Run with: psql $DATABASE_URL -f src/db/migrations/001_add_content_blocks.sql

DO $$ BEGIN
  CREATE TYPE content_block_type AS ENUM (
    'text', 'social_media', 'image', 'video', 'document', 'url_link'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS post_content_blocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    type content_block_type NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    data JSONB NOT NULL DEFAULT '{}',
    provider VARCHAR(50),
    media_url TEXT,
    file_name VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_content_blocks_post_id ON post_content_blocks(post_id);
CREATE INDEX IF NOT EXISTS idx_post_content_blocks_order ON post_content_blocks(post_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_post_content_blocks_type ON post_content_blocks(type);
CREATE INDEX IF NOT EXISTS idx_post_content_blocks_provider ON post_content_blocks(provider);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_post_content_blocks_updated_at ON post_content_blocks;
CREATE TRIGGER update_post_content_blocks_updated_at
    BEFORE UPDATE ON post_content_blocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
