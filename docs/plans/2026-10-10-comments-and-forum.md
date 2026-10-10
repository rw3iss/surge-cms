# Comments + Forum (on one discussion engine) — plan

> **STATUS 2026-10-10 — PLANNED.** Not started.

## Goal

1. **Comments** on posts and events (and later any entity type): opt-in per item from
   its admin page, signed-in by default with an optional anonymous mode, threaded
   replies, edit, reactions, author cards.
2. **Forum**: a members' forum with categories, threads and replies, its own admin
   section with a **Settings** button.
3. **Activity count** per user: every comment, forum thread and forum reply they
   have made, shown on author cards, their public page and the admin user page.
4. **Public member page** `/members/:handle` with a **Comments** tab listing that
   user's public comments and forum posts. Every author name links there, with the
   Comments tab selected.
5. **Discovery**: one query layer for *latest* / *hottest* / general comment and
   thread lists — API, SDK, `{{ }}` template functions (site, SSR, email) and entity
   types — so discussions can be shown anywhere on the site or in newsletters.

## Shape: two features on one engine

```
discussions  (base; hidden prerequisite — owns the engine + shared data)
  ├─ comments  (requires discussions, users) — comments on posts / events / …
  └─ forum     (requires discussions, users) — /forum, categories, threads
```

Why not one feature with sub-toggles: the feature system already gives a disabled
feature 404 routes, lazy migrations, per-feature permissions/settings and a clean
uninstall. Many sites want comments without a forum (or the reverse). Why not two
independent features: replies, editing, reactions, moderation, reports, spam
limits, notifications and activity counts are the SAME machinery — built twice
they drift.

A forum reply **is** a comment whose target is a forum thread, so moderation,
reactions, editing, the author card, the activity count and the profile Comments
tab work for both with no extra code.

### `discussions` as a hidden prerequisite

- New `FeatureConfig.hidden?: boolean` — hidden features are not listed in
  Settings → Features.
- Enabling `comments` or `forum` calls the planner with `enableDependencies`
  (already supported by `features/validator.ts`), so `discussions` installs with
  it. One level of prerequisites is resolved today; `discussions` itself only
  requires `users`, which is on by default — add a recursive resolve if that
  ever changes.
- `discussions` stays installed when both dependents are turned off (turning a
  feature off keeps its data). **Remove** on Comments/Forum offers "also remove
  all comments and reactions" when it is the last dependent, which uninstalls
  `discussions` too.

## Decisions (defaults — easy to change later)

| Topic | Decision |
|---|---|
| Activity count | comments + forum threads + forum replies that are **visible** (pending/hidden/deleted do not count). Authored articles are NOT counted (they are staff work, not participation). |
| Anonymous comments | Off per item. When on: name optional ("Anonymous"), email optional (never shown), honeypot + per-IP rate limit, and **held for approval by default** (Comments settings: "Approve anonymous comments before they show", default on). |
| Signed-in label | The user's display name + avatar, linked to `/members/:handle?tab=comments`. |
| Who may comment | Signed-in users (permission `comments:write`, default member+). A per-item "minimum subscription" is phase 6, reusing the tier ranks. |
| Comments on a gated post | Shown only to viewers who can read the full post. A locked/sample view shows "Comments are for subscribers" with the UpgradeTout. Same rule filters the profile Comments tab. |
| Threading | Unlimited depth in storage (`parent_id`); the UI indents to depth 3, deeper replies render flat with "↪ replying to Name". |
| Editing | Author may edit any time; shows "edited" + time. Staff may edit/hide anything. Edit history kept (last 10) for moderation. |
| Deleting | Soft delete. A deleted comment with replies keeps its place as "[deleted]" so the thread still reads; one with no replies disappears. |
| Reactions | 👍 ❤️ 😂 😮 😢 🔥 (one per user per kind; set configurable in settings). Toggle on/off. |
| Body format | Markdown via the existing `renderMarkdown` (escapes first; link protocols allow-listed). Max 10 000 chars. No image upload in v1. |
| Events | Comments attach to the EVENT, not to one occurrence of a series. |
| Real-time | v1 refetches after posting + every 60 s while visible. Live push (reuse `services/ws/upgrade.ts`) is phase 6. |
| Public profile | Visible by default; a member can hide it (Profile → "Show my public member page"). A hidden page 404s; their comments still show their name, without a link. |

## Data model

### Core migration `132_member_profiles.sql` (no feature tag — the member page is core)

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle VARCHAR(40);     -- backfilled from display_name, de-duplicated (-1, -2 …)
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower ON users (lower(handle));
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_public BOOLEAN NOT NULL DEFAULT true;
```

`handle` rules: `^[a-z0-9][a-z0-9_-]{2,39}$`, reserved words refused (`admin`,
`settings`, …). Set on registration (derived), editable in Profile.

### `133_discussions.sql` (`-- @feature discussions`)

```sql
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type VARCHAR(32) NOT NULL,          -- 'post' | 'event' | 'forum_thread' | <entity type>
  target_id UUID NOT NULL,
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  root_id UUID,                               -- top-level ancestor (cheap subtree reads)
  depth SMALLINT NOT NULL DEFAULT 0,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_name VARCHAR(80), guest_email VARCHAR(255), guest_ip INET,   -- anonymous only
  body TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'visible',   -- visible | pending | hidden | deleted
  is_opening BOOLEAN NOT NULL DEFAULT false,       -- the first post of a forum thread
  edited_at TIMESTAMPTZ, edit_count INT NOT NULL DEFAULT 0,
  reaction_counts JSONB NOT NULL DEFAULT '{}',     -- denormalised {"👍":3}
  reply_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON comments (target_type, target_id, status, created_at);
CREATE INDEX ON comments (author_id, created_at DESC) WHERE status = 'visible';
CREATE INDEX ON comments (parent_id);

CREATE TABLE comment_edits (comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL, edited_by UUID, edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE TABLE comment_reactions (comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE, kind VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (comment_id, user_id, kind));

CREATE TABLE comment_reports (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE, reporter_id UUID, reason TEXT,
  status VARCHAR(12) NOT NULL DEFAULT 'open',      -- open | resolved | dismissed
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_by UUID, resolved_at TIMESTAMPTZ);

CREATE TABLE user_activity (                        -- denormalised counters
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  comments INT NOT NULL DEFAULT 0, forum_threads INT NOT NULL DEFAULT 0, forum_replies INT NOT NULL DEFAULT 0,
  total INT GENERATED ALWAYS AS (comments + forum_threads + forum_replies) STORED,
  last_active_at TIMESTAMPTZ);
```

Counters (`user_activity`, `comments.reply_count`, thread counters) are updated in
the SAME transaction as the write that changes them (create, status change,
delete). A nightly cron (`discussions-reconcile`, primary only) recomputes them from
the rows, so a missed update heals itself.

### `134_comments.sql` (`-- @feature comments`)

Per-item settings live in ONE generic table rather than columns on `posts`/`events`:
a feature migration should not alter core tables (uninstall cannot drop the
columns), and any entity type can opt in later with no schema change.

```sql
CREATE TABLE comment_threads (
  target_type VARCHAR(32) NOT NULL, target_id UUID NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  allow_anonymous BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false,            -- readable, no new comments
  comment_count INT NOT NULL DEFAULT 0, last_comment_at TIMESTAMPTZ,
  PRIMARY KEY (target_type, target_id));
```

### `135_forum.sql` (`-- @feature forum`)

```sql
CREATE TABLE forum_categories (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(80) UNIQUE NOT NULL, name VARCHAR(120) NOT NULL, description TEXT,
  sort_order INT NOT NULL DEFAULT 0, parent_id UUID REFERENCES forum_categories(id),
  read_min_rank INT, post_min_rank INT,             -- subscription tier ranks; NULL = forum default
  locked BOOLEAN NOT NULL DEFAULT false, thread_count INT NOT NULL DEFAULT 0, post_count INT NOT NULL DEFAULT 0,
  last_thread_id UUID, last_post_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

CREATE TABLE forum_threads (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES forum_categories(id),
  slug VARCHAR(160) NOT NULL, title VARCHAR(200) NOT NULL,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'visible',   -- visible | pending | hidden | deleted
  pinned BOOLEAN NOT NULL DEFAULT false, locked BOOLEAN NOT NULL DEFAULT false,
  reply_count INT NOT NULL DEFAULT 0, view_count INT NOT NULL DEFAULT 0,
  last_reply_at TIMESTAMPTZ, last_reply_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, slug));
CREATE INDEX ON forum_threads (category_id, pinned DESC, last_reply_at DESC NULLS LAST);
```

The thread's opening post is a `comments` row (`target_type='forum_thread'`,
`is_opening=true`); replies are ordinary comments on the thread.

## Backend

- `services/discussions/` — `comments.ts` (create / edit / delete / tree read with
  pagination by top-level comment), `reactions.ts`, `moderation.ts` (queue: pending +
  reported; approve / hide / delete / dismiss; bulk), `activity.ts` (counter updates +
  reconcile), `access.ts` (target registry: `registerCommentTarget('post', { canRead,
  canComment, url, title })` — post and event register theirs; the forum registers
  `forum_thread`), `spam.ts` (rate limits through the shared Redis limiter, honeypot,
  max links for accounts younger than N days, banned users refused).
- `services/comments/settings.ts` — the comments feature's keyed setting
  (`comments_settings`): approve anonymous first, reactions on/off + set, edit window
  (default unlimited), notify on reply.
- `services/forum/` — categories, threads (create = thread row + opening comment in one
  transaction), counters, slugs (de-dupe like events), `settings.ts` (`forum_settings`).
- `services/members.ts` — public member profile + their public comments (gated per
  target via `access.ts`).
- Routes (`registerModule(..., { feature })` so disabled features 404):
  - `/api/v1/comments` — `GET ?target=post:<id>` (tree), `POST`, `PUT /:id`,
    `DELETE /:id`, `POST /:id/reactions`, `POST /:id/report`;
    `GET/PUT /comments/settings/:targetType/:targetId` (staff — the per-item toggle);
    `GET /comments/moderation`, `POST /comments/moderation/:id/{approve,hide,delete}`,
    `GET/PUT /comments/admin-settings`.
  - `/api/v1/forum` — categories (public list; staff CRUD), threads (list / get / create /
    update / pin / lock / move), `GET/PUT /forum/settings`.
  - `/api/v1/members/:handle` (+ `/comments?page=`).
- Permissions (`services/permissions/catalog.ts`, `FEATURE_PERMISSIONS`):
  `comments:write` (member+), `comments:edit_own`, `comments:delete_own` (member+),
  `comments:anonymous` (anonymous role — only used where the item allows it),
  `comments:moderate` (staff), `comments:manage` (admin: settings);
  `forum:read` (anonymous, narrowed by forum settings), `forum:thread_create` +
  `forum:reply` (member+), `forum:moderate` (staff), `forum:manage` (admin).
  All grantable per subscription tier.
- Notifications: new `NOTIFICATION_TYPES` `comment_posted`, `comment_reported`,
  `forum_thread_created` (feature-gated). Member emails through new mail purposes
  `comment_reply` and `forum_reply` (empty blocks = built-in body; per-user opt-out in
  Profile → Notifications).
- DTOs `packages/shared/src/api/routes/{comments,forum,members}.ts`; SDK
  `cms.comments.*`, `cms.forum.*`, `cms.members.*`; `CACHE_KEYS` +
  `invalidateCommentsCache(target)` / `invalidateForumCache()`; API docs regenerated.

## Discovery: latest / hottest / general queries

One query layer (`services/discussions/query.ts`) serves every "show discussions
elsewhere" need — a home-page "Hot this week" list, a sidebar of latest comments,
a newsletter section, an entity block or carousel. Comments and forum threads use
the same parameters.

```ts
interface DiscussionQuery {
  kind: 'comment' | 'thread' | 'both';        // 'both' = a mixed feed
  sort: 'latest' | 'hot' | 'top';             // top = most reactions+replies in the window
  window?: '24h' | '7d' | '30d' | 'all';      // default 7d for hot/top, all for latest
  targetType?: string; targetId?: string;      // comments on one type / one item
  category?: string;                           // forum category slug (threads + forum replies)
  author?: string;                             // user handle
  minReactions?: number; includeReplies?: boolean;
  page?: number; limit?: number;               // limit ≤ 50
}
```

- **Hot score**, computed in SQL at query time (no stored score to drift):
  `(replies × 2 + reactions + views ÷ 50 + 1) / (age_hours + 2) ^ 1.5` — new activity
  rises, then decays with age. Only rows inside the window are scored, so the
  `(created_at)` / `(last_reply_at)` indexes bound the work.
- **Access is applied per viewer** through `access.ts` (gated items, private forum
  categories, hidden profiles). The anonymous result is cached in Redis
  (`CACHE_KEYS.discussionFeed(hash)`, 5 min; dropped by `invalidateCommentsCache` /
  `invalidateForumCache`); signed-in viewers are filtered on top of it.
- Each result carries what a list needs: excerpt (plain text, 200 chars), author
  (name, handle, avatar, activity count), counts, reactions, `url` (the item or
  thread, with `#comment-<id>`), and the item title ("on *Post title*").

**API / SDK**
- `GET /api/v1/discussions/query?…` (both features; `kind` decides which must be on)
  → `cms.discussions.query(q)`.
- Shortcuts: `cms.comments.latest(opts)`, `cms.comments.hot(opts)`,
  `cms.forum.threads.latest(opts)`, `cms.forum.threads.hot(opts)` — thin wrappers.

**Template variables** — registered in all three runtimes (site, SSR, mail), listed
in the Variable & Function Reference:
- `{{ for latestComments(5) as c }}…{{ c.author.name }}: {{ c.excerpt }}…{{ endfor }}`
- `{{ for hotThreads(5, window='7d', category='general') as t }}<a href="{{ t.url }}">{{ t.title }}</a> ({{ t.replyCount }}){{ endfor }}`
- `{{ hotComments(3, targetType='post') }}` / `{{ latestThreads(5) }}` with no
  property → whole render through a shared `DiscussionList` component (site) or a
  simple linked list (SSR / email).
- `{{ discussions(sort='top', kind='both', window='30d', limit=10) }}` — the general form.
- `{{ commentCount(post) }}`, `{{ forumThread('slug').replyCount }}`.
- Mail: a newsletter can carry "Hottest threads this week" — the mail runtime
  resolves the same functions for the anonymous viewer (no gated content in email).

**Entity system** — register read-only `comment` and `forum_thread` entity types
with a data provider over this query layer, so an **entity block** or **carousel
entity item** can bind a query (`sort = hot`, `category = general`) and render it
with a content-block template — no bespoke block needed.

## Admin

- **Post editor + Event modal** (comments feature on): a **Comments** group in
  properties — **Enable commenting** (Toggle) and, when on, **Allow anonymous
  comments** (Toggle, with a hint that they are held for approval when that setting is
  on) + **Lock comments**. Saved via `PUT /comments/settings/post/:id`. Shows the
  comment count with a link to the moderation view filtered to this item.
- **Comments** sidebar item (comments feature): `/admin/comments` — moderation queue
  (Pending · Reported · All, filter by item / user, bulk approve/hide/delete) with a
  **Settings** button → `/admin/comments/settings`.
- **Forum** sidebar section (forum feature): `/admin/forum` — threads table (category,
  status, pinned/locked, replies, last activity; actions pin, lock, move, hide, delete),
  `/admin/forum/categories` (CRUD + drag order + read/post minimum tier), the shared
  moderation queue filtered to forum posts, and a **Settings** button in the header →
  `/admin/forum/settings`: forum title, URL (default `/forum`, validated against
  reserved paths and page slugs like `eventsUrl`), who can read (public / signed-in /
  tier ≥ N), who can start threads / reply, approve new members' first posts,
  threads per page, posts per page, reactions on/off, show activity counts.
- **User detail** (`/admin/users/:id`): activity counts + recent comments, link to the
  public member page.

## Public site

- `components/discussions/` — `CommentsSection` (count, sort Newest/Oldest/Top, composer,
  tree, "load more"), `CommentItem` (author card, body, edited marker, reactions,
  Reply / Edit / Delete / Report), `CommentComposer` (Markdown textarea + preview;
  signed-out → "Log in to comment" opening `LoginModal`, or the guest name field when
  the item allows anonymous), `AuthorCard` (avatar, display name → `/members/:handle?tab=comments`,
  role/tier badge, **activity count**, joined date). Shared by comments and the forum.
- **Post page** and **Event detail**: `CommentsSection` at the bottom when enabled for
  that item (and the viewer passes the item's gate).
- **Forum**: `/forum` (categories with thread/post counts + latest thread),
  `/forum/:category` (pinned first, then by last reply; New thread), `/forum/:category/:thread`
  (opening post + replies, paginated; Reply; locked notice). Same `AuthorCard`.
- **Member page** `/members/:handle`: header (avatar, name, joined, activity count,
  tier badge) and tabs **Overview** · **Comments** (`?tab=comments`): that user's
  visible comments and forum posts across the site, newest first, each with the item
  it was on ("on *Post title*", "in *Forum › Thread*"), filtered by what the viewer may
  see. Hidden profile → 404.
- **Profile** (`/profile`): Handle (editable), "Show my public member page",
  notification opt-outs, link to "View my public page".

## SEO / SSR

- `ssr/staticMeta.ts`: meta for `/forum`, categories, threads (title + first 160 chars
  of the opening post), `/members/:handle` (`noindex` by default — member pages are
  thin and personal).
- Thread pages SSR the opening post + first page of replies as indexable HTML when the
  forum is publicly readable; sitemap gains public threads.
- Comments are NOT SSR-rendered in v1 (load client-side) — revisit if wanted for SEO.

## Phases

1. **Engine** — `discussions` feature (+ `hidden` flag, planner `enableDependencies` from
   the client), migrations 132–133, `services/discussions/*`, member handles,
   permissions, DTOs, SDK, cache keys, unit tests (tree building, counters, access,
   rate limits, soft delete rules).
2. **Comments** — migration 134, target registry for post + event, admin toggles in the
   Post editor + Event modal, `CommentsSection` on Post + EventDetail, anonymous flow,
   `/admin/comments` queue + Settings, reply emails + admin notifications.
3. **Member pages** — `/members/:handle` with Overview + Comments tabs, Profile handle
   + visibility, author links everywhere, admin user activity panel.
4. **Forum** — migration 135, admin Forum section (threads, categories, moderation,
   Settings page), public `/forum` pages, forum emails, SSR meta + sitemap.
5. **Discovery** — `services/discussions/query.ts` (latest / hot / top / general),
   `GET /discussions/query` + SDK shortcuts, template functions in the site / SSR / mail
   runtimes + reference docs, `DiscussionList` component, read-only `comment` and
   `forum_thread` entity types for entity blocks and carousels.
6. **Docs** — CLAUDE.md feature entries, `docs/how-it-works/COMMENTS-AND-FORUM.md`,
   in-admin help page, API docs regenerated, MCP tools (list/moderate) if wanted.
7. **Later** — per-item minimum subscription to comment, live updates over WebSocket,
   @mentions, image attachments, comments on custom entity types (UI only — the
   storage already supports it), forum search, user blocking/ignoring.

## Risks / watch

- **Spam** is the main operational risk once anonymous comments exist — keep the
  approval default on, rate limits in Redis (cluster-safe), and the report queue visible.
- **Counter drift** — every status change must go through the service; the nightly
  reconcile is the safety net.
- **Gated content leaking through comments** — every read path (item section, profile
  tab, moderation for non-staff, notification emails) goes through `access.ts`.
- **Handle collisions / impersonation** — handles are unique case-insensitively; display
  names are not unique, so author links always use the handle.
- **Uninstall** — removing Forum with `discussions` kept must delete `forum_thread`
  comments (its `onUninstall` hook), or orphans remain.
