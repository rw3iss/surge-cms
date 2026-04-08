# Improvement Audit — 2026-04-08

## 1. Summary

- **Project:** Surge Media CMS
- **Working directory:** /home/rw3iss/Sites/others/surge
- **Total findings:** 14 (UI: 4, styling: 2, architecture: 8)

This audit follows the large admin feature push in commit `91fdb8b`
(SSR, pagination, bulk actions, revisions, scheduled publishing,
auto-save). Many findings are gaps — features that were added to
`PostEditor` but not yet propagated to the other editors that now
share the same hook patterns.

## 2. UI & UX improvements

### UI-1 — Auto-save indicator missing in Page/Form/Campaign editors
- **Location:** `frontend/src/pages/admin/{PageEditor,FormEditor,CampaignEditor}.tsx`
- **Problem:** Only `PostEditor` uses the new `useAutoSave` hook +
  `AutoSaveIndicator`. The other editors silently lose in-progress
  work on tab close or refresh.
- **Proposed fix:** Wire `useAutoSave` with a per-editor draft key
  and mount `<AutoSaveIndicator>` in each header. Clear on successful save.
- **Risk:** Low (purely additive; no behavior change on save).

### UI-2 — Revisions panel missing from PageEditor
- **Location:** `frontend/src/pages/admin/PageEditor.tsx`
- **Problem:** Backend already exposes `/pages/:id/revisions[...]`
  routes, but only `PostEditor` mounts `<RevisionsPanel>`.
- **Proposed fix:** Mount `<RevisionsPanel entityType="page" ... />`
  below the EditorSaveBar when `!isNew()`.
- **Risk:** Low.

### UI-3 — Admin list pages: inconsistent pagination coverage
- **Location:** `frontend/src/pages/admin/{Pages,Campaigns,Forms,Users,Messages,Media}.tsx`
- **Problem:** Only `Posts.tsx` was migrated to `usePaginatedList` +
  `<Pagination>`. Other admin list pages still load the first page
  of records with no UI to reach further pages (backend already
  supports page/limit query params).
- **Proposed fix:** Migrate each page to `usePaginatedList` and
  render `<Pagination>` after the table. Phase B — one-by-one, since
  each page has slightly different filter bars.
- **Risk:** Medium (touches each list page's data loading).

### UI-4 — Bulk action bar inconsistent across list pages
- **Location:** Same as UI-3
- **Problem:** Only `Posts.tsx` exposes bulk selection. The shared
  `useBulkActions` hook + backend `/:entity/bulk` endpoints are
  already in place for pages, campaigns, forms, messages.
- **Proposed fix:** Add checkbox column + bulk bar per list page.
  Could be collapsed into `AdminListPage` component going forward.
- **Risk:** Medium.

## 3. Styling & design system

### STY-1 — AdminLayout.scss is the only home for most admin styles
- **Location:** `frontend/src/pages/admin/AdminLayout.scss` (~2900 lines)
- **Problem:** All admin component styles live in one monolithic file.
  New components added this session (Pagination, RevisionsPanel,
  AutoSaveIndicator) were appended here, making the file harder to
  navigate. Component-scoped files would improve maintainability.
- **Proposed fix:** Split per-feature blocks into
  `components/admin/*.scss` co-located with each component.
  Phase C — mechanical but wide.
- **Risk:** High (lots of cross-references; defer to planned session).

### STY-2 — Mixed `$var` and no CSS custom properties
- **Location:** `frontend/src/styles/variables.scss` + consumers
- **Problem:** Design tokens are SCSS variables only. This means the
  app can't be re-themed at runtime (dark mode, user themes, etc.).
- **Proposed fix:** Publish tokens as both SCSS vars and CSS custom
  properties under `:root`, then consume via `var(--primary-color)`
  where runtime themability matters.
- **Risk:** Medium (Phase B — would unblock dark mode).

## 4. Architecture & code quality

### ARCH-1 — Auto-save key collision risk across "new" editors
- **Location:** `frontend/src/hooks/useAutoSave.ts` +
  `PostEditor.tsx` (`post-draft-new`)
- **Problem:** When the PostEditor is on `/admin/posts/new`, the key
  is `post-draft-new`. Opening a PageEditor on `/admin/pages/new`
  with the same pattern in Phase A would work, but two "new" posts
  in different tabs would overwrite each other.
- **Proposed fix:** Include a per-tab suffix (sessionStorage UUID)
  or merge under a single "new" key keyed by entity type only (ok
  since users rarely draft two new entities of the same type).
  For now, keep the simple key and document the limitation.
- **Risk:** Low (not addressing now).

### ARCH-2 — Posts.tsx doesn't use AdminListPage
- **Location:** `frontend/src/components/admin/AdminListPage.tsx`,
  `frontend/src/pages/admin/Posts.tsx`
- **Problem:** The generic `AdminListPage` component was created to
  consolidate list rendering, but `Posts.tsx` reimplements the
  table + bulk bar + pagination inline. Result: two patterns in
  the codebase — the AdminListPage abstraction and the inline one.
- **Proposed fix:** Either (a) migrate Posts.tsx to AdminListPage,
  or (b) deprecate AdminListPage and standardize on the inline
  pattern used in Posts.tsx. Decide direction in Phase C.
- **Risk:** Medium (design decision).

### ARCH-3 — Revision snapshot size not capped
- **Location:** `backend/src/routes/posts.ts:put /:id`,
  `backend/src/routes/pages.ts:put /:id`
- **Problem:** Each update snapshots the full post/page including
  all content blocks. For heavy posts with many blocks, this can
  grow quickly. Pruning keeps 50 revisions per entity but no size
  cap on each.
- **Proposed fix:** Add a check that skips snapshot creation if
  the diff is trivial (status-only changes, for example). Phase B.
- **Risk:** Low-medium.

### ARCH-4 — Duplicate bulk delete endpoints in messages.ts
- **Location:** `backend/src/routes/messages.ts`
- **Problem:** `messages.ts` now has both the old `/bulk-delete` +
  `/bulk-status` routes and the new unified `/bulk` route.
- **Proposed fix:** Once the frontend stops calling the legacy
  routes, remove them. Defer to `/dead-code` pass.
- **Risk:** Low (defer to dead-code sweep).

### ARCH-5 — `ssr/routes.ts` route resolver will grow long
- **Location:** `backend/src/services/ssr/routes.ts`
- **Problem:** One `resolveRouteMeta(pathname)` function with a
  giant if/else chain for each public route. As new public routes
  are added, this will become unmaintainable.
- **Proposed fix:** Convert to a registry — array of
  `{ test: (path) => boolean, resolve: (path) => Promise<Meta> }`
  entries, iterated in order. Phase B.
- **Risk:** Low-medium.

### ARCH-6 — Global `blockIdCounter` in editors
- **Location:** `frontend/src/pages/admin/PostEditor.tsx`,
  `frontend/src/pages/admin/PageEditor.tsx`
- **Problem:** Both editors declare `let blockIdCounter = 0` at
  module scope, shared across all tabs/navigations. Works today
  but is module state that survives hot reload weirdly.
- **Proposed fix:** Use `nanoid()` (already in the project's
  backend deps — not in frontend yet) or `crypto.randomUUID()`.
- **Risk:** Low.

### ARCH-7 — Cache invalidation duplicated between repos and routes
- **Location:** Multiple route files + `services/cache.ts`
- **Problem:** Every route that writes has a manual
  `cache.invalidateFooCache(id)` call. Easy to forget. Could be
  centralized by making the repo layer invalidate on write, or
  wrapping it in a middleware.
- **Proposed fix:** Phase C — move cache invalidation into repos
  (simpler) so routes don't need to remember it.
- **Risk:** Medium.

### ARCH-8 — Shared types not used for `Revision` on frontend
- **Location:** `frontend/src/components/admin/RevisionsPanel.tsx`
  (local `interface Revision`)
- **Problem:** The backend defines `Revision` in
  `backend/src/repositories/revisions.repo.ts`. The frontend panel
  re-declares its own interface. Drift risk.
- **Proposed fix:** Move `Revision` interface into
  `shared/src/types/content.ts` and import from `@surge/shared`.
- **Risk:** Low.

## 5. Recommended execution plan

### Phase A (low risk, apply automatically)
- **UI-1:** Wire `useAutoSave` + `AutoSaveIndicator` into
  PageEditor, FormEditor, CampaignEditor.
- **UI-2:** Mount `<RevisionsPanel entityType="page">` in PageEditor.
- **ARCH-8:** Move `Revision` interface to `@surge/shared` and
  import it in `RevisionsPanel.tsx`.

### Phase B (medium risk, present for approval)
- **UI-3:** Migrate Pages/Campaigns/Forms/Users/Messages list
  pages to `usePaginatedList` + `<Pagination>`, one at a time.
- **UI-4:** Add bulk action bars to the same list pages.
- **STY-2:** Publish CSS custom properties alongside SCSS vars
  to enable runtime theming.
- **ARCH-3:** Skip revision snapshots for status-only changes.
- **ARCH-5:** Convert SSR route resolver to a registry pattern.
- **ARCH-6:** Replace `blockIdCounter` with `crypto.randomUUID()`.

### Phase C (high risk or architectural, plan separately)
- **STY-1:** Split `AdminLayout.scss` monolith into per-component
  files. Requires careful selector auditing.
- **ARCH-2:** Decide on `AdminListPage` vs inline pattern and
  migrate codebase to one approach.
- **ARCH-4:** Dead-code sweep to remove legacy message bulk routes
  (use `/dead-code`).
- **ARCH-7:** Move cache invalidation into repository layer so
  routes don't need to call `invalidateXCache` manually.
