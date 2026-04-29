# HTML & Group Blocks — Design

**Date:** 2026-04-29
**Status:** Approved

## Goal

Make the block editor capable of:

1. **Recursive composition** via a new `group` block (with rows or columns) that contains child blocks.
2. **Inline editing in the preview** for Rich Text and HTML blocks — replace the side-panel body editor for these two types with an editor rendered inside the block itself.
3. **Custom HTML enhancements**: code ↔ preview toggle, CodeMirror syntax highlighting, drag-resize with per-block persisted height.

## Non-goals (this spec)

- Cross-group drag-and-drop (re-parenting blocks across groups). Phase-2 stretch goal; the data model supports it but the UI flow is not in this spec.
- Auto-grouping by dragging two top-level blocks into each other.
- Per-group mobile breakpoint overrides — natural flex-wrap is enough; users set `item min/max width` to control wrap thresholds.
- Sanitization of admin-authored HTML — admins are trusted authors, same trust posture as theme/template authoring.

## Schema

One migration: add `parent_block_id` to `blocks`. No other column changes.

```sql
-- migrations/026_add_block_parent.sql
ALTER TABLE blocks
  ADD COLUMN parent_block_id UUID REFERENCES blocks(id) ON DELETE CASCADE;

CREATE INDEX idx_blocks_parent_position
  ON blocks(parent_block_id, position);
```

Conventions:

- Top-level blocks: `parent_block_id IS NULL`. Existing data unaffected.
- `position` is **per-parent**: uniqueness within `(page_id, parent_block_id)` enforced in app code (not a trigger — keeps reorder logic in one place in the SDK).
- New block types added to the type set: `group`, `group_item`. (No DB-level enum exists today; `type` is `text` — nothing to migrate.)
- `ON DELETE CASCADE` means deleting a parent removes all descendants in one statement.

## Repo / SDK changes

`cms.pages.listBlocks(pageId, visibleOnly?)` returns blocks **flat, including `parentBlockId` and `position`**. The frontend assembles the tree. One round-trip, no recursive CTEs needed.

```ts
// before
type BlockRow = { id, pageId, type, data, position, blockStyleId, ... };

// after — one extra field
type BlockRow = { id, pageId, parentBlockId: string | null, type, ... };
```

New / updated SDK methods:

- `cms.pages.createBlock(pageId, data, ctx)` — accepts optional `parentBlockId` in `data`.
- `cms.pages.reorderBlocks(pageId, parentBlockId | null, blockIds, ctx)` — re-orders children of a single parent. Top-level reorder uses `parentBlockId = null`. Phase-1 only handles intra-parent reorders.
- `cms.pages.removeBlock` — already cascades via FK; no extra logic.

Block-style hydration (`findBlocksByPageIdWithStyles`) recurses naturally: it joins on every block regardless of depth.

## Group block

```ts
interface GroupBlockData {
  direction: 'horizontal' | 'vertical';   // default: horizontal
  columns: number;                         // 1-16, default 2
  itemMinWidth?: string;                   // any CSS length, e.g. '200px', '20%'
  itemMaxWidth?: string;
  itemMinHeight?: string;
  itemMaxHeight?: string;
  align?: 'start' | 'center' | 'end' | 'stretch';        // cross axis
  justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
  wrap?: 'wrap' | 'nowrap';                // default 'wrap'
}
```

Block style still applies on top of these (gap, padding, background, typography).

**Container CSS** (rendered both in admin preview and on the public site):

```css
.block--group {
  display: flex;
  flex-direction: row | column;
  flex-wrap: wrap | nowrap;
  align-items: <align>;
  justify-content: <justify>;
  gap: <from block_style.gap>;
}

.block--group_item {
  flex: 1 1 0;
  min-width: <itemMinWidth>;
  max-width: <itemMaxWidth>;
  min-height: <itemMinHeight>;
  max-height: <itemMaxHeight>;
}
```

`columns` controls how many `group_item` children exist; the actual layout width is driven by flex + min/max constraints. On narrow viewports, `flex-wrap: wrap` + `min-width` causes natural collapse to fewer columns.

**Editor settings panel** for a group (in the existing flyout): direction, columns, item min/max width, item min/max height, align, justify, wrap, plus the standard block-style picker. Soft warning shown if `columns > 12`.

**Adding / removing columns**:

- Increasing `columns` → append empty `group_item` children up to the new count.
- Decreasing → ask before deleting the trailing items if any are non-empty. Empty trailing items are deleted silently.

## group_item block

A thin wrapper. Has at most one child block. Its own settings are layout-only:

```ts
interface GroupItemBlockData {
  width?: string;       // overrides parent's itemMinWidth/itemMaxWidth for this slot
  minWidth?: string;
  maxWidth?: string;
  height?: string;
  minHeight?: string;
  maxHeight?: string;
  alignSelf?: 'start' | 'center' | 'end' | 'stretch';
  justifySelf?: 'start' | 'center' | 'end';
}
```

`group_item` participates in the **standard block-style system** — same picker, same templates, same overrides. Reusable templates ("narrow column", "stretch row") work like any other block style.

When empty, the `group_item` renders the same `AddBlockMenu` used at the top level. Selecting a type creates a child block with `parent_block_id = <group_item.id>`. The slot is now "filled".

When filled, the `group_item` renders its child block. Settings panel shows two sections: **Slot settings** (group_item's own data) and **Content settings** (the child block's data).

## Inline editing refactor — Rich Text & HTML

Today, `BlockPreview` renders a static read-only preview; the editor for body content lives in the flyout (`TextBlock.tsx`, etc.). For Rich Text and HTML we move the body editor **into the preview**.

Architecture:

- `BlockPreview` already receives `selected` and admin context. Add a small internal switch: when `block.type ∈ {'rich_text', 'html'}` AND `selected` AND admin mode, render the inline editor; otherwise render the static output.
- The flyout panel for these two types shows everything **except** body content (block style, padding, alignment, visibility, etc.).
- Edits emit through the existing block-dirty flow — typing updates the draft block data; save commits via the same path as flyout-driven edits.

### Rich Text inline

- Toolbar appears directly under the block header when selected; hidden otherwise.
- Editable area is the existing `RichTextEditor` rendered inline.
- Default `min-height: 100px`. Auto-grows with content. No drag handle (Rich Text grows naturally).
- On blur or save, the rendered output replaces the editor when selection moves.

### HTML inline

- Header gains a `</> Code` ↔ `Preview` toggle (segmented control, two states).
- **Code mode**: CodeMirror 6 with HTML language support and the same theme as the rest of admin (light theme, basic syntax). Edits update the draft.
- **Preview mode**: the HTML rendered inside the block-style wrapper, exactly as it would appear on the public site (minus the page's own outer chrome).
- Default height: `200px`. **Drag handle** on the bottom edge resizes the editor (both modes share the height). Resize is admin-only — does not affect public output.
- Persisted in localStorage:
  ```
  key:   sitesurge.editor.blockHeights
  shape: { "<pageId>:<blockId>": 240 }
  ```
  Single key, JSON object. Cleaned up lazily — no eviction job; orphan entries are tiny.
- Public output respects `max-height` from the block style if set (admin drag does not).

CodeMirror 6 is the only new runtime dep added by this work. Languages bundled: HTML (CSS+JS already included in HTML mode). Bundle impact: ~30 kB gzipped. Acceptable.

## Drag-and-drop sorting

Phase-1 scope: **intra-parent** sorting only.

- Top-level blocks already sort today.
- Group children sort within their parent `group_item` slots... wait — group children are `group_item`s themselves, which sort within their parent `group`.
- Inside a filled `group_item`, the single content child is not sortable (there's only one).
- A nested `group` inside a `group_item` shows its own internal sort context — children sort within that nested group.

**Constraint**: drop targets are limited to siblings (same `parent_block_id`). The existing sortable library (used in current top-level reordering and footer editor) supports per-container scoping; each parent group is its own sort container.

**Cross-group moves**: out of scope for this spec. The data model supports it (a re-parent is just `UPDATE blocks SET parent_block_id = ?, position = ?`). UI added in a follow-up.

## Public-side rendering

`BlockRenderer` currently maps a flat block array to JSX. After this change:

- Build a tree from the flat array (one pass, by `parent_block_id`).
- Render top-level (`parent = null`) blocks in order.
- For `group` block: render container with computed CSS, recurse into children (which are `group_item`s).
- For `group_item`: render the wrapper (with slot CSS), recurse into its single child if present. Empty group_items render `null` on public output (placeholders are admin-only).
- For `html` block: render the styled wrapper + raw HTML via `innerHTML` (no sanitization on admin-authored content).
- For all other block types: existing render path.

## Phasing

1. **Schema + plumbing.** Migration 026 (`parent_block_id`); repos and SDK return `parentBlockId`; `BlockRenderer` builds a tree from the flat list and recurses by `parent_block_id`. Group / group_item types are not yet creatable in the editor — only existing block types render, all at depth 0 since no children exist yet. Nothing user-visible; existing pages render identically.
2. **Group + group_item editor.** AddBlockMenu surfaces `Group` option. Flyout settings for group + group_item. In-slot picker. In-group sort. Public render works. Block-styles work for both new types.
3. **HTML enhancements.** CodeMirror, code/preview toggle, drag-resize, localStorage persistence. Strip the body field from the HTML flyout editor.
4. **Rich Text inline.** Toolbar inside preview, editor inline. Strip the body field from the Rich Text flyout editor.

Each phase a separate commit / PR. Phase 2 unblocks the rest; phases 3 and 4 can swap order or run in parallel.

## Risks

- **Recursive renderer correctness** — easy to get re-renders or keying wrong with nested Solid signals. Mitigated by keeping the flat→tree assembly memoized once per block-list change.
- **Sortable scoping** — nested sortable containers can bleed events. The existing footer DnD already handles nested rows/columns; same library / pattern.
- **localStorage growth** — bounded (one entry per HTML block ever opened). Even at 1000 entries per user this is < 50 KB. No eviction needed.
- **Block-style hydration on `group_item`** — the wrapper has its own block_style; need to verify the existing hydration query handles the deeper tree.
- **Migration 026 is additive and safe** — no data backfill, FK cascade is the only behavior change.

## Open items (none blocking)

- Decide later: a "stretch all items to equal width" shortcut on group settings (just sets `align: stretch` + clears item widths). Not blocking, can add anytime.
- Decide later: copy-paste of group_item subtrees across groups. Same data model handles it; UI is the work.
