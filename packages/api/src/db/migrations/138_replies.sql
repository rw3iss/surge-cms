-- Replies sent from the admin ("Reply" on a donation, a form submission, a
-- user). Every attempt is recorded — sent or failed — with what was typed and
-- the exact email that went out, so the tables can show "View reply (n)".
-- Core table: the sources live in several features, and history must survive
-- a feature being switched off and on.
CREATE TABLE IF NOT EXISTS replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(32) NOT NULL,                 -- donation | submission | user
    subject_id UUID NOT NULL,                    -- the donation / submission / user id
    ref JSONB NOT NULL DEFAULT '{}'::jsonb,      -- the full ref the reply was made with
    recipient_email VARCHAR(255) NOT NULL,
    recipient_name VARCHAR(255),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    body_html TEXT NOT NULL,
    template_id UUID,
    from_name VARCHAR(255),
    from_email VARCHAR(255),
    status VARCHAR(12) NOT NULL,                 -- sent | failed
    error TEXT,
    sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS replies_subject ON replies (source, subject_id, created_at DESC);
