-- How a LIST-mode content-block template renders its records:
-- 'each' (default, unchanged behaviour) = once per record;
-- 'once' = one render with every record bound (plural var), singular = first.
ALTER TABLE content_block_templates
    ADD COLUMN IF NOT EXISTS list_render TEXT NOT NULL DEFAULT 'each';
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'content_block_templates_list_render_check'
    ) THEN
        ALTER TABLE content_block_templates
            ADD CONSTRAINT content_block_templates_list_render_check CHECK (list_render IN ('each', 'once'));
    END IF;
END $$;
