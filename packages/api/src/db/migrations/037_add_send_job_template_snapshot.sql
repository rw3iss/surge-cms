-- @feature mailing_lists

-- Capture the source template's name + an "was modified relative to
-- the template" flag at send time so the job detail page can show
-- "Template Name" or "Template Name (custom)" even if the template
-- is later edited or deleted.
ALTER TABLE mail_send_jobs
    ADD COLUMN IF NOT EXISTS template_name_snapshot TEXT NULL;

ALTER TABLE mail_send_jobs
    ADD COLUMN IF NOT EXISTS template_was_modified BOOLEAN NOT NULL DEFAULT FALSE;
