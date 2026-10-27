# Forum block — in-page forum / live discussion widget

Date: 2026-10-27. Status: DONE (built + deployed 2026-10-27).

## Goal

One `forum` content block (and the `{{ forum(...) }}` template function) that lists forum threads from a query or a
selection, OR shows one thread as a chat stream, and lets visitors post new threads, reply inline and react — so a
page can host a "live" discussion backed by the forum.

## Decisions

- **One block, two modes** (`ForumBlockSettings.mode`): `list` (threads from `binding` on entity type `forum_thread`:
  a selection, or a live query with the existing virtual filters `sort` / `window` / `category`) and `thread` (one
  thread id/slug: opening post + replies, posting = replying). Every display / posting / access option is a block
  setting. Rejected: separate read / post blocks (they would have to share state and a target anyway).
- **Contract in `@sitesurge/types`** — `types/forumBlock.ts` (`normalizeForumBlockSettings`, `forumFeedQueryFor`,
  `forumBlockPostCategory`, `deriveThreadTitle`, feed DTOs) + `template/forumFunctions.ts` (`forumBlockSettingsFrom`,
  `FORUM_BLOCK_KIND`). SDK `cms.forum.feed(query)`.
- **Feed endpoint** `GET /api/v1/forum/feed` (optional auth): threads with their OPENING POST (body html, reactions,
  rights), `lastReplyBy`, per-thread `canReply`, and `postTarget` (the category new posts go to + whether the viewer
  may post there). Sorts: `latest` (last activity = newest reply else posted), `newest` (date posted), `hot`, `top`.
- **Where new threads go**: `postCategory`, else the live query's `category` filter. The forum has no root category,
  so with neither the block cannot post (the editor says so).
- **Inline posting** sends no title; the server derives it from the first line (`deriveThreadTitle`).
- **Hide from forum index** = a CATEGORY property (`forum_categories.hidden_from_index`): left out of the forum index,
  unscoped discovery lists, sitemap and search; its threads open by link and in any block / query naming the category.
- **Anonymous posting** = forum settings `allowAnonymous` (default off) + `anonymousApproval` (default on) +
  permission `forum:post_anonymous`; the block's own `allowAnonymous` only decides whether it OFFERS guest posting.
- **Block visibility** `public | members` is UX (a sign-in placeholder); the server's forum read rules still apply.
- **Live updates** = polling the feed every `refreshSeconds` (default 20) while the tab is visible and nobody is
  typing; new posts animate in. (The admin WebSocket is staff-only; a public live-room socket is a later option.)
- SSR + email render a plain linked list of the threads (anonymous viewer).

## Work

1. Shared contract + SDK — DONE.
2. DONE — Backend: migrations 196 (`forum` block enum) + 197 (`hidden_from_index`), forum settings, feed service + route,
   optional title + guest posting, hidden categories, permission, SSR + mail renderers, backend `forum()` function.
3. DONE — Frontend: `ForumBlock` widget (list / thread, composer modes, inline replies, reactions, live polling,
   animations, members placeholder), editor panel, block registries, `{{ forum() }}` on the site, category + settings
   toggles in the admin forum pages, help pages.
4. Docs (CLAUDE.md, COMMENTS-AND-FORUM.md), test page on production.
