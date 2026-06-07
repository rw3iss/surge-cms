-- API keys for headless clients (agents, server-to-server).
-- Plaintext keys are NEVER stored: only sha256(key) lands in key_hash.
-- key_prefix holds the first chars (e.g. 'ssk_a1b2c3d4') for display.

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    key_hash CHAR(64) NOT NULL UNIQUE,
    key_prefix VARCHAR(16) NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{read}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash) WHERE revoked_at IS NULL;
