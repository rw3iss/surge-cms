-- Component collections: folders for organising components on /admin/components.
-- Organisation only — rendering never reads them. A component belongs to at
-- most one; "[None]" is collection_id IS NULL (not a row). Deleting a collection
-- through the API either detaches its components (SET NULL, the FK default here)
-- or deletes them first, in one transaction.
CREATE TABLE IF NOT EXISTS component_collections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE content_block_templates
    ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES component_collections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_content_block_templates_collection
    ON content_block_templates (collection_id) WHERE collection_id IS NOT NULL;
