-- @feature gallery
-- Gallery collections (one level — collections never nest) + a role /
-- subscription-level access rule on collections AND items. A rule is ACTIVE
-- when access_enabled AND (roles or tiers chosen); an active rule replaces the
-- item's visibility floor. Deleting a collection is done by the service (its
-- items are removed / moved in the same transaction); the FK's SET NULL is the
-- safety net that drops items to the gallery root.

CREATE TABLE IF NOT EXISTS gallery_collections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL DEFAULT 'Untitled',
    description     TEXT NOT NULL DEFAULT '',
    sort_order      INT NOT NULL DEFAULT 0,
    access_enabled  BOOLEAN NOT NULL DEFAULT false,
    access_roles    TEXT[] NOT NULL DEFAULT '{}',
    access_tier_ids UUID[] NOT NULL DEFAULT '{}',
    created_by      UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS collection_id UUID NULL REFERENCES gallery_collections(id) ON DELETE SET NULL;
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS access_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS access_roles TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS access_tier_ids UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS gallery_items_collection_idx ON gallery_items (collection_id);
