-- Contributors: posts that wait for review. `pending_review` = submitted by a
-- user whose `posts:publish` grant is in `approval` mode; a reviewer approves
-- (→ published) or returns it with a note (→ draft).
ALTER TYPE post_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS review_note TEXT;

-- The contributor role may "publish" only with approval (= Submit for review).
INSERT INTO permission_grants (permission_key, subject_type, subject_id, granted, mode)
SELECT 'posts:publish', 'role', 'contributor', true, 'approval'
 WHERE EXISTS (SELECT 1 FROM permissions WHERE key = 'posts:publish')
   AND EXISTS (SELECT 1 FROM roles WHERE key = 'contributor')
ON CONFLICT (permission_key, subject_type, subject_id) DO NOTHING;
