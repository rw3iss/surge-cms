-- @feature mailing_lists

-- Sent-mail archive.
--
-- template_version: the mail_template revision a job was sent with (pinned in
--   `revisions`), so the job page / archive can name and reopen the exact
--   version. NULL for jobs sent before this existed, or without a template.
-- public_archive: per list, whether its sent mails are listed at /mail and
--   viewable by anyone. Off by default — a personalised "view in browser" link
--   (signed per-recipient token) works either way.
ALTER TABLE mail_send_jobs ADD COLUMN IF NOT EXISTS template_version INTEGER;
ALTER TABLE mailing_lists ADD COLUMN IF NOT EXISTS public_archive BOOLEAN NOT NULL DEFAULT false;
