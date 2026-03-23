-- Consolidate style_template_id + style_custom into a single 'style' JSONB column
-- Style holds either { id: "<template-uuid>" } for a template reference,
-- or { backgroundColor: "#fff", padding: "10px", ... } for custom inline styles.

-- Blocks table
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS style JSONB;

-- Migrate existing data
UPDATE blocks SET style = jsonb_build_object('id', style_template_id::text)
WHERE style_template_id IS NOT NULL AND style IS NULL;

UPDATE blocks SET style = style_custom
WHERE style_custom IS NOT NULL AND style IS NULL;

-- Post content blocks table
ALTER TABLE post_content_blocks ADD COLUMN IF NOT EXISTS style JSONB;

UPDATE post_content_blocks SET style = jsonb_build_object('id', style_template_id::text)
WHERE style_template_id IS NOT NULL AND style IS NULL;

UPDATE post_content_blocks SET style = style_custom
WHERE style_custom IS NOT NULL AND style IS NULL;
