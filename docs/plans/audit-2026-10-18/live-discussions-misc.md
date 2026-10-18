## live-discussions-misc

**Scope:** live rooms (viewers, moderation, chat, recordings, providers), comments + forum + member pages + discovery, post-type registry/editors, help pages (SDK/API references, RefBrowser, index), admin shell (sidebar, settings panels, header editor), mailing-list signup notice, YouTube OAuth, social sync. Work since 2026-09-25 (`git log --since=2026-09-25`), about 60 commits in this area.

**Method:** I read the code only. I did not run anything in a browser. Line numbers are from `main` at `750f3aa8`.

**Totals:** 41 findings: Phase A 24, Phase B 13, Phase C 4.

Rule compliance in the new code is mostly good. There are no raw checkboxes and no `!important`. The public chat renders as text, not `innerHTML`. The one `innerHTML` use is Markdown output from the escaping renderer. The most important findings are two **security/correctness** items in live shows (S1, S2) and one **broken control** in comments (U1).

---

### Security & correctness

#### S1: Banned or kicked viewers can still chat and react
- **Location:** `packages/api/src/services/liveRooms/server.ts:131-135` (`moderationBlock`), `:160-167` (ticket → identity); `packages/api/src/services/liveRooms/index.ts:40` (`issueTicketFor`); `moderation.ts` `moderationRefusal`.
- **Problem:** bans and kicks are checked only at **socket connect**, and only against the socket's own key. The server authorises commands by the **ticket** in each command, not by the socket. A banned user can:
  1. open the socket with no cookie, which gives an anonymous key `a:<new>` that is not banned (a user ban stores no IP hash);
  2. fetch a ticket with `POST /posts/:id/live/ticket`, which does not check bans;
  3. send `chat` with that ticket.
  
  `moderationBlock` reads the `u:<id>` mod entry, but `moderationRefusal` only acts on `muted` and `silencedUntil`. It ignores `kicked`, and it never checks `live_bans`. So a kicked user can chat in that show, and a banned user can chat in every show.
- **Fix:** in `moderationBlock` (and for `react` / `react_message`), refuse when any key in `keysFor()` has `kicked`, or when `isBanned('u:'+userId)` is true. Use a new `banned` refusal code. Make `issueTicketFor` throw 403 for a banned or kicked user. Add `liveRooms.test.ts` cases for "kicked user + anon socket + ticket → refused".
- **Risk:** low. **Phase:** A.

#### S2: Saving a live post can overwrite server-managed `type_settings`
- **Location:** `packages/api/src/services/posts.ts:269`; `packages/api/src/services/postTypes.ts:57-73` (`resolveTypeSettings`); `packages/cms/src/pages/admin/PostEditor.tsx:135,169,346`.
- **Problem:** the editor loads `typeSettings` once and sends the whole object back on every save and autosave. The server merges `defaults ← existing ← patch`, so the stale copy wins. The server writes these keys **while the editor is open**:
  - `recordingVersions` / `recordingMediaId`: written by `liveRecordings.complete`;
  - `recordingRemovedAt`;
  - `providerInputId`: written at publish, removed at end.
  
  Failure case: the host goes live, ends the show, the recording completes, then the host changes the title and clicks Save. The new recording version disappears from the post, and the shown replay goes back to the previous one. A restored localStorage draft can do the same.
- **Fix:** add a `SERVER_MANAGED_TYPE_SETTINGS` set (per type, e.g. on `PostTypeDefinition.serverKeys` or a constant in `postTypes.ts`). Remove those keys from `patch` in `resolveTypeSettings`, so `existing` always wins for them. Add a unit test.
- **Risk:** medium (data loss today). **Phase:** B.

#### S3: Guest IP hash prefers client-supplied headers
- **Location:** `packages/api/src/services/liveRooms/moderation.ts:50-56` (`ipHashOf`).
- **Problem:** the order is `cf-connecting-ip` → `x-real-ip` → `x-forwarded-for` → socket. nginx sets `X-Real-IP $remote_addr`, and that is the value the CF real-IP config makes trustworthy. A request that reaches the origin directly can set `CF-Connecting-IP` to anything. That evades a guest IP ban, or frames another IP.
- **Fix:** read `x-real-ip` first (the header nginx writes), and fall back to `req.socket.remoteAddress`. Do not read CF or XFF headers directly. This matches `trust proxy 1` in `app.ts:59`.
- **Risk:** low. **Phase:** A.

#### S4: Live moderation is not audited
- **Location:** `packages/api/src/services/liveRooms/index.ts:128`.
- **Problem:** mute, silence, kick, ban and unban are written only to `logger.info`. A ban lasts across every show and is reversible from the admin, but `audit_log` has no record of who banned whom.
- **Fix:** call `logAudit({ action: 'live_' + body.action, entityType: 'post', entityId: postId, newValues: { key, minutes, reason } })`. The route can pass `audit()` the same way the recordings routes do.
- **Risk:** low. **Phase:** A.

#### S5: `moderate()` returns a 500 on a non-UUID user key
- **Location:** `packages/api/src/services/liveRooms/index.ts:83-87`.
- **Problem:** the key regex accepts `u:abc`. The `SELECT role FROM users WHERE id = $1` then throws a pg `22P02` error, which comes back as a 500.
- **Fix:** validate `u:` keys as UUIDs (`/^u:[0-9a-f-]{36}$/i`) and keep the looser rule for `a:` keys.
- **Risk:** low. **Phase:** A.

#### S6: Deleting a recording can delete media still used elsewhere
- **Location:** `packages/api/src/services/liveReplays.ts:103-117` (`deleteVersion`, no reference check at all), `:173-180` (`purgePostMedia`).
- **Problem:** `purgePostMedia` counts references only in `post_content_blocks`, `blocks` and other posts' recording settings. It misses:
  - `gallery_items.media_id` (a recording published to the Gallery);
  - `content_block_template_blocks`;
  - `mail_template_blocks`;
  - entity media fields.
  
  `deleteVersion` calls `media.remove` without any check. Commit `341eca29` added an "in use" guard for the Media library; this path does not use it.
- **Fix:** run both paths through the shared media "in use" check (the same one the library delete uses) and keep any media that is still referenced. In `deleteVersion`, show "Removed from this post — still used by …" instead of deleting the file.
- **Risk:** medium. **Phase:** B.

#### S7: `deleteVersion` can drop a recording that completes at the same time
- **Location:** `packages/api/src/services/liveReplays.ts:81-90,110-114`.
- **Problem:** it reads `recordingVersions`, filters the list in JS, and writes the whole list back with `||`. `liveRecordings.complete` appends with `jsonb_set` (`liveRecordings.ts:326`). If the two run together, the delete writes back a stale list and the version just appended is lost.
- **Fix:** remove the element in SQL, e.g. `jsonb_path_query_array(type_settings->'recordingVersions', '$[*] ? (@.mediaId != $id)')`, in one `UPDATE`. Or do `SELECT … FOR UPDATE` in a transaction.
- **Risk:** low. **Phase:** B.

#### S8: Public subscribe now sends email to any typed address, with no throttle
- **Location:** `packages/api/src/services/mailingLists.ts:229` (`publicSubscribe`) → `services/mail/listSignupNotice.ts:85-108`.
- **Problem:** commit `5c3efcc3` added a "You've been subscribed" email. It is ON by default and goes to every new address from the public form or a form's subscribe action. The only limit is the global API limiter, so a script can send the site's mail to thousands of third-party addresses. That damages SES reputation (bounces and complaints), and it works even with double opt-in off.
- **Fix:**
  - Add per-IP and per-address limits on `publicSubscribe` (reuse `discussions/spam.rateLimit`, or move it to `services/rateLimit.ts`): for example 5 per IP per 10 min, and 1 notice per address per 24 h.
  - Add a honeypot field like the comments composer has.
- **Risk:** low. **Phase:** A.

#### S9: Signup notice is missing the RFC 8058 one-click header
- **Location:** `packages/api/src/services/mail/listSignupNotice.ts:103`.
- **Problem:** the notice sends `List-Unsubscribe` but not `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Every other list send has both. Gmail and Yahoo bulk-sender rules want both.
- **Fix:** add the header, with the same value the send worker uses.
- **Risk:** low. **Phase:** A.

#### S10: `forum:moderate` holders cannot use the moderation queue
- **Location:** `packages/api/src/services/discussions/moderation.ts:67` (`requireModerator` → `isModerator` = `discussions:moderate` only), compared with `forum/targets.ts:20-23` and `forum/forum.ts:95-99`.
- **Problem:** a role that has only `forum:moderate` can pin, lock and hide threads. But it cannot approve, hide or delete a forum **reply**, and it gets a 403 on `/admin/comments?scope=forum`, which is the link ForumAdmin shows. By default both permissions are STAFF, so nobody notices until an operator splits the roles.
- **Fix:** in `moderation.list/act/bulk/counts`, allow forum-thread rows (and `scope=forum`) when the viewer has `forum:moderate`. Check per row in `act` (`row.target_type === 'forum_thread'`).
- **Risk:** low. **Phase:** B.

#### S11: Social provider crons are started from request handlers
- **Location:** `packages/api/src/services/connections.ts:596,309` → `socialCrons.ts:77-89`.
- **Problem:** `registerProviderCron` and `unregisterProviderCron` run in the worker that served the "connect" or "disconnect" request. CLAUDE.md says crons are primary-only. With `CLUSTER_WORKERS>1`:
  - the Instagram refresh starts on a worker;
  - after a restart, the primary's `initSocialCrons` also registers it, so it runs twice;
  - a disconnect stops it only on the worker that served that request.
- **Fix:** make the provider crons self-gating, like `SOCIAL_SYNC_CRON`: always register them on the primary, and have the handler check `is_connected`. Then delete the register/unregister calls from `connections.ts`.
- **Risk:** low. **Phase:** B.

#### S12: Comment reactions have no rate limit, and every toggle clears all feed caches
- **Location:** `packages/api/src/services/discussions/moderation.ts:21-44`; `discussions/query.ts:255-257`.
- **Problem:** `react()` does not go through `checkWriteRate`. Each toggle fires `reacted`, which runs `invalidateDiscussionFeedCache()` on **every** cached anonymous feed. One user who taps a reaction in a loop keeps every `{{hotThreads}}` and `{{latestComments}}` render uncached for the whole site.
- **Fix:**
  - Add a rate limit (e.g. `rateLimit('u:'+id+':react', 30, 60)`).
  - On `reacted`, do not invalidate. The 5-minute TTL is enough for hot/top ordering. Keep invalidation for the other event types.
- **Risk:** low. **Phase:** A.

#### S13: The rate-limit counter can get stuck with no TTL
- **Location:** `packages/api/src/services/discussions/spam.ts:15-16`.
- **Problem:** `INCR` and then `EXPIRE` only when `n === 1` are not atomic. If the `EXPIRE` fails (blip or restart) the key never expires, and that user or IP stays rate-limited forever.
- **Fix:** use `multi().incr(k).expire(k, window, 'NX').exec()` (Valkey / Redis 7), or a Lua script.
- **Risk:** low. **Phase:** A.

---

### Performance

#### P1: Discovery checks access row by row and in sequence, with no cache for signed-in users
- **Location:** `packages/api/src/services/discussions/query.ts:220-226`.
- **Problem:** `compute` over-fetches up to 500 rows. It then `await`s `target.access()` for each distinct target, **one after another**. Each call is a DB query plus permission and rank lookups. Signed-in viewers skip the cache, and the template functions (`{{hotThreads(5)}}`, `{{latestComments}}`) run on page views. So one signed-in page view with a discovery block can run hundreds of serial queries.
- **Fix:**
  - Short term: `await Promise.all` over the distinct `type:id` set. The memo is already there.
  - Better: add an optional batch `accessMany(ids, viewer)` to `CommentTarget`. forum_thread and post can each answer it in one query.
  - Cache by viewer **level** (`-1 / 0 / rank / staff`) instead of only for anonymous, because forum and post gates depend only on level.
- **Risk:** medium. **Phase:** B.

#### P2: The member comments page repeats the same per-row access loop
- **Location:** `packages/api/src/services/members.ts:96-106`.
- **Problem:** this is a copy of P1's filter, with the same serial awaits.
- **Fix:** move it into one helper, `discussions/readable.ts` `filterReadable(rows, viewer)`, used by discovery, members and any later lists.
- **Risk:** low. **Phase:** B (do with P1).

#### P3: The comment list loads every reply, and reads settings once per row
- **Location:** `packages/api/src/services/discussions/comments.ts:124-128,84`.
- **Problem:**
  - Replies are fetched with `root_id = ANY(...)` and no limit. One popular top-level comment with 5k replies returns them all, on every 60 s poll (see P4).
  - `mapForViewer` calls `inEditWindow()`, and so `getSettings()`, once **per row**.
  - The `a_tier` correlated subquery also runs per row.
- **Fix:**
  - Read the settings once before the loop.
  - Cap replies per root (e.g. the newest 50 by default, plus a `replies` endpoint or `?root=` for "show more").
  - Consider a lateral join for the tier.
- **Risk:** low. **Phase:** B.

#### P4: The comments section refetches the whole list every minute
- **Location:** `packages/cms/src/components/discussions/CommentsSection.tsx:44-58,83-88`.
- **Problem:** the 60 s poll reloads pages 1…N (up to 100 top-level comments with full trees) for every open tab of a popular post.
- **Fix:** poll only a cheap count (`total`, plus the newest id). Show "N new comments — show". Fetch the list only on demand.
- **Risk:** low. **Phase:** B.

#### P5: The live viewers panel polls while the tab is hidden
- **Location:** `packages/cms/src/components/admin/posts/types/live/LiveViewers.tsx:106-108`.
- **Problem:** it sends a `GET /live/viewers` every 5 s and runs a 1 s tick, even in a background tab.
- **Fix:** skip `load()` while `document.visibilityState !== 'visible'`, and refresh on `visibilitychange`. (Later: push roster changes over the room socket to moderators.)
- **Risk:** low. **Phase:** A.

#### P6: The presence heartbeat makes one Redis round-trip per viewer
- **Location:** `packages/api/src/services/liveRooms/moderation.ts:84-91`.
- **Problem:** `refreshPresence` `await`s a `MULTI` for each socket, in sequence, every 15 s. A show with 1,000 viewers means 1,000 serial round-trips per tick per worker.
- **Fix:** do one `hset(key, {connId: json, …})` and one `expire` per room in a single pipeline.
- **Risk:** low. **Phase:** A.

#### P7: The post-type editor registry loads the live console for every post
- **Location:** `packages/cms/src/components/admin/posts/types/registry.ts:17` (`import.meta.glob(..., { eager: true })`).
- **Problem:** the Live console (about 900 lines, plus the WHIP publisher, MediaRecorder upload, viewers panel and chat) is bundled into the PostEditor chunk. Every article edit downloads it.
- **Fix:** use a non-eager glob, and wrap each editor in `lazy()` in `getEditorFor`. Keep `editorKeys()` from `Object.keys(modules)`.
- **Risk:** low. **Phase:** B.

#### P8: The forum thread fetches replies twice and hides errors
- **Location:** `packages/cms/src/pages/forum/ForumThread.tsx:34,57-65`.
- **Problem:**
  - `perPage()` starts at 20 and then changes to the configured value when `forum.settings()` loads, so the effect loads replies twice.
  - A response that arrives out of order can overwrite the newer one.
  - `catch {}` sets `[]`, so a 403 or 500 looks like "no replies".
- **Fix:**
  - Gate the effect on `forumSettings.state === 'ready'`.
  - Drop stale responses with a request counter.
  - Show an error line.
- **Risk:** low. **Phase:** A.

---

### UI / UX

#### U1: "Load more comments" stops working after 100 comments
- **Location:** `packages/cms/src/components/discussions/CommentsSection.tsx:49,93-96,140-144`.
- **Problem:** `load()` asks for `page: 1, limit: min(100, 20 × pages)`. When a post has more than 100 top-level comments, the button keeps showing (`comments().length < total()`), but each click loads the same first 100 again.
- **Fix:** fetch `page: pages()` with `limit: PAGE` and append the result, de-duplicated by id. A refresh then reloads only the pages already shown.
- **Risk:** low. **Phase:** A.

#### U2: Public comment actions use `window.confirm` and `window.prompt`
- **Location:** `packages/cms/src/components/discussions/CommentItem.tsx:95,105`.
- **Problem:**
  - Delete uses a native confirm and Report uses a native prompt. They have no styling, some embedded browsers block them, and they do not match the forum and live UIs (LiveViewers uses a `ConfirmModal`).
  - The report reason has no length hint, although the server limits it to 1000 characters.
- **Fix:** use a small public confirm/report modal (Portal), with an optional reason textarea and a character count. It can be shared by the forum thread page.
- **Risk:** low. **Phase:** A.

#### U3: Forum moderator tools are incomplete
- **Location:** `packages/cms/src/pages/forum/ForumThread.tsx:153-161`.
- **Problem:**
  - **Hide** acts at once with no confirmation.
  - The server supports **Move to category** (`updateThread` with `categoryId`, moderators only) and **author delete while no replies** (`actOnThread` `ownDelete`). Neither has any UI.
- **Fix:** add a confirmation for Hide, a "Move…" select for moderators, and "Delete thread" for the author when `replyCount === 0`.
- **Risk:** low. **Phase:** A.

#### U4: The moderation queue can disappear from the nav, and it has no pending badge
- **Location:** `packages/cms/src/pages/admin/AdminLayout.tsx:96`.
- **Problem:**
  - The **Comments** item needs `feature: 'comments'`. With Forum on and Comments off, `/admin/comments?scope=forum` (where forum replies are moderated) has no sidebar entry.
  - No count shows, although `GET /discussions/moderation/counts` exists, so pending posts sit unseen.
- **Fix:** show the item when `comments || forum` is on, and label it "Moderation" when only the forum is on. Add a pending + reported badge (poll the counts every 60 s while visible, or push it over `/ws/admin`).
- **Risk:** low. **Phase:** A.

#### U5: Sidebar icons are reused
- **Location:** `packages/cms/src/pages/admin/AdminLayout.tsx:75-107`.
- **Problem:**
  - `messages` is used for Forum, Messages and Comments.
  - `media` is used for Gallery and Media.
  - `developer` is used for Entities, Components and Plugins.
  - Events uses `campaigns`, and Wiki uses `pages`.
  
  In the collapsed sidebar these cannot be told apart.
- **Fix:** add distinct entries in `ICONS`: forum (speech bubbles), comments (quote), gallery (grid), calendar, wiki (book), components (puzzle), plugins (plug).
- **Risk:** low. **Phase:** A.

#### U6: Screen readers announce every chat message
- **Location:** `packages/cms/src/components/live/chat/LiveChat.tsx:310`.
- **Problem:** `aria-live="polite"` is on the whole message list. In a busy show, a screen reader reads out every line without stopping, which makes the page unusable.
- **Fix:** use `role="log"` with `aria-live="off"` by default and an "Announce new messages" option. Or announce only @mentions of the viewer through a separate visually hidden live region.
- **Risk:** low. **Phase:** A.

#### U7: The help index is static and has no live-shows guide
- **Location:** `packages/cms/src/pages/admin/Help.tsx:10`; `docs/how-it-works/` (no `LIVE-SHOWS.md`).
- **Problem:**
  - The topics are not gated by feature. Forum and Gallery guides show on sites with those features off.
  - There is no filter box, now that the SDK and API references are here.
  - Live shows (provider setup, recording methods, replays, moderation, bans) have no operator guide. They are covered only in CLAUDE.md and inside the post-types doc.
- **Fix:**
  - Add `feature?` to `HelpTopic` and mark topics "(feature off)", or hide them.
  - Add a filter input.
  - Write `docs/how-it-works/LIVE-SHOWS.md` and a `/admin/help/live-shows` page.
- **Risk:** low. **Phase:** A.

#### U8: The API keys panel uses native confirm and inline styles
- **Location:** `packages/cms/src/components/admin/settings/ApiKeysPanel.tsx:69,94-95,127`; `RoleManager.tsx:87`.
- **Problem:**
  - Revoking a key uses `window.confirm`. The rest of the admin uses a confirm modal.
  - There are inline `style={{…}}` blocks, which CLAUDE.md says belong in a partial.
- **Fix:** use `ConfirmModal` (danger), and move the styles to `_settings.scss` classes (`.api-key__created`, `.api-key__form`, `.role-manager__actions`).
- **Risk:** low. **Phase:** A.

#### U9: The header editor still sends each keystroke up into a signal array
- **Location:** `packages/cms/src/components/admin/editors/SiteHeaderEditor.tsx:145` (`createSignal<SiteHeaderItem[]>`), `:772-845,1182-1231` (15 `onInput` handlers, including `updateChild(idx(), …)` on the dropdown-children rows).
- **Problem:** the 2026-09-25 audit (C1) covered the footer editor. The header editor has the same pattern. A child link row is rebuilt on each keystroke inside `<For>`, which is the focus-loss case the "commit on blur" rule exists to prevent.
- **Fix:** add the header editor to the C1 plan: `createStore` for items, patch in place, and commit on blur with local drafts.
- **Risk:** medium (large file). **Phase:** C.

---

### Architecture / code

#### A1: `Settings.tsx` is 2,083 lines with five panels inside it
- **Location:** `packages/cms/src/pages/admin/Settings.tsx:57-100` (hex helpers), `:101` `SiteColorsPanel`, `:504` `BreakpointsEditor`, `:670` `AppearancePanel` (about 40 signals), `:1229` `BrandingMediaField`, `:1315` `AdminAppearancePanel`.
- **Problem:** the file is hard to review and every change touches it. `isValidHex` is defined again here, beside `components/admin/appearance/ColorPicker.tsx:38`.
- **Fix:**
  - Move each panel to `components/admin/settings/appearance/*.tsx`.
  - Move the hex/alpha helpers to `utils/color.ts` and share them with ColorPicker.
  - Replace AppearancePanel's 40 signals with one `createStore<AppearanceSettings>` and a dirty flag.
- **Risk:** medium. **Phase:** C.

#### A2: The live console is a single 898-line component
- **Location:** `packages/cms/src/components/admin/posts/types/live/index.tsx`.
- **Problem:** media devices with the mic meter, the WHIP publisher with stats, the browser recorder with part upload and resume, the room socket, the settings, and the end/restart flow are all in one component that shares about 40 signals. It is hard to test, and it is easy to leak a timer or a track.
- **Fix:** extract `useMediaDevices()`, `useLivePublisher(postId)`, `useBrowserRecorder(postId)` and `useLiveRoomHost(postId)` into `live/hooks/`. Each owns its own `onCleanup`. Keep the component as layout only.
- **Risk:** medium. **Phase:** C.

#### A3: Thread status changes are not atomic
- **Location:** `packages/api/src/services/forum/forum.ts:387-425` (`actOnThread`).
- **Problem:** the update to the `forum_threads.status` row and `setStatus(opening)` (which updates counters in its own transaction) are two separate writes. If the second fails, the thread status and the opening comment disagree until the nightly reconcile. The `syncThreadStatus` listener then fires a third write.
- **Fix:** run both writes in one `transaction`. Let `setStatus` take the caller's `client` (it already uses one internally). Emit the event after commit.
- **Risk:** low. **Phase:** B.

#### A4: The riskiest discussion and live logic has no tests
- **Location:** `packages/api/src/services/forum/access.ts` (pure rules, no test); `discussions/comments.ts` (`visibilityClause`, the counter delta in `applyVisibility` / `setStatus`); `liveRooms/server.ts` `handleCommand` moderation path.
- **Problem:** the only tests are `queryParams.test.ts`, `threadLayout.test.ts`, the live `authz` and `moderation` pure tests, and the smoke scripts (manual). Access floors (read, post, reply, locked, Infinity for staff) and the counter rules are exactly where a regression leaks content or skews counts without anyone noticing.
- **Fix:**
  - Add `forum/access.test.ts` (a table of levels × settings × category).
  - Add a `comments.visibility.test.ts` with a fake `PoolClient` that checks the reply_count and activity deltas for each status transition.
  - Add a `handleCommand` test for S1 (inject the store and moderation through module mocks).
- **Risk:** low. **Phase:** A.

#### A5: Hardcoded colours in the live and discussions styles
- **Location:** `packages/cms/src/components/live/chat/LiveChat.scss:25-26` (admin variant `--lc-bg: #fff; --lc-accent: #e63946`); `components/discussions/discussions.scss:246` (`#b91c1c`); `components/live/LiveShow.scss:31-32,109,145` (player chrome).
- **Problem:** the admin chat variant does not follow Admin Appearance (`--admin-*`, `$primary`). The error red is a literal and not the token.
- **Fix:**
  - Use `var(--admin-panel-bg, #{$white})` and `var(--site-primary, #{$primary})` in the admin variant.
  - Use `$error-color` / `var(--site-error)` for the red.
  - Leave the dark player chrome as named SCSS variables at the top of `LiveShow.scss`.
- **Risk:** low. **Phase:** A.

#### A6: `mapComment` trusts the caller's SQL to hide hidden and pending bodies
- **Location:** `packages/api/src/services/discussions/rows.ts:92-93`.
- **Problem:** the docblock says the body is "blanked … for hidden/pending ones a non-moderator may not see", but only `deleted` is blanked. Hiding works only because every current query adds `visibilityClause`. A new caller that forgets it (an entity provider or an export) would leak the bodies of hidden comments.
- **Fix:** in `mapComment`, set `showBody = moderator || own || status === 'visible'` (a deleted comment stays blank). Then the mapper fails closed whatever the query does.
- **Risk:** low. **Phase:** A.

#### A7: Discovery and the member page build author cards with two copies of the SQL
- **Location:** `packages/api/src/services/discussions/query.ts:150-170` (inline author columns plus an `a_tier` subquery) compared with `rows.ts:46-57` `COMMENT_COLUMNS`.
- **Problem:** the thread query copies the author-card SELECT (including `ENTITLED`, which is itself a copy of `permissions/subjects.ENTITLED_STATUSES`). A change to the author card, such as hiding the tier for private profiles, has to be made in both places.
- **Fix:** export an `authorColumns(alias)` builder plus one `ENTITLED_SQL` constant from `rows.ts`, and use them in both queries.
- **Risk:** low. **Phase:** A.

---

### Feature gaps

#### F1: Comment deep links do not work past the first page
- **Location:** `discussions/query.ts:117` (`url: …#comment-<id>`), notification emails, and `CommentsSection.tsx`.
- **Problem:** discovery lists, `comment_reply` emails and the moderation queue all link to `#comment-<id>`. If that comment is not in the first 20 top-level threads, the anchor matches nothing.
- **Fix:** add `GET /discussions/comments/:id/locate`, which returns the root id and its page for the current sort. When the hash is present on load, `CommentsSection` loads up to that page (or just that root), then scrolls and highlights.
- **Risk:** low. **Phase:** B.

#### F2: Live chat is lost after the show
- **Location:** `packages/api/src/services/liveRooms/store.ts` (the last 50 lines in Redis, 7-day TTL).
- **Problem:**
  - Viewers of the replay cannot see the chat.
  - Moderators have no record of the messages that led to a ban; a deleted message is simply gone.
  - The operator cannot export a transcript.
- **Fix:** write each chat message (and deletion) to a `live_chat_messages` table, best-effort and batched. Add **Download transcript** in the Recordings card. Add an optional read-only chat beside the replay.
- **Risk:** medium. **Phase:** C.

#### F3: Live bans are permanent and the list has no search
- **Location:** `packages/api/src/services/liveRooms/moderation.ts:217-237`; `LiveViewers.tsx` Banned list.
- **Problem:** a ban never ends, and the list (up to 500 rows) has no search. A silence goes up to 7 days, but a ban cannot be time-limited.
- **Fix:**
  - Add an `expires_at` column (NULL = permanent), a duration select in the ban confirm modal, and filtering in `banSets`.
  - Add a search box to the Banned list.
  - Record the show the ban came from.
- **Risk:** low. **Phase:** B.

#### F4: The reference pages do not keep the filter in the URL
- **Location:** `packages/cms/src/components/admin/help/RefBrowser.tsx:68,185-191`.
- **Problem:** the filter is a local signal. A filtered view (e.g. "shop refund") cannot be shared, and it is lost on reload or Back. The TOC buttons also have no `aria-controls`.
- **Fix:** mirror `query()` to `?q=` (with `replace: true`), read it on mount, and add `aria-controls={g.id}` to the group toggles.
- **Risk:** low. **Phase:** A.

---

### Phase summary

| Phase | Count | IDs |
|-------|-------|-----|
| A | 24 | S1, S3, S4, S5, S8, S9, S12, S13, P5, P6, P8, U1, U2, U3, U4, U5, U6, U7, U8, A4, A5, A6, A7, F4 |
| B | 13 | S2, S6, S7, S10, S11, P1, P2, P3, P4, P7, A3, F1, F3 |
| C | 4 | U9, A1, A2, F2 |

Natural change sets: S4 + S5, U2 + U3, A5 + U8, A6 + A7, P1 + P2, S6 + S7, F1 + P3.

**Suggested order:** S1 → U1 → S2 → S8/S9 → S12/S13 → P1+P2 → the rest of A → B → C.
