# Reply tracking

Every reply or message sent from the admin (campaign donations, form
submissions, users) is stored in `replies` (migration 138). Migration 139
adds what happened **after** the send:

| Signal | How | Reliability |
|---|---|---|
| Delivered / delayed / bounced / marked as spam / rejected | Amazon SES event publishing → SNS → `POST /api/v1/mail-events/ses/:token` | Exact (from the mail system) |
| Opened | 1×1 image `GET /api/v1/mail-events/o/<replyId>.<sig>.gif` | **Approximate.** Apple Mail Privacy Protection opens mail automatically; image blocking hides real opens. |
| Link clicked | links rewritten to `GET /api/v1/mail-events/c/<replyId>.<sig>?u=<url>` (302) | Good. The signature covers the URL, so the redirect cannot be used elsewhere. |

Settings: **Settings → General → Reply Tracking** (`reply_tracking` keyed row;
`GET/PUT /api/v1/mail-events/settings`, `POST …/settings/rotate`; SDK
`cms.replies.trackingSettings / updateTrackingSettings / rotateTrackingWebhook`;
permissions `settings:read` / `settings:write`). Each switch applies to replies
sent from then on.

## Matching an SES event to a reply

1. The `reply_id` message tag (`X-SES-MESSAGE-TAGS`, sent when delivery reports are on).
2. Else the `Message-ID` header we sent (`replies.message_id`), which SES echoes in
   `mail.commonHeaders.messageId` — this works through a Mail Manager relay too.

Events are stored in `reply_events` (deduplicated on the SNS `MessageId`).
The reply's roll-up columns (`delivery`, `delivered_at`, `open_count`, …) feed the
table status: Failed → Bounced / Marked as spam / Rejected → Opened → Delivered →
Delayed → Sent.

## Webhook security

All three are required:

1. the path token (constant-time compare; **New URL…** rotates it);
2. the SNS signature (SignatureVersion 1 or 2), against a certificate from an
   `https://sns.<region>.amazonaws.com/…pem` URL;
3. the topic — the first topic that confirms a subscription is pinned; other topics
   are refused until the token is rotated.

The `SubscriptionConfirmation` is confirmed automatically.

## AWS setup

1. SNS: create a Standard topic in the SES region.
2. Subscribe it: protocol HTTPS, endpoint = the webhook URL from the settings card.
   The card shows **Confirmed** a few seconds later.
3. SES → Configuration sets: create one (e.g. `replies`) with an Amazon SNS event
   destination → the topic, for Delivery, Bounce, Complaint, Reject, Delivery delay.
   Keep SES open/click tracking off if the site's own open/click switches are on.
4. Enter the configuration set name in the settings card.
   **Mail Manager relay:** let the "Send to internet" role use the configuration set
   (`ses:SendRawEmail` on its ARN), or make it the sending identity's **default
   configuration set** — that applies whatever the relay does with the header.
5. Send a test reply; the card's "Last event" becomes *Delivery*.

The stored reply HTML is the un-instrumented version, so viewing a reply in the
admin never counts as an open.
