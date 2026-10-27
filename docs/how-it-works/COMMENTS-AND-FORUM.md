# Comments + Forum

Two features on one discussion engine. Plan and design notes:
`docs/plans/completed/2026-10-10-comments-and-forum.md`.

```
discussions  (hidden base — enabled automatically; owns comments, reactions, reports, activity)
  ├─ comments  — comments on posts and events (per item: Enable commenting)
  └─ forum     — /forum: categories, threads, replies; admin Forum section
```

Turn on **Comments** and/or **Forum** in Settings → Features. The `discussions`
base installs with the first one and never shows in the list.

## The engine

- A **comment** belongs to a target: `post:<id>`, `event:<id>`, `forum_thread:<id>`
  (any entity type can be added later). Replies nest through `parent_id`.
- A forum thread's **opening post** and its **replies** are comments too, so editing,
  reactions, moderation, the author card and activity counts are the same code.
- Bodies are **Markdown**, rendered by the shared safe renderer (`renderMarkdown` —
  escapes first, allow-listed link protocols).
- **Statuses:** `visible` · `pending` (awaiting approval) · `hidden` (moderated) ·
  `deleted` (soft). A deleted comment that has replies stays as "[deleted]" so the
  thread still reads; one without replies disappears.
- **Counters** (user activity, reply counts, item/thread/category counts) move only when
  a comment enters or leaves `visible`, inside the same transaction. A nightly cron
  (`discussions-reconcile`, 03:47) recomputes them from the rows.
- **Access:** every read and write asks the target. A post's comments follow the post:
  readable only by a viewer who can read the full post (published, passes its
  subscription gate). Forum threads follow the forum's and the category's read rules.
- **Abuse limits:** per-user and per-IP write limits in Redis (shared by every
  worker; fail open; one atomic INCR + TTL script, so a counter can never be left
  without an expiry), a honeypot field, and anonymous comments with more than two
  links held for approval. Reactions: 30 toggles per member per minute, and a
  reaction does not clear the cached discovery feeds (their 5-minute TTL covers it).
- **Hidden bodies fail closed:** the row mapper itself blanks a hidden / pending
  comment's body for anyone but a moderator or its author, whatever the query.
- **Long threads:** a list returns the newest 50 replies of each top-level comment;
  the rest are counted in `hiddenReplies` and loaded with `?root=<id>`
  ("Show N earlier replies").
- **Deep links** (`#comment-<id>` in discovery lists, reply emails, the queue):
  `GET /discussions/comments/:id/locate` (`cms.discussions.locate`) answers the
  top-level comment; the page loads that tree, scrolls to the comment and
  highlights it.

## Comments

- **Per item** (Post editor / Event modal → Comments): *Enable commenting*,
  *Allow anonymous comments*, *Lock comments*. Stored in `comment_threads`
  (`/api/v1/comments/threads/:type/:id`).
- **Updates:** the section polls only the comment total every 60 s and offers
  "N new comments — show"; "Load more comments" fetches the next page and appends it.
- **Default:** only signed-in members can comment; their display name, avatar and
  activity count show on the comment and link to their member page.
- **Anonymous** comments (where allowed): name optional, email optional and never shown.
  **Held for approval** while *Approve anonymous comments* is on (default).
- **Settings** (Admin → Comments → Settings): approve anonymous / approve all, reply
  emails, the default for new items, and the engine settings (reactions, max length,
  edit window).

## Forum

- Public pages: `/forum`, `/forum/:category`, `/forum/:category/:thread`.
- **Admin → Forum**: threads (pin, lock, move, hide, delete), categories (order, read /
  post minimum tier, lock), moderation, and a **Settings** button.
- **On the thread page** moderators can pin, lock, hide (confirmed) and **move** a
  thread to another category; the author can delete their own thread while it has no
  replies.
- **Forum-only moderators:** a role with `forum:moderate` but not
  `discussions:moderate` works the shared queue for forum posts only (the list and
  counts are scoped to the forum; acting on a post/event comment is refused).
- The admin sidebar shows **Comments** (or **Moderation** when only the forum is on)
  with a badge of pending + reported posts, refreshed every 60 s while visible.
- **Access levels** compare with the subscription tier ranks: anonymous −1, a signed-in
  member 0 (Free), subscribers their tier's rank, staff everything. The forum setting
  (public / members / tier ≥ N) and each category's minimums are checked against it.
- **Approval:** approve everything, or hold a member's posts until they have N approved
  forum posts.
- **Hide from forum index** (category switch, `forum_categories.hidden_from_index`,
  migration 197): the category is left out of the forum index (moderators / managers
  still see it, flagged), unscoped discovery lists (`latestThreads`, `hotThreads`, …,
  replies included), the sitemap, and its category page is `noindex`. Its threads still
  open by link, and a forum block / discovery query that NAMES the category (or the
  threads) still lists them.
- **Thread titles are optional** (`POST /forum/threads`): an empty `title` is derived from
  the first line of the body (`deriveThreadTitle`), falling back to "Post by <name>".
  `categoryId` takes an id or a slug.
- **Anonymous posting** (Forum → Settings): `allowAnonymous` (default off) lets guests
  start threads and reply, only with the permission `forum:post_anonymous` (everyone by
  default) and only in categories a visitor may read whose post minimum is "anyone"
  (rank ≤ 0, not locked). `anonymousApproval` (default on) holds guests' posts for
  approval (as does approve-all; a guest post with more than two links is always held).
  A guest thread has no author (`author_id` NULL); the guest name / email / IP sit on its
  opening post like an anonymous comment's. Guests are rate-limited per IP; the
  `website` honeypot answers like a held post and stores nothing. Replies follow the same
  rule through the `forum_thread` comment target (`allowAnonymous` + its
  `anonymousPermission`), so the engine checks `forum:post_anonymous`, not
  `comments:anonymous`, for forum replies.

## Forum block (`forum`) and `{{ forum() }}`

An in-page forum / live discussion: threads from a query or a selection (list mode) or
one thread as a chat stream (thread mode), with inline posting, replies and reactions.
Settings: `ForumBlockSettings` in `@sitesurge/types` (`types/forumBlock.ts`; the template
function maps through `forumBlockSettingsFrom`). Plan: `docs/plans/completed/2026-10-27-forum-block.md`.

**Display** — `threadStyle`: `full` (card: title, post, a meta row, then the actions) or
`minimal` (chat: a compact avatar + name row, the message as a bubble, ONE row — Reply ·
reactions · "N replies (2m ago by X)" · views · Read more). Reply count and view count are
separate switches (`showReplyCount` / `showViewCount`; the old `showCounts` is read when they
are unset); without the reply count a "Show replies" link opens the replies. A `heading`
and a `subheading` (plain paragraph, line breaks kept) each take an alignment.

**Feed** — `GET /api/v1/forum/feed` (optional auth, `cms.forum.feed`, service
`services/forum/feed.ts`):

| Query | Meaning |
|---|---|
| `threads` | comma-joined ids or slugs (≤ 50), returned in THIS order; present but empty = nothing |
| `sort` | `latest` (last activity, default) · `newest` (date posted) · `hot` · `top` |
| `window` | `24h` · `7d` · `30d` · `all` (default `all` for latest/newest, `7d` for hot/top) |
| `category` | slug or id; a hidden-from-index category is listed only when named |
| `postCategory` | slug or id new posts go to → `postTarget` |
| `page`, `limit` | paging; `limit` ≤ 50, default 20 |

Each item is a `ForumFeedThread`: the opening post (`Comment`: body html, reactions,
`myReactions`, edit/delete rights), author (guest name for a guest thread), `lastReplyBy`
(newest visible reply), excerpt (≤ 500 chars), category, `status` (`visible`, or
`pending` for the viewer's OWN held threads — shown so a poster sees "awaiting
approval"), `canReply` + `replyBlockedReason` (the `forum_thread` target's decision +
`forum:reply` / guest rule). Categories the viewer cannot read are dropped in SQL;
pinned threads do not float (chronological widget). `postTarget` = `{ canPost, reason,
anonymous }` for the post category (`null` when not asked or not found). Also returned:
`anonymousAllowed`, `maxLength`, `reactions`, `reactionsEnabled`. Anonymous results are
cached 30 s (`CACHE_KEYS.forumFeed`, under the discussion-feed prefix, so every comment
write / moderation drops them); signed-in viewers are computed per request.

**SSR + email** render a plain linked list of the threads, read as the anonymous viewer
(`services/forum/serverRender.ts` → `settings.__forumItems`, stashed by the shared
pre-pass `mail/expandBlocks.ts`; HTML in `services/forum/render.ts`, shared by the
block and `{{ forum() }}`): heading, title links, author + reply count, excerpt; thread
mode shows the one thread. Email links are absolute and end with "Join the discussion →"
(the first thread's category page, else `/forum`). The feature off → nothing.

## Member pages

`/members/:handle` — avatar, name, joined date, activity count, and a **Comments** tab
listing their visible comments and forum posts (only those the viewer may see).
Handles are unique, set at sign-up from the display name and editable in Profile;
a member can hide their page.

## Activity count

Visible comments + forum threads + forum replies, per user (`user_activity`). Shown on
author cards, member pages and the admin user page.

## Discovery (latest / hottest)

One query layer for lists shown anywhere: `GET /api/v1/discussions/query`
(`cms.discussions.query`), template functions (`latestComments`, `hotThreads`,
`discussions(…)`) in pages, SSR and email, and read-only `comment` / `forum_thread`
entity types for entity blocks and carousels.

Hot score: `(replies × 2 + reactions + views ÷ 50 + 1) / (age_hours + 2) ^ 1.5`.

## Permissions

| Key | Default |
|---|---|
| `discussions:react`, `discussions:report`, `discussions:edit_own`, `discussions:delete_own` | members |
| `discussions:moderate` | staff |
| `comments:write` | members |
| `comments:anonymous` | everyone (only where an item allows it) |
| `comments:manage` | staff |
| `forum:read` | everyone (narrowed by forum settings / categories) |
| `forum:thread_create`, `forum:reply` | members |
| `forum:post_anonymous` | everyone (only while Allow anonymous posting is on) |
| `forum:moderate` | staff |
| `forum:manage` | admins |

All of them can be granted per subscription tier (Settings → Permissions).

## API

| Prefix | Feature | What |
|---|---|---|
| `/api/v1/discussions` | discussions | comments CRUD, reactions, reports, moderation, engine settings, discovery query |
| `/api/v1/comments` | comments | per-item switches, Comments settings |
| `/api/v1/forum` | forum | settings, categories, threads, forum-block feed (`/feed`) |
| `/api/v1/members` | core | public member pages + their comments |

## Smoke tests (dev DB)

```bash
cd packages/api
npm run smoke:discussions   # enables Comments, exercises the engine, cleans up
npm run smoke:forum         # enables Forum, threads/replies/counters/gating, cleans up
```

## Uninstall

Removing **Comments** deletes the comments attached to content (forum replies stay);
removing **Forum** deletes its threads, categories and their comments. The
`discussions` base keeps the rest until it is removed itself.
