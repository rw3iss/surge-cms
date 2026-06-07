-- @feature mailing_lists

CREATE TABLE IF NOT EXISTS mailing_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    registered_users_only BOOLEAN NOT NULL DEFAULT FALSE,
    double_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    -- FK added later in 032 once mail_templates exists.
    default_template_id UUID NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mailing_lists_enabled ON mailing_lists (is_enabled);

CREATE OR REPLACE FUNCTION mailing_lists_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mailing_lists_updated_at ON mailing_lists;
CREATE TRIGGER trg_mailing_lists_updated_at
    BEFORE UPDATE ON mailing_lists
    FOR EACH ROW EXECUTE FUNCTION mailing_lists_updated_at();
