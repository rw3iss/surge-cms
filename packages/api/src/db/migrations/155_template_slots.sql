-- Template slots: data inputs a content-block template (entity template or
-- global component) declares and the USING entity block fills
-- (EntityBlockSettings.slots). Array of TemplateSlot, validated by the API.
ALTER TABLE content_block_templates
    ADD COLUMN IF NOT EXISTS slots JSONB NOT NULL DEFAULT '[]'::jsonb;
