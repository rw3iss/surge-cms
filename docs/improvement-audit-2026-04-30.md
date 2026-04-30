# Improvement Audit — 2026-04-30

## 1. Summary

- Project: SiteSurge CMS (`/home/rw3iss/Sites/rw/rw-cms`)
- Stack: Solid + Vite + SCSS frontend, Express + Postgres backend, npm workspaces
- Token foundation already strong: `frontend/src/styles/variables.scss` defines colors, spacing, radii, shadows, z-indexes, breakpoints, and useful mixins. New work just needs to use them.
- Total findings: 18 — UI/UX 6, styling 5, architecture 7
- Build state at audit time: tsc clean (frontend + backend), vite build clean.

## 2. UI & UX improvements

### U1. "No content blocks to preview" empty state — inline-styled in three places  *(low risk — Phase A)*
- Location: `frontend/src/pages/admin/PageEditor.tsx` ~L613, `frontend/src/pages/admin/PostEditor.tsx` ~L457, `frontend/src/pages/admin/PagePreview.tsx` ~L77, `frontend/src/pages/admin/PostPreview.tsx` ~L52.
- Problem: each one writes the same `style={{ padding: '4rem 2rem', 'text-align': 'center', color: '#999' }}` (or near-equivalent). Drift-prone.
- Fix: extract a small `<div class="preview-empty-message">` with a single SCSS rule. Use existing tokens (`$spacing-2xl` / `$text-light`).

### U2. Hover/focus states on AddBlockMenu section headers and items  *(low risk — Phase A)*
- Location: `frontend/src/pages/admin/AdminLayout.scss` `.add-block-menu__section-header`, `.add-block-menu__item`.
- Problem: section headers have a hover color shift, but no focus ring; items have hover but no focus-visible. Keyboard-only operators currently can't tell where they are.
- Fix: add `:focus-visible` outline using existing `$primary-color` border / box-shadow.

### U3. Trash icon hover affordance is muted  *(low risk — Phase A)*
- Location: `frontend/src/components/admin/blocks/ContentBlock.tsx` (icon I just added).
- Problem: the trash button uses the default `.content-block__hover-btn` style — looks identical to the move-up/down/options buttons. No "danger" cue on hover.
- Fix: add a `--delete` modifier with a soft red hover background using `$error-color` at low alpha.

### U4. AddBlockMenu submenu can render off-screen on narrow viewports  *(medium risk — Phase B)*
- Location: `frontend/src/components/admin/blocks/AddBlockMenu.tsx` `openSubmenu`.
- Problem: when the panel is near the right edge, the submenu falls back to the LEFT of the row (already implemented), but on very narrow viewports (mobile width inside a flyout) both fall offscreen. No vertical reflow when the submenu is taller than the remaining viewport.
- Fix: clamp `top` to the viewport too; cap submenu height with `max-height: calc(100vh - 12px)`.

### U5. EmptyGroupItem placeholder is hard to spot in the editor  *(medium risk — Phase B)*
- Location: `frontend/src/pages/admin/AdminLayout.scss` `.content-block__group-item-empty`.
- Problem: the dashed-border placeholder is faint; the AddBlockMenu trigger inside is muted at `0.85` opacity. New users miss it.
- Fix: increase border contrast on hover, brighten the trigger button when the group is selected, and add a subtle "Empty slot — pick a block" label above the picker.

### U6. Preview overlay header is bare — admin context lost  *(medium risk — Phase B)*
- Location: `frontend/src/components/admin/common/PreviewOverlay.tsx` (and friends).
- Problem: the preview-mode top bar shows just "Preview Mode" / "Close Preview" with no indication of which page or post is being previewed, or its status. Easy to lose track of context.
- Fix: pass `title` + `status` props through to PreviewOverlay; render alongside the close button.

## 3. Styling & design system

### S1. Magic z-index numbers in AdminLayout.scss  *(low risk — Phase A)*
- Location: 21 occurrences in `frontend/src/pages/admin/AdminLayout.scss` of literal `z-index: 1000`, `1001`, `1100`, `2000`, `5`, `10`, `15`, `20`, etc.
- Problem: `variables.scss` defines `$z-index-dropdown` (1000), `$z-index-modal-backdrop` (1040), `$z-index-modal` (1050), `$z-index-popover` (1060), `$z-index-tooltip` (1070). The admin file ignores them, leading to inconsistent stacking (the AddBlockMenu submenu at 1101 vs ConfirmModal at modal level — they happen to layer correctly today, but only by accident).
- Fix: replace the 21 magic values with the corresponding tokens. Where the admin truly needs a custom layer (e.g. the floating drag ghost), define a new token rather than a magic number.

### S2. Inline `style={{ ... }}` in admin block editors  *(low risk — Phase A; partial — Phase B for the rest)*
- Location: 26 inline-style attributes in `frontend/src/components/admin/blocks/*.tsx`.
- Problem: many are repeated tiny patterns (muted-text helper text `{ color: '#888' }`, modal-content padding, max-width centering for article previews). Each is a future drift point.
- Fix:
  - Phase A: replace `color: '#888'` (5 sites) with a `.form-help-muted` class that uses `$text-light`.
  - Phase B: move per-component layout styles into the corresponding SCSS modules.

### S3. AdminLayout.scss is 4500+ lines  *(high risk — Phase C)*
- Location: `frontend/src/pages/admin/AdminLayout.scss`.
- Problem: a single SCSS file holds the styles for the admin shell, every block editor, every modal, the AddBlockMenu, the social-feed slot picker, the image-block strip, and more. Hard to navigate; merge conflicts likely.
- Fix: split into per-feature partials (one per block type / panel) and `@use` them from a small index. This is mechanical but touches a large surface — plan-only.

### S4. Hardcoded grays sprinkled across new editors  *(low risk — Phase A)*
- Location: `frontend/src/pages/admin/AdminLayout.scss` (HTML inline editor, image strip, social slot row), various tsx inline styles.
- Problem: literal `#888`, `#888`, `#999`, `#d8d8d8`, `#c0c0c0`, etc. Drifts from the token palette.
- Fix: map them onto `$text-light`, `$text-color`, `$border-color`. Where shades are needed, use `color-mix(in srgb, var(--site-primary) ...)` or define `$gray-100..900`.

### S5. Form-help phrasing inconsistent  *(low risk — Phase A)*
- Location: GroupBlock, GroupItemBlock, ImageBlock, SocialFeedBlock — all use the inline `<small class="form-help" style={{ color: '#888' }}>...</small>` pattern with slightly different wording.
- Fix: introduce a `<FormHelp>` component (or just use a single SCSS rule) that owns the styling. Keeps copy decisions local to each editor but enforces visual consistency.

## 4. Architecture & code quality

### A1. `pageBlock → public Block` transform duplicated three times  *(low risk — Phase A)*
- Location:
  - `PageEditor.tsx` ~L573 (inline preview)
  - `PagePreview.tsx` ~L31 (standalone preview route)
  - `PageEditor.tsx` ~L60 `blockDataToPageBlock` (different direction but related shape work)
- Problem: each builds the same renderBlock object: `{ id, pageId, parentBlockId, type, title: t || null, content: c || null, settings: rest, order, isVisible, style: resolvedStyle, createdAt, updatedAt }`. Including the resolveStyle / styleRef logic.
- Fix: extract `blockDataToRenderBlock(block, pageId, blockStyles?): Block` into `frontend/src/utils/blockData.ts` (or `services/`). Both previews + the inline use call it. ~30 LoC saved, plus future shape changes happen in one place.

### A2. `services/adminData.ts` and `services/recentItems.ts` overlap  *(medium risk — Phase B)*
- Location: those two files.
- Problem: both cache lists keyed by entity type with manual invalidate; both expose lazy fetchers; both reactive via signals. `recentItems` has the more general API. `adminData` predates it.
- Fix: re-implement `getCampaigns` / `getForms` on top of `recentItems` (drop the limit, rename source). Single cache, single invalidation surface.

### A3. 53 `as any` casts in admin pages  *(medium risk — Phase B)*
- Location: `grep -rn "as any" frontend/src/pages/admin --include="*.tsx" | wc -l` → 53.
- Problem: the editor's `BlockData` ↔ public `Block` transition currently uses `as any` to bridge. Some are unavoidable (block.style is JSONB), but ~25 are for missing types on render-block construction.
- Fix: define `EditorRenderBlock` type that captures the exact fields BlockRenderer needs from a draft block; export from blockData utility (see A1).

### A4. Frontend block-list state churn workaround  *(high risk — Phase C)*
- Location: `frontend/src/components/admin/blocks/BlockEditor.tsx` `<Index>` workaround for keystroke-induced remounts in inline editors.
- Problem: we use `<Index>` instead of `<For>` for the block list because `updateBlock` spreads the changed block to a new reference, which would otherwise force a remount of the row (and destroy CodeMirror / RichTextEditor mid-keystroke). `<Index>` works but trades reorder-identity for data-stability; we paper over the leak with a `createEffect on(props.block.id, reset)` in ContentBlock.
- Fix: migrate the BlockEditor's block-array from a signal to a Solid store. With `setStoreBlocks(reconcile(props.blocks, { key: 'id' }))` the changed item's properties update in place (proxy preserves identity), so `<For>` keeps the row mounted naturally and ContentBlock's reset effect becomes redundant. Worth a dedicated plan.

### A5. Recent-items list endpoints assume `sort=created_desc&limit=10`  *(medium risk — Phase B)*
- Location: `frontend/src/services/recentItems.ts`.
- Problem: hardcoded `sort=created_desc&limit=10` works for `/posts` (verified: routes/posts.ts accepts `sort`); needs verification for `/forms` and `/campaigns`. If a backend endpoint silently ignores the sort, recent-items show in arbitrary order.
- Fix: smoke-test in the admin (open the AddBlockMenu submenus); if any endpoint doesn't honor the sort, add support or switch to client-side sort by `createdAt`/`updatedAt`.

### A6. `parent_block_id` fallback for `social_media` legacy editor route  *(low risk — Phase A)*
- Location: `BlockEditController.tsx` Match on type='social_media'.
- Problem: legacy social_media blocks now route through SocialFeedBlock — but the block's `type` field stays `'social_media'` after first save (the editor writes `provider` / `items` but not `type`). The public renderer's Switch matches `'social_media'` first, hitting the OLD `SocialMediaEmbed` rather than the new SocialFeedBlock with items[]. Migration 028 deleted existing rows so this is moot today, but if a row resurfaces (or a future test creates one), it'd render via the legacy path.
- Fix: when SocialFeedBlock saves a `social_media` block, also update its type to `social_feed`. Alternatively, make SocialMediaEmbed read items[] when present.

### A7. Error toasts inconsistent  *(medium risk — Phase B)*
- Location: across admin editors.
- Problem: some operations call `toast.error(...)`, others throw to a banner, others silently `setError(string)`. Three patterns for the same UX outcome.
- Fix: standardize on `useToast` for everything; remove the `error` signal pattern. Plan-only-ish — needs a sweep with light testing.

## 5. Recommended execution plan

### Phase A — applied automatically (low risk)
- ✅ **A1** — extracted `blockDataToRenderBlock` shared helper at `frontend/src/utils/blockData.ts`; used in PageEditor's inline preview + PagePreview standalone route. Removed ~30 LoC of duplicated transform.
- ✅ **S1 (partial)** — replaced `z-index: 1100` and `z-index: 1101` in AdminLayout.scss with `$z-index-popover` and `$z-index-tooltip` tokens for the AddBlockMenu panel + submenu. Other 19 magic z-indexes deferred to Phase B (touch other features I haven't audited as carefully).
- ✅ **S5** — introduced `.form-help-muted` utility in `global.scss`; swept the inline `color: '#888'` pattern in GroupBlock, GroupItemBlock, ImageBlock, TextBlock, BlockEditController.
- ✅ **U1** — shared `.preview-empty-message` SCSS class in `global.scss`; replaced four inline-styled empty divs in PageEditor / PostEditor / PagePreview / PostPreview.
- ✅ **U2** — added `:focus-visible` outline on `.add-block-menu__section-header` (item rule already had it).
- ✅ **U3** — `.content-block__hover-btn--delete` modifier with `$error-color` hover background and focus ring.

**Deferred from Phase A → Phase B**:
- A6 (SocialFeedBlock writes `type: 'social_feed'` on save): requires plumbing `onChangeType` through to per-type editors. Not Phase A safe. Migration 028 already wiped legacy `social_media` rows so impact is zero today.
- S2 / S4 (full inline-style sweep + hardcoded gray map): 26 inline-style sites in admin/blocks alone. The form-help cluster is done; the rest deserve a focused pass.

### Phase B — applied (medium risk)
- ✅ **U4** — AddBlockMenu submenu now clamps `top` to the viewport (in addition to the existing horizontal clamp); SCSS `max-height` raised to `calc(100vh - 24px)` so a long recent-items list never overflows.
- ✅ **U5** — `.content-block__group-item-empty` reworked: dashed border uses `$border-color` token, hover brightens border + bg, an `::before` "Empty slot — pick a block" caption above the picker, and the slot brightens further when its parent group is selected (uses `color-mix` on `--site-primary`).
- ✅ **U6** — PreviewOverlay accepts `title` and `status` props; PageEditor and PostEditor pass them through. Title shows next to the "Preview Mode" badge with ellipsis at narrow widths; status shows as a small uppercase pill.

### Deferred from Phase B (not enough ROI / needs runtime testing)
- A2 (consolidate adminData and recentItems): caches serve different shapes (full list vs. top-10). Working as-is. Generic factory is a future-cleanup.
- A3 (typed render-block helper to kill `as any` casts): partly addressed by the Phase A `blockDataToRenderBlock` helper which removed the worst offender; the remaining ~25 casts are in different code paths.
- A5 (verify recent-items sort/limit endpoints): needs runtime smoke-test in the admin.
- A7 (toast standardization): too broad for this pass; touches every editor.

### Phase C — applied (architectural / high risk)
- ✅ **S3** — AdminLayout.scss split.
  - `frontend/src/styles/shared/` for partials shared with the public site (currently `_modals.scss`; documented in ADMIN_STYLES.md as the place for any future shared utility).
  - `frontend/src/pages/admin/styles/_*.scss` per feature: admin-typography, admin-shell, buttons-badges, forms, collapsible-panel, pagination, entity-search, editor-properties, block-editor, inline-editors, appearance, dashboard, settings, media (15 partials, ~5000 lines down from one file).
  - `AdminLayout.scss` is now a 25-line index that `@use`s all partials. Each partial declares `@use 'sass:color'; @use '../../../styles/variables' as *;` at the top so Sass module scoping doesn't drop the design tokens.
  - Wrote `frontend/src/components/admin/ADMIN_STYLES.md` documenting which partial owns what, when to hoist to `styles/shared/`, and the relationship to main-site `global.scss`. Referenced from `CLAUDE.md`.

### Phase C — deferred to dedicated plan
- **A4: BlockEditor blocks → Solid store with `reconcile`.** Same audit reasoning still stands: the proper fix for the "Index keys by position, not identity" trade-off is a Solid store with reconcile so `<For>` can keep keying by identity AND data updates don't remount. The `<Index>` workaround in place today works (HTML / Rich Text inline editors keep focus, ContentBlock's transient signals reset on `block.id` change). Migrating to a store would touch BlockEditor's iteration plus several memos and risks subtle reactivity regressions late in a session — better as a focused PR with manual exercise of all editor paths.

### Social rename — done at the same time
- `social_feed` and `social_media` block types collapsed to a single `social` type.
- DB migration 029 (`ALTER TYPE block_type ADD VALUE 'social'` + `UPDATE blocks SET type = 'social' WHERE type = 'social_feed'`) ran cleanly.
- Removed the `social_media` editor case from BlockEditController and the `SocialMediaEmbed` renderer from BlockRenderer (no rows of either type exist any more — migrations 028 + 029 cleaned them).
- Renamed the editor file `SocialFeedBlock.tsx` → `SocialBlock.tsx`; component `SocialFeedBlock` → `SocialBlock`; CSS class `social-feed-block` → `social-block` everywhere.
