-- Create social_connections table for provider OAuth and API credentials

DO $$ BEGIN
    CREATE TYPE connection_provider AS ENUM (
        'instagram', 'facebook', 'tiktok', 'patreon', 'youtube', 'twitter'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS social_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider connection_provider NOT NULL UNIQUE,
    is_connected BOOLEAN NOT NULL DEFAULT false,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    display_name VARCHAR(255),
    account_id VARCHAR(255),
    credentials JSONB NOT NULL DEFAULT '{}',
    settings JSONB NOT NULL DEFAULT '{}',
    auto_publish BOOLEAN NOT NULL DEFAULT false,
    auto_publish_count INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMPTZ,
    connected_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_connections_provider ON social_connections(provider);
CREATE INDEX IF NOT EXISTS idx_social_connections_enabled ON social_connections(is_enabled);
CREATE INDEX IF NOT EXISTS idx_social_connections_sort ON social_connections(sort_order);

-- Add updated_at trigger (idempotent — schema.sql also defines this trigger,
-- so a fresh install applies schema first, then this migration; without the
-- DROP, re-creating it would fail with "trigger already exists").
DROP TRIGGER IF EXISTS update_social_connections_updated_at ON social_connections;
CREATE TRIGGER update_social_connections_updated_at
    BEFORE UPDATE ON social_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
