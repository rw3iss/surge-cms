-- @feature mailing_lists

CREATE TABLE IF NOT EXISTS mail_send_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES mailing_lists(id),
    template_id UUID NULL REFERENCES mail_templates(id) ON DELETE SET NULL,
    -- Snapshots taken at send time so editing the template later
    -- doesn't change emails already sent or queued.
    subject TEXT NOT NULL,
    preheader TEXT,
    from_name TEXT,
    from_email TEXT,
    reply_to TEXT,
    rendered_html_template TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    total_recipients INT NOT NULL DEFAULT 0,
    sent_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_status ON mail_send_jobs (status);
CREATE INDEX IF NOT EXISTS idx_mail_send_jobs_list ON mail_send_jobs (list_id, created_at DESC);
