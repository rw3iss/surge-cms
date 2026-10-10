-- @feature forum

-- Forum: categories and threads. A thread's opening post and its replies are
-- rows in `comments` (target_type = 'forum_thread'), so editing, reactions,
-- moderation and activity counts are shared with Comments.
CREATE TABLE IF NOT EXISTS forum_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    parent_id UUID REFERENCES forum_categories(id) ON DELETE SET NULL,
    -- Minimum subscription tier RANK to read / post (NULL = the forum default).
    read_min_rank INT,
    post_min_rank INT,
    locked BOOLEAN NOT NULL DEFAULT false,
    thread_count INT NOT NULL DEFAULT 0,
    post_count INT NOT NULL DEFAULT 0,
    last_thread_id UUID,
    last_post_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forum_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
    slug VARCHAR(160) NOT NULL,
    title VARCHAR(200) NOT NULL,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'visible',   -- visible | pending | hidden | deleted
    pinned BOOLEAN NOT NULL DEFAULT false,
    locked BOOLEAN NOT NULL DEFAULT false,
    reply_count INT NOT NULL DEFAULT 0,
    view_count INT NOT NULL DEFAULT 0,
    reaction_count INT NOT NULL DEFAULT 0,
    last_reply_at TIMESTAMPTZ,
    last_reply_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (category_id, slug)
);
CREATE INDEX IF NOT EXISTS forum_threads_category ON forum_threads (category_id, pinned DESC, last_reply_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS forum_threads_recent ON forum_threads (created_at DESC) WHERE status = 'visible';

-- A first category so a fresh forum is usable at once.
INSERT INTO forum_categories (slug, name, description, sort_order)
SELECT 'general', 'General', 'Talk about anything.', 0
 WHERE NOT EXISTS (SELECT 1 FROM forum_categories);
