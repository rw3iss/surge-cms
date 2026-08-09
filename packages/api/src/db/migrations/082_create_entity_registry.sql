-- Generic entity system: type-definition registry + field schemas + the
-- runtime-migration ledger used by the table generator. Core infrastructure
-- (not feature-gated) — always installed.

CREATE TABLE IF NOT EXISTS entity_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(64) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    label_plural VARCHAR(255) NOT NULL,
    singular_var VARCHAR(64) NOT NULL,
    plural_var VARCHAR(64) NOT NULL,
    description TEXT,
    -- 'core' (system-owned, scaffolded by a feature) | 'custom' (admin-made)
    origin VARCHAR(16) NOT NULL DEFAULT 'custom' CHECK (origin IN ('core', 'custom')),
    internal BOOLEAN NOT NULL DEFAULT false,
    owner_feature VARCHAR(64),
    -- Backing table: generated ('ce_<key>') or adopted ('posts').
    table_name VARCHAR(64) NOT NULL UNIQUE,
    has_slug BOOLEAN NOT NULL DEFAULT true,
    has_status BOOLEAN NOT NULL DEFAULT false,
    searchable BOOLEAN NOT NULL DEFAULT false,
    revisioned BOOLEAN NOT NULL DEFAULT false,
    routing JSONB NOT NULL DEFAULT '{}'::jsonb,
    caching JSONB NOT NULL DEFAULT '{}'::jsonb,
    admin_list_route VARCHAR(255),
    admin_edit_route VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_types_owner_feature ON entity_types (owner_feature);

CREATE TABLE IF NOT EXISTS entity_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type_id UUID NOT NULL REFERENCES entity_types(id) ON DELETE CASCADE,
    key VARCHAR(64) NOT NULL,
    label VARCHAR(255) NOT NULL,
    type VARCHAR(32) NOT NULL,
    -- Locked: a core field cannot be renamed/retyped/removed.
    core BOOLEAN NOT NULL DEFAULT false,
    required BOOLEAN NOT NULL DEFAULT false,
    is_unique BOOLEAN NOT NULL DEFAULT false,
    indexed BOOLEAN NOT NULL DEFAULT false,
    searchable BOOLEAN NOT NULL DEFAULT false,
    default_value JSONB,
    options JSONB,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type_id, key)
);

CREATE INDEX IF NOT EXISTS idx_entity_fields_type ON entity_fields (entity_type_id, position);

-- Ledger of DDL statements the table generator has applied for each entity
-- type. Hash-guarded so re-applying the same statement is a no-op (idempotent
-- runtime migrations, mirroring plugin_migrations).
CREATE TABLE IF NOT EXISTS entity_migrations (
    id SERIAL PRIMARY KEY,
    entity_type_key VARCHAR(64) NOT NULL,
    statement_hash VARCHAR(64) NOT NULL,
    statement TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type_key, statement_hash)
);

-- Reuse the shared updated_at trigger function (defined in the base schema).
DROP TRIGGER IF EXISTS trg_entity_types_updated_at ON entity_types;
CREATE TRIGGER trg_entity_types_updated_at
    BEFORE UPDATE ON entity_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_entity_fields_updated_at ON entity_fields;
CREATE TRIGGER trg_entity_fields_updated_at
    BEFORE UPDATE ON entity_fields
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
