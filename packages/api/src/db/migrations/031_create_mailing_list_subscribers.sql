-- @feature mailing_lists

CREATE TABLE IF NOT EXISTS mailing_list_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES mailing_lists(id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    -- email is denormalized: cheap send-time lookups + survives user delete.
    email TEXT NOT NULL,
    name TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'subscribed'
        CHECK (status IN ('subscribed', 'pending_confirmation', 'unsubscribed', 'bounced', 'complained')),
    confirmation_token TEXT,
    unsubscribe_token TEXT NOT NULL,
    custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    unsubscribed_at TIMESTAMPTZ,
    last_send_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailing_list_subscribers_unique_email
    ON mailing_list_subscribers (list_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_mailing_list_subscribers_user
    ON mailing_list_subscribers (user_id);
CREATE INDEX IF NOT EXISTS idx_mailing_list_subscribers_status
    ON mailing_list_subscribers (status);
CREATE INDEX IF NOT EXISTS idx_mailing_list_subscribers_unsub_token
    ON mailing_list_subscribers (unsubscribe_token);
