# Improvement audit 2026-11-06 — Notifications + Forum block

Scope: notifications backend (`services/notifications/**`, `routes/notifications.ts`), Web Push service worker (`public/push-sw.js`), admin notifications UI (sidebar widget, `/admin/notifications`, Settings → Notifications, desktop switch, user/role picker, `stores/notifications.ts`); forum block (`components/forum/**`, `services/forum/**` feed / render / notify) and the two guides. Commits since f28ea8ae: 6e36540e, e52b0047, 08f5cfeb, f42d11f8, 6225f3d6, a040eb89.

| Status | Count |
|---|---|
| Applied (A + B) | 22 |
| Planned (documented) | 2 |
| Verified, no change | 1 |
| Lead follow-up | 2 |
| Migrations used | none (208–209 not needed) |

## Findings

| # | Title | Location | Problem | Fix | Risk | Status |
|---|-------|----------|---------|-----|------|--------|
| 1 | One bad in-app recipient id lost the alert for everyone | `api/src/services/notifications/inApp.ts` `recipientsFor` | `id = ANY($1::uuid[])` with a non-UUID id (stale / hand-edited settings) throws on the cast → `notify()` logs and NOBODY gets the in-app row or desktop push. | Filter ids through `isUuid`, de-duplicate ids and roles. Test `inApp.test.ts`. | A | applied |
| 2 | Push endpoint = server-side request to any https URL | `services/notifications/push.ts` `subscribe` | Any signed-in user with `notifications:self` could register `https://10.0.0.5/…` / `https://localhost/…`; every alert then made our server POST there (SSRF). | `pushEndpointProblem()`: https only, no IP literals, no localhost / `.local` / `.internal` / single-label hosts, no credentials, port 443 only. Test `push.test.ts`. | B | applied |
| 3 | Unbounded subscriptions per user | `push.ts` `subscribe` | One account could register any number of endpoints; each alert fans out to all of them. | Keep the newest 10 per user (`MAX_SUBSCRIPTIONS_PER_USER`), oldest dropped on subscribe. | A | applied |
| 4 | Pushes sent one by one | `push.ts` `sendTo` | Sequential `await` per browser; a slow push service delayed the whole fan-out (and `notify()` callers awaiting it). Prune ran a DELETE per gone endpoint. | 8 at a time (`eachLimited`); gone endpoints deleted in one statement; 401/403 logged with the push host (VAPID key change hint). | A | applied |
| 5 | Second alert of a type was silent | `public/push-sw.js` | `tag` = the type, without `renotify` a new alert of the same type replaced the old one with no sound / popup. | `renotify: Boolean(tag)`. | A | applied |
| 6 | Notification click navigated an open admin tab away | `push-sw.js` `notificationclick` | With no tab on the exact URL, ANY same-origin tab was navigated to the target — losing unsaved work in a page / post editor open there. | Focus a tab already on the URL, else `openWindow`. | A | applied |
| 7 | Desktop switch "on" but nothing arrives | `cms/src/components/admin/notifications/NotificationDesktopToggle.tsx` | The switch read only the browser's subscription. The server row could be gone (pruned 410, another account on the same browser took the endpoint over — `ON CONFLICT` moves it), or made with an old VAPID key (env keys changed → every send 403). | On mount: re-send the subscription (upsert); a subscription with a different `applicationServerKey` is replaced (also in `enable`). Errors on mount no longer leave an unhandled rejection. | B | applied |
| 8 | Shared browser keeps the previous user's alerts | `stores/notifications.ts` | Signing out leaves the server subscription on the old account. | `releaseDesktopNotifications()` added (removes this browser's subscription server-side, best effort). Needs a call from logout — see Lead follow-up. | B | applied (helper) / follow-up |
| 9 | "Send test" said "sent" when nobody receives it | `api/src/routes/notifications.ts` `/test` | With no saved recipients `notify()` is a no-op, but the admin got a success toast. | 400 "No saved recipients … save first" when `hasRecipients()` is false. | A | applied |
| 10 | Test SMS failure = generic 500 | `routes/notifications.ts` `/sms/test` | A Twilio refusal (bad token, unverified number) threw a plain `Error` → "Internal server error"; the admin could not see what to fix. | Wrapped as `ValidationError("The test SMS failed: Twilio 401: …")`. | A | applied |
| 11 | Unread polling re-downloaded the open list every minute | `cms/src/stores/notifications.ts` | `version` bumped on every poll → widget panel + `/admin/notifications` re-fetched their list every 60 s even with nothing new; window `focus` + `visibilitychange` fired two count requests at once. | `version` moves only when unread/enabled CHANGED or `force` (after the user's read / clear); calls within 2 s share one request. Page no longer refetches twice after an action. | A | applied |
| 12 | Widget: no click-outside, focus lost on close | `NotificationWidget.tsx` | Panel stayed open over the sidebar until × / Escape; Escape left focus nowhere; opening did not move focus; rows ignored Space; the × buttons were all named "Clear". | Click outside closes; Escape / × return focus to the bell; opening focuses the panel (`tabindex=-1`, no ring); Enter + Space act; `aria-controls`; "Clear: <title>" labels. Same Enter/Space handling on `/admin/notifications`. | A | applied |
| 13 | Settings could overwrite retention with a wrong default | `pages/admin/settings/NotificationsPanel.tsx` | Local default `retentionDays: 30` (server default 90); when `GET /notifications/options` failed, Save wrote `{ inAppEnabled:false, retentionDays:30 }` over the stored options. | Default 90; options are saved only when they were loaded. | A | applied |
| 14 | Bad email recipients saved silently | `NotificationTypeCard.tsx` / `NotificationsPanel.tsx` | Phone lists were validated, email lists not — a typo address bounced every alert. | `emailListError` on the field (`CommitInput validate`) and before Save. | A | applied |
| 15 | User search race | `UserRolePicker.tsx` | A slow answer for an earlier query could replace the hits of the latest one. | Sequence number; only the latest search writes. | A | applied |
| 16 | Forum: failed load = blank widget on the site | `cms/src/components/forum/ForumWidget.tsx` | A network/5xx failure rendered NOTHING for visitors (only the admin saw a message) and also stopped live polling for good (`live = … && !error`). | Visitor card "The discussion could not be loaded" + **Try again**; polling continues on non-401/403 errors and the first good poll heals the widget (`refresh` clears the error). | B | applied |
| 17 | Forum: failed "Load more" erased the list | `forumHooks.ts` `loadMore` | It set the widget-level `error` → the whole list was replaced by the error state. | Separate `moreError` shown under the button (which reads "Try again"); rows stay. | A | applied |
| 18 | Forum: stuck "loading" when a poll overtook the first load | `forumHooks.ts` `refresh` | `refresh` bumps `seq`, so the in-flight `load` dropped its answer AND skipped `setLoading(false)/setLoaded(true)` → skeleton forever (and chat-order never scrolled to the end). | A committed refresh also ends loading / marks loaded. | A | applied |
| 19 | Forum thread mode: empty box, stale lock, double "Load earlier" | `ForumThreadView.tsx` | Missing / hidden / unreadable thread rendered nothing on the site; a lock or move never reached an open chat (only replies were polled); "Load earlier" had no busy state; an old load error stayed after later successes. | "This discussion is not available." (admin: why); every 3rd poll also re-reads the feed; busy state; errors cleared on success. | A | applied |
| 20 | Forum list mode: open replies never updated; "Show more" double-load | `ForumReplies.tsx` | Polling refreshed the thread cards but not an open reply list; "Show more replies" could fire twice. | Reload when the polled `replyCount` grows; busy state; error cleared on success. | A | applied |
| 21 | Inline composer stopped typing at the limit silently | `ForumComposer.tsx` | `maxlength` cut input with no count in the inline (chat) variant. | Count shown past 90 % (`forum-composer__count`), shared `nearLimit()`. | A | applied |
| 22 | Reply email: "Someone replied" for guests | `api/src/services/forum/notify.ts` | `nameOf(null)` for a guest reply. | Use the reply's `guest_name`, else "A guest". | A | applied |
| 23 | Signed-in feed polling cost | `services/forum/feed.ts` | Anonymous feeds are cached 30 s, but every signed-in poll recomputes (~8 queries: settings, levels, threads, count, access, openings, last repliers, reactions). 200 signed-in viewers at 10 s ≈ 160 queries/s. | Plan: split the response into a shared part (threads, counts, openings — cached per readable-category set + query hash) and a small per-viewer overlay (own pending threads, `myReactions`, rights); or `?since=<lastActivity>` returning 304-style "unchanged". Contained to feed.ts + the hook, but needs load measurement first. | C | planned |
| 24 | No staff alert for held forum REPLIES | `services/forum/notify.ts` | `forum_thread_created` covers held threads; a held reply (guest, approve-until) reaches the moderation queue without any notification. | Add `forum_reply_pending` notification type (shared `NOTIFICATION_TYPES` registry) and send it from `notifyStaff` for `created && pending && !is_opening`. Touches the shared type registry + the Settings card list. | B | planned |
| 25 | Push not tied to the in-app global switch in the UI copy | `NotificationTypeCard.tsx` | Desktop push is sent only to IN-APP recipients and only while in-app is on globally; the card already hides it under in-app, so behavior is clear. | none | — | verified, no change |

## Verified / no change needed

- `notify()` never throws: every channel is wrapped; `sendTo` / `sendSms` catch internally; `notifyWith` catches the builder.
- Recipient resolution: users ∪ main-role ∪ extra-role holders, active + not banned, one row per user (SQL `IN` de-duplicates; ids now de-duplicated before the query).
- SMS secret: masked on read (`SECRET_MASK`), an echoed mask keeps the stored token, the token input is never pre-filled with the real value.
- VAPID: env wins; generated keys insert-only (`ON CONFLICT DO NOTHING`) so two workers keep one pair.
- Retention sweep: cleared rows after 7 days, all after `retentionDays` (1–3650, validated server-side), daily cron.
- Unread count query is index-backed (`idx_user_notifications_unread` partial index).
- `/forum/feed`: categories the viewer cannot read are dropped in SQL; every thread then passes the `forum_thread` target's `accessMany`; own pending threads only for the author; anonymous results cached 30 s and dropped by any discussion write.
- Anonymous posting: setting + `forum:post_anonymous` checked in `createThread` and in `postTargetFor`; guests held by default (`anonymousApproval`), >2 links held, honeypot answers a fake pending thread, `checkWriteRate` per user / IP.
- Forum block settings are normalized (`normalizeForumBlockSettings`): alignments are enums, `listMaxHeight` passes `cssLen`, `refreshSeconds` clamped 10–300 — so the SSR / email `style=` interpolations and the `--forum-list-max-height` variable cannot inject.
- Forum `bodyHtml` (`innerHTML`) comes from the server's `renderMarkdown` (escapes first).
- SSR / email forum output is escaped (`escapeHtml`) and absolute in email.

## Lead follow-up

1. **Sign-out releases desktop alerts** — `packages/cms/src/stores/auth.tsx`, in `logout()` BEFORE the logout request:
   ```ts
   const { releaseDesktopNotifications, } = await import('./notifications');
   await releaseDesktopNotifications();
   ```
   (dynamic import keeps the notifications store out of the public bundle's eager path; it never throws.)
2. **CLAUDE.md, Notifications bullet** — append: "Push endpoints must be https on a public host (`pushEndpointProblem`), ≤ 10 per user; the SW never navigates an open tab away; the desktop switch re-sends its subscription on mount and replaces one made with an old VAPID key; `/test` refuses a type with no saved recipients." Forum block bullet — append: "Site widget: a failed feed shows Try again and polling self-heals; a failed Load more keeps the rows; thread mode re-reads the thread every 3rd poll."

## Verification

- `cd packages/api && npx tsc --noEmit -p .` → no errors.
- `cd packages/api && npx vitest run src/services/notifications src/services/forum` → 9 files, 56 tests passed (new: `push.test.ts`, `inApp.test.ts`).
- `cd packages/cms && npx tsc --noEmit -p .` → no errors outside the known SocialBlock / CampaignDonations / FormSubmissions set.
- `cd packages/cms && npx vitest run --config ../../config/cms/vitest.config.ts src/components/forum src/components/admin/notifications` → 1 file, 21 tests passed.
- Not verified in a browser: the widget focus / click-outside behavior, the service-worker click + `renotify`, and the VAPID-key resubscribe path (needs a real push service). `packages/shared` was not changed.
