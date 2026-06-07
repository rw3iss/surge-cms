-- Block style templates table
CREATE TABLE IF NOT EXISTS block_styles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    is_default BOOLEAN DEFAULT false,
    background_color VARCHAR(20),
    text_color VARCHAR(20),
    font_size VARCHAR(20),
    padding VARCHAR(100),
    margin VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_block_styles_name ON block_styles(name);
CREATE INDEX IF NOT EXISTS idx_block_styles_default ON block_styles(is_default) WHERE is_default = true;

-- Add style reference to blocks table
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS style_template_id UUID REFERENCES block_styles(id) ON DELETE SET NULL;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS style_custom JSONB;

-- Add style reference to post_content_blocks table
ALTER TABLE post_content_blocks ADD COLUMN IF NOT EXISTS style_template_id UUID REFERENCES block_styles(id) ON DELETE SET NULL;
ALTER TABLE post_content_blocks ADD COLUMN IF NOT EXISTS style_custom JSONB;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_block_styles_updated_at ON block_styles;
CREATE TRIGGER update_block_styles_updated_at BEFORE UPDATE ON block_styles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed default style
INSERT INTO block_styles (name, is_default, background_color, text_color, font_size, padding, margin)
VALUES ('Default', true, null, null, null, null, null)
ON CONFLICT (name) DO NOTHING;
