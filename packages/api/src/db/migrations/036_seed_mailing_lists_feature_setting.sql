-- @feature mailing_lists
-- Idempotent: the route flips this to true after the install transaction.
INSERT INTO site_settings (key, value)
VALUES ('mailing_lists_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
