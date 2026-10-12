-- @feature gallery
-- Gallery: media published for visitors. One item per media (1:1). Deleting
-- the media leaves the item with media_id NULL — hidden from the public until
-- an editor removes it; deleting the item never touches the media.

CREATE TABLE IF NOT EXISTS gallery_items (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id           UUID REFERENCES media(id) ON DELETE SET NULL,
    title              TEXT,
    caption            TEXT,
    tags               TEXT[] NOT NULL DEFAULT '{}',
    sort_order         INT NOT NULL DEFAULT 0,
    visibility         TEXT NOT NULL DEFAULT 'inherit' CHECK (visibility IN ('inherit','public','members','tier')),
    min_tier_id        UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,
    comments           TEXT NOT NULL DEFAULT 'inherit' CHECK (comments IN ('inherit','on','off')),
    anonymous_comments TEXT NOT NULL DEFAULT 'inherit' CHECK (anonymous_comments IN ('inherit','on','off')),
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1:1 with media (NULLs — orphaned items — are not unique-checked).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gallery_items_media ON gallery_items (media_id) WHERE media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gallery_items_order ON gallery_items (sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_items_tags ON gallery_items USING GIN (tags);
