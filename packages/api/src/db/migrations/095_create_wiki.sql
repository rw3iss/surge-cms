-- @feature wiki
-- Wiki pages: markdown documents in a tree, with full-text search.

CREATE TABLE IF NOT EXISTS wiki_pages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       VARCHAR(255) NOT NULL,
    -- Optional: a page is reachable by id when it has no slug, so an author is
    -- never blocked from saving by a slug collision.
    slug        VARCHAR(255) UNIQUE,
    content     TEXT NOT NULL DEFAULT '',
    tags        TEXT[] NOT NULL DEFAULT '{}',
    categories  TEXT[] NOT NULL DEFAULT '{}',
    -- Self-reference for the tree. ON DELETE SET NULL so deleting a parent
    -- leaves its children as roots rather than destroying them; the admin
    -- chooses cascade explicitly when they want the subtree gone.
    parent_id   UUID REFERENCES wiki_pages(id) ON DELETE SET NULL,
    -- Roles allowed to VIEW. Empty = everyone, which is the default: a wiki
    -- that is private by accident is worse than one that is public on purpose.
    view_roles  TEXT[] NOT NULL DEFAULT '{}',
    status      VARCHAR(16) NOT NULL DEFAULT 'published',
    position    INTEGER NOT NULL DEFAULT 0,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wiki_pages_status_chk CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_wiki_pages_parent ON wiki_pages (parent_id);
CREATE INDEX IF NOT EXISTS idx_wiki_pages_slug ON wiki_pages (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wiki_pages_status ON wiki_pages (status);

-- Full-text search over title + content. A generated column so it can never
-- drift from the row it describes, and a GIN index so ts_rank scoring is cheap.
-- Title is weighted 'A' and body 'B', which is what makes a title hit outrank a
-- passing mention in a long page.
ALTER TABLE wiki_pages
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'B')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_wiki_pages_search ON wiki_pages USING GIN (search_vector);

-- Trigram index for the "loose" fallback: ts queries miss partial words and
-- typos, which is most of what people actually type into a wiki search box.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_wiki_pages_title_trgm ON wiki_pages USING GIN (title gin_trgm_ops);

CREATE OR REPLACE FUNCTION wiki_pages_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wiki_pages_updated ON wiki_pages;
CREATE TRIGGER trg_wiki_pages_updated BEFORE UPDATE ON wiki_pages
    FOR EACH ROW EXECUTE FUNCTION wiki_pages_touch_updated_at();
