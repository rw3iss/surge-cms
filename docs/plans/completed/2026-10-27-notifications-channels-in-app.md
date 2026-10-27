# Notifications: channels (email, SMS, desktop push) + in-app notifications — plan

> **STATUS 2026-10-27 — DONE.** All phases built, deployed and checked on production (in-app test notification → badge, panel, page, read, clear; VAPID keys generated; settings restored). Not verified live: a real desktop push in a browser and a real Twilio SMS (needs a Twilio account).

## Decisions
1. In-app recipients: chosen **users and roles** (main or additional role).
2. Desktop push goes to the **in-app recipients** (no separate list); each user turns desktop notifications on/off per browser themselves (a switch in their notifications panel → browser permission + push subscription). The admin enables "Also send as desktop notification" per type.
3. SMS: **Twilio** first, behind a provider interface (AWS SNS later).

## Model
`notifications` settings row: per type `{ email: {enabled, addresses}, sms: {enabled, addresses (phone numbers)}, inApp: {enabled, userIds, roles}, push: {enabled} }` (back-compatible: existing email configs keep working). Global options row `notification_options`: `{ inAppEnabled, retentionDays }`. SMS provider row `sms_settings`: `{ provider: 'twilio', accountSid, authToken (masked), fromNumber }`.

`NotificationMessage` gains `title`, `body`, `url` (the target). `buildNotification` fills them (title, intro, first link).

## Tables (migration 195, core)
- `user_notifications` (id, user_id, type, title, body, url, read_at, cleared_at, created_at).
- `user_push_subscriptions` (id, user_id, endpoint UNIQUE, p256dh, auth, user_agent, created_at).
- VAPID keys: env `WEB_PUSH_*` wins; else generated once and stored (`web_push_keys`).

## Phases
1. Model + message shape + channels (inApp, push, sms) in `services/notifications/` — DONE when every channel delivers.
2. In-app API `/api/v1/notifications/me…` (list, count, read, clear, push subscribe) + options + SMS settings/test; SDK `cms.notifications`.
3. Admin UI: Settings → Notifications (in-app switch + retention; per type: email, SMS, in-app users/roles picker, desktop switch; SMS provider card).
4. Admin shell: sidebar Notifications item (badge, upward panel, mark read, clear, View all, desktop switch) + `/admin/notifications` page; `push-sw.js` service-worker handlers.
5. Retention cron, docs, tests, deploy.
