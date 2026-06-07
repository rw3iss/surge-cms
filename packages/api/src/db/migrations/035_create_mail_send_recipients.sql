-- @feature mailing_lists

CREATE TABLE IF NOT EXISTS mail_send_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES mail_send_jobs(id) ON DELETE CASCADE,
    -- subscriber_id is nullable so the row survives a subscriber
    -- delete — the email + status remain for audit.
    subscriber_id UUID NULL REFERENCES mailing_list_subscribers(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    error TEXT,
    sent_at TIMESTAMPTZ,
    attempt_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mail_send_recipients_job_status
    ON mail_send_recipients (job_id, status);
CREATE INDEX IF NOT EXISTS idx_mail_send_recipients_subscriber
    ON mail_send_recipients (subscriber_id);
