-- @feature mailing_lists

CREATE TABLE IF NOT EXISTS mail_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    subject TEXT NOT NULL DEFAULT '',
    preheader TEXT,
    from_name TEXT,
    from_email TEXT,
    reply_to TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mail_templates_enabled ON mail_templates (is_enabled);

CREATE OR REPLACE FUNCTION mail_templates_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mail_templates_updated_at ON mail_templates;
CREATE TRIGGER trg_mail_templates_updated_at
    BEFORE UPDATE ON mail_templates
    FOR EACH ROW EXECUTE FUNCTION mail_templates_updated_at();

-- Late-bound FK from mailing_lists.default_template_id (column added in 030).
ALTER TABLE mailing_lists
    DROP CONSTRAINT IF EXISTS mailing_lists_default_template_id_fkey;
ALTER TABLE mailing_lists
    ADD CONSTRAINT mailing_lists_default_template_id_fkey
    FOREIGN KEY (default_template_id) REFERENCES mail_templates(id) ON DELETE SET NULL;
