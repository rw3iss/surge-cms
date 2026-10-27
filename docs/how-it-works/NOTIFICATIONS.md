# Notifications — email, SMS, in-app and desktop

One system for every alert the site raises (new order, content submission,
membership application, comment…). Each notification TYPE (`NOTIFICATION_TYPES`
in `@sitesurge/types`) is delivered on the CHANNELS an admin turns on for it in
**Settings → Notifications**.

## Channels per type (`notifications` settings row)

| Channel | Recipients | Notes |
|---|---|---|
| `email` | addresses | As before; a type with a mail purpose renders through its template. |
| `sms` | phone numbers (E.164, `+12155550123`) | Needs an SMS provider (Settings → Notifications → SMS provider: **Twilio**; AWS SNS later). The text is the title + a link. |
| `inApp` | chosen **users** + every user holding a chosen **role** (main or additional) | Needs the global switch **Show notifications in the admin** (`notification_options.inAppEnabled`). Recipients need admin access (staff, or a role admin shell such as contributor) to see them. |
| `push` (desktop) | the in-app recipients | Each user turns desktop notifications on per browser (switch in their Notifications panel / page → browser permission → Web Push subscription). |

`notify(type, message)` (`services/notifications/index.ts`) dispatches to all of
them and never throws. A message carries `subject` + `html`/`text` (email) and a
short form — `title`, `body`, `url` (the target) — used by in-app, desktop and
SMS; `buildNotification` fills the short form (title, intro, first link).
**Send test** per type: `POST /api/v1/notifications/test { type }`.

## In-app notifications

- Table `user_notifications` (migration 195): one row per recipient — type, title, body, url, read_at, cleared_at.
- Admin sidebar: **Notifications** (bell + unread badge, above the online users) opens a panel upward: latest items, mark all read, clear, **View all** → `/admin/notifications` (every admin-shell user; only their own). Clicking an item marks it read and opens its target.
- The unread count is polled (60 s, and on focus) — the admin WebSocket is staff-only, polling works for every role.
- API (`notifications:self`, members+): `GET /notifications/me[?unread=1&type=&page=]`, `GET /me/count`, `POST /me/read {ids|all}`, `POST /me/clear {ids|all}`. SDK `cms.notifications.*`.
- Retention: cleared rows go after 7 days, everything after **Keep notifications for N days** (default 90) — daily `notifications-sweep` cron.

## Desktop notifications (Web Push)

- `user_push_subscriptions` (one row per browser). `GET /notifications/me/push` (VAPID public key + count), `POST /me/push/subscribe|unsubscribe`.
- VAPID keys: env `WEB_PUSH_PUBLIC_KEY`/`WEB_PUSH_PRIVATE_KEY`/`WEB_PUSH_SUBJECT` win; otherwise generated once and stored (`web_push_keys`). Uses the `web-push` package.
- The browser side is `public/push-sw.js`, imported into the PWA service worker (`importScripts`): shows the notification and opens its URL on click. Gone subscriptions (404/410) are pruned.

## SMS

`sms_settings` (token masked): provider `twilio`, Account SID (`AC…`), auth token, From (a number or a Messaging Service SID `MG…`). Sent with Twilio's REST API (`services/notifications/sms.ts`, `SmsProvider` interface — add AWS SNS as another provider). `POST /notifications/sms/test { to }`.

## Permissions

`notifications:self` — own in-app notifications + desktop subscriptions (members+). `notifications:manage` — options, SMS provider, tests (admin). Per-type channel config is saved with the other settings (`PUT /settings { notifications }`).
