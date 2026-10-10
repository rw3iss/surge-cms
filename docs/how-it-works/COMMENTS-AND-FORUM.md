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
  worker; fail open), a honeypot field, and anonymous comments with more than two links
  held for approval.

## Comments

- **Per item** (Post editor / Event modal → Comments): *Enable commenting*,
  *Allow anonymous comments*, *Lock comments*. Stored in `comment_threads`
  (`/api/v1/comments/threads/:type/:id`).
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
- **Access levels** compare with the subscription tier ranks: anonymous −1, a signed-in
  member 0 (Free), subscribers their tier's rank, staff everything. The forum setting
  (public / members / tier ≥ N) and each category's minimums are checked against it.
- **Approval:** approve everything, or hold a member's posts until they have N approved
  forum posts.

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
| `forum:moderate` | staff |
| `forum:manage` | admins |

All of them can be granted per subscription tier (Settings → Permissions).

## API

| Prefix | Feature | What |
|---|---|---|
| `/api/v1/discussions` | discussions | comments CRUD, reactions, reports, moderation, engine settings, discovery query |
| `/api/v1/comments` | comments | per-item switches, Comments settings |
| `/api/v1/forum` | forum | settings, categories, threads |
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
