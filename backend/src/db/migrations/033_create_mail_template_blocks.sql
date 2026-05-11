-- @feature mailing_lists

CREATE TABLE IF NOT EXISTS mail_template_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES mail_templates(id) ON DELETE CASCADE,
    parent_block_id UUID NULL REFERENCES mail_template_blocks(id) ON DELETE CASCADE,
    block_type block_type NOT NULL,
    position INTEGER NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    style JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_template_blocks_template
    ON mail_template_blocks (template_id, parent_block_id, position);
