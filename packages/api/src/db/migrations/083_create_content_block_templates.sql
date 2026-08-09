-- Content-block templates: named, reusable block SUBTREES bound (optionally) to
-- an entity type, authored in the existing block editor. Modeled directly on
-- mail_templates / mail_template_blocks. Core infrastructure — not feature-gated.

CREATE TABLE IF NOT EXISTS content_block_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    -- Bound entity type key; NULL = generic template (no entity variable).
    entity_type_key VARCHAR(64),
    mode VARCHAR(16) NOT NULL DEFAULT 'single' CHECK (mode IN ('single', 'list')),
    -- List mode only: cap on how many records a using block may bind/query.
    max_records INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_block_templates_entity_type
    ON content_block_templates (entity_type_key);

-- Reuse the shared updated_at trigger function (defined in the base schema).
DROP TRIGGER IF EXISTS trg_content_block_templates_updated_at ON content_block_templates;
CREATE TRIGGER trg_content_block_templates_updated_at
    BEFORE UPDATE ON content_block_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Block storage — mirrors mail_template_blocks exactly so the same
-- BlockEditor + BlockRenderer + populateBlockStyles machinery works against it.
CREATE TABLE IF NOT EXISTS content_block_template_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES content_block_templates(id) ON DELETE CASCADE,
    parent_block_id UUID NULL REFERENCES content_block_template_blocks(id) ON DELETE CASCADE,
    block_type block_type NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    style JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_content_block_template_blocks_template
    ON content_block_template_blocks (template_id, position);
