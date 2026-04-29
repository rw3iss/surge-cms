-- Font manager: per-site uploaded font assets.
--
-- Files live on disk under {upload.dir}/fonts/{file_name}; this table
-- tracks the metadata. `custom_id` is the operator-friendly handle
-- ("font1", "brand-headline", etc.) used by font-family settings
-- elsewhere in the CMS so the underlying file can be swapped without
-- breaking references. Defaults to font{N} if the operator doesn't
-- supply one.

CREATE TABLE IF NOT EXISTS fonts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    custom_id VARCHAR(64) NOT NULL UNIQUE,
    original_name VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    format VARCHAR(20) NOT NULL,
    size_bytes INTEGER NOT NULL,
    -- Display label set by the operator; falls back to the original
    -- filename if blank. Distinct from `custom_id` so the operator
    -- can rename a font without breaking references.
    family_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fonts_custom_id ON fonts(custom_id);
CREATE INDEX IF NOT EXISTS idx_fonts_created_at ON fonts(created_at DESC);

-- Standard updated_at trigger (mirrors other tables).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_fonts_updated_at') THEN
        CREATE TRIGGER update_fonts_updated_at
            BEFORE UPDATE ON fonts
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;
