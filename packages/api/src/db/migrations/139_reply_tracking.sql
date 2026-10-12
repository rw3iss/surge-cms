-- Reply tracking, part 2: what happened AFTER the relay accepted a reply.
--   delivery / bounce / complaint / delay / reject — SES event publishing → SNS → /api/v1/mail-events/ses/:token
--   open  — a 1×1 image in the reply (approximate)
--   click — links sent through a recording redirect
-- message_id is the Message-ID header we sent; SES echoes it in every event
-- (mail.commonHeaders.messageId), so it matches even through Mail Manager.

ALTER TABLE replies
    ADD COLUMN IF NOT EXISTS message_id      TEXT,
    ADD COLUMN IF NOT EXISTS delivery        TEXT CHECK (delivery IN ('delivered','delayed','bounced','complained','rejected')),
    ADD COLUMN IF NOT EXISTS delivery_detail TEXT,
    ADD COLUMN IF NOT EXISTS delivered_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS open_count      INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS first_opened_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_opened_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS click_count     INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_replies_message_id ON replies (message_id) WHERE message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reply_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reply_id    UUID NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('send','delivery','delay','bounce','complaint','reject','open','click')),
    via         TEXT NOT NULL CHECK (via IN ('ses','pixel','link')),
    detail      TEXT,
    -- SNS MessageId: SNS retries a delivery it thinks failed, so the same
    -- event can arrive twice. Unique → the second is ignored.
    external_id TEXT UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_events_reply ON reply_events (reply_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reply_events_ses ON reply_events (created_at DESC) WHERE via = 'ses';
