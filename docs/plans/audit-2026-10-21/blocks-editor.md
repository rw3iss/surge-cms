# Audit 2026-10-21 — Area A: Group block, block style system, block editor

Scope: commits since `3770169f` touching the Group layout (Row / Column / Grid,
slot widths → column tracks, style Gap), block style `order`, new-block default
padding, the portaled block options menu, page/post editor autosave / clone /
View / Revert, admin Pages trash, and `createBlock` refusing another page's id.

Status key: **fixed** = implemented + verified · **planned** = documented, not built.

## Findings

### A1. Email Row columns sized to their content, not equal columns — fixed
- **Where:** `packages/api/src/services/mail/blocks/group.ts` (horizontal branch).
- **Problem:** the web lays a Row out as N equal grid columns (or the slot-width
  tracks, 80% / 20% → 80fr 20fr). Email gave the cells no width, so the table
  auto-sized them to their content — a short slot next to a long one came out
  thin. A slot's `width` was applied straight to the cell, so 50% + 30% gave
  50% / 30% cells (web: 62.5% / 37.5%).
- **Fix:** ONE track rule moved to `@sitesurge/types` (`groupColumnTracks` +
  `groupSlotWidth` in `utils/groupLayout.ts`). The web's `groupTracks` formats
  it as `grid-template-columns`; email's new `groupEmailColumnWidths` turns the
  shares into percentages that sum to 100 (fixed lengths stay fixed). Row cells
  get those widths and `table-layout:fixed` when all are percentages.
- **Risk:** medium (changes email output for Row groups — toward the web). Tests:
  `group.test.ts` "group column widths in email".

### A2. Email Grid: a cell's own width overrode its column — fixed
- **Where:** `mail/blocks/group.ts` (grid branch).
- **Problem:** each grid cell carried its slot's width after the equal `pct`, so
  a 90% slot in row 2 broke the fixed-layout columns; the web sizes every row
  from the FIRST row's slot widths and ignores the rest.
- **Fix:** grid cells use `groupEmailColumnWidths(items, columns)` per column;
  the slot width is dropped from row/grid cells (a Column slot keeps it).
- **Risk:** low.

### A3. Switching a Grid to Row / Column silently deleted cells — fixed
- **Where:** `packages/cms/src/components/admin/blocks/types/GroupBlock.tsx`.
- **Problem:** a 3 × 3 grid has 9 slots; choosing Row kept `columns: 3`, so the
  editor trimmed 6 slots and the blocks in them, with no confirm or undo.
- **Fix:** leaving Grid sets `columns` to the grid's slot count (capped at 16),
  so every cell becomes a slot. Row → Grid only adds empty cells.
- **Risk:** low.

### A4. Wrap control did nothing for every new Row — fixed
- **Where:** admin `GroupBlock.tsx`.
- **Problem:** new groups always have `columns`, which makes a Row a column grid
  (`groupColumns`); grids never wrap, so the Wrap select was dead.
- **Fix:** Wrap is shown only for a legacy Row without a column count (a flex row).
- **Risk:** low.

### A5. Group panel polish — fixed
- `columns` read through `groupLayoutOf` (a string / out-of-range value showed a
  wrong selection); unused `FormCheck` import removed; the >12 columns warning
  rendered literal backticks (now `<strong>`); Wrap block re-indented.
- Item min/max width/height use `CommitInput` (commit on blur, per ADMIN_STYLES).
- **Risk:** low.

### A6. Three different "is this a valid order" rules — fixed
- **Where:** `shared/utils/blockStyleCss.ts` (≤ 6 digits via `isCssOrder`),
  `ContentBlock.tsx blockOrderFor` (`/^[+-]?\d+$/`, any length),
  `mail/blocks/_util.ts styleOrder` (any length), `BlockRenderer hasStyleOrder`
  (any non-empty value).
- **Problem:** a 7-digit order moved the block in the admin editor and email but
  not on the site; an invalid value still added `.block--ordered` (turning the
  parent list into a flex column for nothing).
- **Fix:** `parseCssOrder(v): number | null` in `shared/utils/cssSafety.ts`, used
  by all four. Email's sibling comparator is now `bySiblingOrder` (`_util.ts`).
- **Risk:** low. Tests: `cssSafety.test.ts` "parseCssOrder".

### A7. A block could be nested under another page's block, or under its own child — fixed
- **Where:** `packages/api/src/repositories/pages.repo.ts` `createBlock` / `updateBlock`.
- **Problem:** the `parent_block_id` FK only proves the parent exists somewhere.
  A stale editor (the bug fixed in dff45969) or an API client could hang a block
  under another page's group, or make a block its own ancestor — the subtree
  then dropped out of every render (tree assembly never reaches it).
- **Fix:** `assertParentOnPage` — one recursive CTE: the parent must be on the
  same page and the block must not be in the parent's ancestor chain. 400 with a
  clear message otherwise.
- **Risk:** low (one extra query only when a parent is sent). Tests:
  `pages.repo.blockParent.test.ts`.

### A8. Block options menu: no Escape to close — fixed
- **Where:** `ContentBlock.tsx`.
- **Fix:** Escape closes the portaled menu and returns focus to its button.
- **Risk:** low.

### A9. A block moved by style Order gave no hint in the editor — fixed
- **Where:** `ContentBlock.tsx` header label.
- **Problem:** the row shows in its `order` position, but ▲/▼ still change the
  saved position, so the arrows looked broken.
- **Fix:** an "(Order N)" tag beside "(Collapsed)" / "(Disabled)", with a tooltip.
- **Risk:** low.

### A10. Admin Pages trash had no Restore — fixed
- **Where:** `packages/cms/src/pages/admin/Pages.tsx`.
- **Fix:** trashed rows get **Restore** (bulk `status` → `draft`) beside
  **Delete permanently**.
- **Risk:** low.

### A11. Stale / misplaced comments in groupStyle.ts — fixed
- The "Flex-container style" doc block sat above `groupColumns`; moved to
  `groupContainerStyle`. `groupColumns` uses `GROUP_MAX_COLUMNS` instead of a
  literal 16. `slotWidthOf` is now the shared `groupSlotWidth`.

### A12. Page routes ignore the `pages:*` permissions — planned
- **Where:** `packages/api/src/routes/pages.ts`, `services/permissions/catalog.ts`.
- **Problem:** `pages:read|write|publish` are declared but no page route checks
  them — every staff user can edit, publish and permanently delete any page
  whatever Settings → Permissions says. There is no `pages:delete` at all.
- **Fix:** `requirePermission` in the write/publish/delete handlers; add
  `pages:delete` (default STAFF, to keep today's behaviour); hide the admin
  buttons the viewer may not use.
- **Risk:** medium-high (every page route + API keys + the admin UI); needs its
  own change.

### A13. Shrinking a group's columns / rows deletes the trailing slots without a confirm — planned
- **Where:** `BlockEditor.tsx updateBlock`, admin `GroupBlock.tsx`.
- **Problem:** the hint warns, but the select applies at once; the editor has no
  undo. A slot's blocks are lost until the page is reloaded without saving.
- **Fix:** a confirm when the removed slots hold blocks, re-syncing the select on
  cancel (the select is bound to the prop, so the DOM value must be reset).
- **Risk:** medium.

### A14. `.block--ordered` turns ANY parent into a flex column — planned (watch)
- **Where:** `styles/global.scss` `:where(:has(> .block--ordered):not(.block--group))`.
- **Problem:** a container that lays its blocks out itself (e.g. the carousel
  entity slide wrapper) becomes `display:flex; flex-direction:column` once one
  of its blocks has an order; vertical margins also stop collapsing in that list.
  No breakage found in today's containers.
- **Fix if needed:** limit the rule to the known block lists (page/post body,
  `.block__inner`, `.block--group_item`, `.template-block__root`).
- **Risk:** low today.

### A15. View ↗ link follows the unsaved status / slug — planned
- **Where:** `components/admin/editors/EntityEditorShell.tsx`.
- **Problem:** the link uses the form's current status + slug, so after changing
  them without saving it opens a 404 or the wrong mode.
- **Fix:** build the URL from the saved entity.
- **Risk:** low (file outside this area's ownership list).

### A16. Block style Order input accepts values the API refuses — planned
- **Where:** `components/admin/blocks/blockStyles/BlockStyleEditor.tsx` (Order field).
- **Problem:** `isCssOrder` allows at most 6 digits; the field saves any integer,
  so a 7-digit value makes the save fail with 400.
- **Fix:** clamp to ±999999 (or `min`/`max` on the input).
- **Risk:** low (file outside this area's ownership list).

### A17. SSR ignores style `order` and group column widths — known gap
- SSR emits no block CSS (pre-existing, documented); ordered blocks render in
  document order there. No change.

## Verification
- `packages/shared`: `npm test` — 237 passed; rebuilt.
- `packages/cms`: `tsc --noEmit` — only the known errors (SocialBlock,
  CampaignDonations, FormSubmissions); vitest 486 passed.
- `packages/api`: `tsc --noEmit` clean; vitest 1908 passed.

## Lead follow-up (2026-10-21)
- **A13 — DONE.** Lowering a group's columns / rows asks first when a removed slot still holds content (`BlockEditor.updateBlock`); declining keeps the old layout.
- **A15 — DONE.** `EntityEditorShell` View link follows the SAVED status (`e.entity().status`), not the unsaved Status field (the URL already used the saved slug).
- **A16 — DONE.** The Order input is clamped to ±999999 (min/max + on change), matching `parseCssOrder`.
- **Cross-area — DONE.** `mail/templateRuntime.ts` sorts siblings with the shared `bySiblingOrder`.
- A12 (page route permissions / `pages:delete`) and A14 stay planned.
