# Admin UI Primitives — Implementation Plan

> **For agentic workers:** This plan is written to be executed with
> **`superpowers:subagent-driven-development`** — each Task below is a
> self-contained unit with exact file paths, real code, a build gate, and a
> commit. Execute tasks **in order** (S7 → S8 → U3 → U2); later tasks assume
> the tokens/utilities added by earlier ones. After every Task run
> `pnpm --filter @sitesurge/admin run build` and only commit on a clean build.
> Respect `packages/cms/src/components/admin/ADMIN_STYLES.md` throughout
> (partial ownership, `@use 'sass:color';` + `@use '.../variables' as *;`
> headers, "shared → `styles/shared/` or `global.scss`, admin-only →
> `pages/admin/styles/_*.scss`").

## Goal

Consolidate four cross-cutting admin UI/styling primitives in
`packages/cms/src` so the same pattern is defined once and reused, killing
drift and one real layering bug:

- **S7 — Z-index scale adoption.** Route every overlay/modal/toast/dropdown
  through the `$z-index-*` scale in `styles/variables.scss` instead of raw
  literals (`9999`/`10000`/`2000`/`999`…). Fixes a live bug: confirm modals
  at `2000` render *below* preview overlays at `9999`.
- **S8 — Flex utilities.** Add token-gap `.u-flex-*` utility classes and
  migrate ad-hoc inline `display:flex` objects (drifting `8px`/`12px`/
  `0.5rem`/`0.75rem` gaps) off inline styles.
- **U3 — Empty-state consolidation.** One shared `.empty-state` (+ a
  `--plain` preview variant), retiring `.preview-empty-message` and bespoke
  per-component `__empty` rules.
- **U2 — Overlay/ModalShell primitive.** A single `ModalShell` component
  (backdrop + centering + click-outside + Escape + optional `.modal-close`)
  replacing the inline `position:'fixed'` overlay pattern reimplemented
  across ~8 files. Migrated incrementally.

## Architecture

- **Tokens are the source of truth.** SCSS `$z-index-*` / `$spacing-*` live in
  `styles/variables.scss`; partials `@use` them. S7 only *adds* two tokens
  (`$z-index-overlay`, `$z-index-toast`) — it does **not** renumber any token
  already referenced by code, so no existing consumer shifts.
- **Shared vs admin-only.** `styles/global.scss` is imported once at the app
  root (`App.tsx:9`) so it is loaded for **both** the public site and the
  admin SPA. Utilities/empty-states that serve both audiences live there;
  the `ModalShell` SCSS lives in `styles/shared/_modals.scss` (already
  `@use`d by `AdminLayout.scss:13`).
- **ModalShell** is a thin SolidJS wrapper (Portal + backdrop + panel +
  dismiss wiring). Call sites keep their own inner markup/classes; only the
  overlay scaffolding is hoisted into the shell.
- **Anchored popovers are out of scope for ModalShell.** `ColorPicker`,
  `EntitySearchSelect`, and `Tooltip` are *anchored* popovers
  (`position:fixed` next to a trigger), **not** centered backdrop overlays —
  ModalShell's centering/backdrop semantics do not fit them. They are handled
  only by S7 (z-index) and explicitly excluded from U2. See U2 notes.

## Tech Stack

- **SolidJS** (`solid-js`, `solid-js/web` `Portal`) — components.
- **SCSS** with the design-token system in `styles/variables.scss` — styles.
- Build/verify: `pnpm --filter @sitesurge/admin run build`.

---

## File Structure

**New files**
- `packages/cms/src/components/admin/common/ModalShell.tsx` — the overlay
  primitive (Task 4 / U2).

**Modified — tokens & utilities**
- `packages/cms/src/styles/variables.scss` — add `$z-index-overlay`,
  `$z-index-toast` (Task 1); no other token renumbered.
- `packages/cms/src/styles/global.scss` — add `.u-flex-*` / `.u-gap-*`
  utilities (Task 2); host the moved `.empty-state` (+ `--plain`) and drop
  `.preview-empty-message` (Task 3).
- `packages/cms/src/styles/shared/_modals.scss` — `.confirm-modal-overlay`
  z-index → token (Task 1); add `.modal-shell*` rules (Task 4).

**Modified — S7 z-index (Task 1)**
- `packages/cms/src/components/admin/common/ConfirmModal.scss`
- `packages/cms/src/components/admin/common/PreviewOverlay.scss`
- `packages/cms/src/pages/admin/styles/_dashboard.scss`
- `packages/cms/src/styles/global.scss` (`.page-loading`)
- `packages/cms/src/components/auth/SessionExpiredModal.scss`
- `packages/cms/src/pages/admin/styles/_admin-shell.scss`
- `packages/cms/src/pages/admin/styles/_media.scss`
- `packages/cms/src/components/layout/Header.scss`
- `packages/cms/src/components/admin/editors/SiteHeaderEditor.scss`
- `packages/cms/src/components/common/toast/Toast.scss`

**Modified — S8 flex (Task 2)**: admin/setup `.tsx` with static-gap inline
flex rows — see the Task 2 table.

**Modified — U3 empty-state (Task 3)**
- `packages/cms/src/pages/admin/styles/_forms.scss` (remove base
  `.empty-state`, moves to global)
- Call sites: `PostPreview.tsx`, `PagePreview.tsx`, `PostEditor.tsx`,
  `PageEditor.tsx`, `media/MediaPickerModal.tsx`,
  `blocks/types/CampaignBlock.tsx`, `media/MediaSelectModal.tsx`,
  `editors/SiteFooterEditor.tsx`, `pages/shop/ShopIndex.tsx` (+ their bespoke
  `__empty` SCSS blocks)
- `packages/cms/src/components/admin/ADMIN_STYLES.md` (doc refresh)

**Modified — U2 ModalShell (Task 4)**
- `components/admin/common/ConfirmModal.tsx` (worked example)
- `components/admin/features/FeatureRemoveModal.tsx`,
  `FeatureDependencyModal.tsx`
- `components/admin/media/*` modals, `blocks/HeroContentEditor.tsx` /
  `editors/SiteHeaderEditor.tsx` media-modal usages (mechanical repeats)
- `packages/cms/src/components/admin/ADMIN_STYLES.md` (doc: new primitive)

---

## Task 1 — S7: Z-index scale adoption (pure SCSS, safest)

**Rationale / the bug.** `.confirm-modal-overlay` (`z-index: 2000`) sits
below `.preview-overlay` (`z-index: 9999`), so a confirm dialog opened while
the editor preview takeover is showing renders *behind* it. We add a
dedicated **overlay** tier *below* the modal tier so takeover surfaces
(preview, page-loading) can never cover a modal.

### Files & the exact literal → token mapping

**Step 1.1 — Extend the scale (add two tokens only).**
`packages/cms/src/styles/variables.scss:93-100` — replace the `// Z-index`
block with:

```scss
// Z-index — GLOBAL cross-component layering scale. Component-internal
// stacking (values < 100, e.g. hover bars, drag handles) does NOT belong
// here and is intentionally left alone.
$z-index-dropdown: 1000;        // anchored menus/popovers (color picker, user menu, entity-search)
$z-index-sticky: 1020;          // sticky public site header
$z-index-fixed: 1030;           // fixed app chrome (admin sidebar + hamburger + mobile scrim)
$z-index-overlay: 1035;         // full-screen takeover surfaces: preview overlay, page-loading
$z-index-modal-backdrop: 1040;  // modal dimmer
$z-index-modal: 1050;           // modal panels + fullscreen modal-like takeovers (confirm, media lightbox, command palette, mobile flyout)
$z-index-popover: 1060;         // popovers/menus that must sit ABOVE a modal
$z-index-tooltip: 1070;         // tooltips
$z-index-toast: 1080;           // transient toasts — top of the stack
```

Only `$z-index-overlay` (1035) and `$z-index-toast` (1080) are new; every
pre-existing token keeps its value, so the ~19 partials already referencing
`$z-index-modal`/`-popover`/`-tooltip`/`-dropdown`/`-sticky` are unaffected.

**Step 1.2 — Replace the literals.** Apply this table exactly (each row: open
the file, swap the literal for the token):

| # | File:line | Selector | Literal | → Token | Note |
|---|---|---|---|---|---|
| 1 | `components/admin/common/ConfirmModal.scss:18` | `.confirm-modal-overlay` | `2000` | `$z-index-modal` | fixes the layering bug |
| 2 | `styles/shared/_modals.scss:19` | `.confirm-modal-overlay` | `2000` | `$z-index-modal` | canonical copy of #1 |
| 3 | `components/admin/common/PreviewOverlay.scss:4` | `.preview-overlay` | `9999` | `$z-index-overlay` | takeover, now below modals |
| 4 | `pages/admin/styles/_dashboard.scss:422` | `.global-search-overlay` | `10000` | `$z-index-modal` | command palette = modal tier |
| 5 | `styles/global.scss:205` | `.page-loading` | `9999` | `$z-index-overlay` | takeover |
| 6 | `components/auth/SessionExpiredModal.scss:6` | `.session-expired-overlay` | `9000` | `$z-index-modal` | it is a modal |
| 7 | `pages/admin/styles/_admin-shell.scss:99` | `.admin-layout__overlay` (mobile scrim) | `999` | `$z-index-fixed` | chrome cluster base |
| 8 | `pages/admin/styles/_admin-shell.scss:114` | `.admin-layout__sidebar` | `1000` | `$z-index-fixed + 1` | above its own scrim |
| 9 | `pages/admin/styles/_admin-shell.scss:58` | `.admin-layout__hamburger` | `1002` | `$z-index-fixed + 2` | above the drawer |
| 10 | `pages/admin/styles/_media.scss:153` | `.media-modal` (lightbox) | `1000` | `$z-index-modal` | fullscreen viewer |
| 11 | `components/layout/Header.scss:378` | `.site-header__menu-dropdown` | `1200` | `$z-index-dropdown` | anchored menu |
| 12 | `components/admin/editors/SiteHeaderEditor.scss:216` | `.site-header-preview__ghost` | `9999` | `$z-index-modal` | drag ghost floats above editor UI |
| 13 | `components/common/toast/Toast.scss:5` | `.toast-container` | `$z-index-tooltip` | `$z-index-toast` | toasts belong above tooltips |

Sidebar cluster ordering after the change: scrim `1030` < sidebar `1031` <
hamburger `1032`, all below `overlay 1035` (so the preview covers the sidebar,
as today) and below `modal 1050`.

**Step 1.3 — Explicitly OUT of scope (leave as-is).** These are
component-internal stacking contexts (`< 100`, or a private cluster) that do
not cross component boundaries and must not be forced onto the global scale:
`SiteHeaderEditor.scss:169 (1)`, `SocialEmbed.scss (2/0/1)`,
`PreviewOverlay.scss:18 (1)`, `_media.scss:181 (10)`,
`HeroCarousel.scss:221/257 (2)`, `_admin-shell.scss:531 (40)`,
`_inline-editors.scss:64 (50)`, `_editor-properties.scss:242 (10)`,
`_block-editor.scss (5/2/15/20/10)`, `pages/setup/Setup.scss:127 (100)`.
Do not touch them.

**Step 1.4 — Verify & commit.**
- [ ] `pnpm --filter @sitesurge/admin run build` — clean.
- [ ] Manual grep gate: `grep -rn "z-index: *[0-9]" packages/cms/src --include="*.scss" | grep -vE ": *[0-9]{1,2};"` returns only the deliberately-excluded local values from Step 1.3.
- [ ] Commit: `style(cms): route overlay/modal/toast z-index through the token scale`
  Body:
  ```
  - variables.scss: add $z-index-overlay (1035) + $z-index-toast (1080); no existing token renumbered.
  - Map confirm/session/global-search/media-lightbox/header-drag-ghost overlays → $z-index-modal.
  - Preview overlay + page-loading → $z-index-overlay (now below modal tier, fixing confirm-behind-preview bug).
  - Admin sidebar/hamburger/scrim cluster → $z-index-fixed(+1/+2); toast → $z-index-toast.
  ```

---

## Task 2 — S8: Flex utilities (additive)

**Rationale.** ~13 inline `display:flex` objects recur with drifting gaps
(`8px`/`12px`/`0.5rem`/`0.75rem`). Add token-gap utilities and migrate the
**static-gap admin/setup** rows onto them. **Do not** touch data-driven flex
(where `gap` is a runtime value) in public renderers.

**Gap normalization convention** (state once, apply everywhere):
`0.5rem`/`8px` → default `$spacing-sm` (8px, baked into `.u-flex-*`);
`0.75rem`/`12px` → also normalize to the default `$spacing-sm` (an 8px vs
12px delta is visually negligible and removes a non-token value);
`1rem`/`16px` → add `.u-gap-md` (`$spacing-md`).

### Step 2.1 — Add utilities to `styles/global.scss`

Append after the `.flex-between` helper (`styles/global.scss:149-151`), so
they sit with the existing flex helpers (app-wide, both audiences — per
ADMIN_STYLES.md "tiny presentation helpers → global.scss"):

```scss
// ─── Flex utility classes ───
// Token-gap flex containers that replace ad-hoc inline `display:flex`
// objects with drifting pixel gaps. Default gap = $spacing-sm (8px);
// compose a `.u-gap-*` modifier for other tokens.
.u-flex-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: $spacing-sm;
}

.u-flex-col {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.u-flex-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-sm;
}

// Gap-size modifiers (compose with a .u-flex-* container)
.u-gap-xs { gap: $spacing-xs; }  // 4px
.u-gap-sm { gap: $spacing-sm; }  // 8px
.u-gap-md { gap: $spacing-md; }  // 16px
.u-gap-lg { gap: $spacing-lg; }  // 24px

// Alignment / wrap modifiers
.u-flex-wrap     { flex-wrap: wrap; }
.u-items-start   { align-items: flex-start; }
.u-items-baseline{ align-items: baseline; }
```

### Step 2.2 — Worked example (migrate ONE fully)

`packages/cms/src/pages/Posts.tsx:86`:

```tsx
// before
<div class="page-header" style={{ display: 'flex', 'align-items': 'baseline', gap: '12px', }}>
// after (12px → default 8px per convention)
<div class="page-header u-flex-row u-items-baseline">
```

### Step 2.3 — Mechanical repeats (static-gap admin/setup rows)

Convert each: drop the inline `display/flex-direction/align-items/gap/
flex-wrap` keys → utility classes; **keep any `margin-*` keys inline** (not a
flex concern).

| File:line | Inline shape | → classes | Residual inline |
|---|---|---|---|
| `pages/admin/MessageView.tsx:127` | `flex, gap 0.5rem` | `u-flex-row` | — |
| `pages/admin/FormSubmissions.tsx:127` | `flex, align center, gap 8px, mb 4px` | `u-flex-row` | `'margin-bottom':'4px'` |
| `pages/admin/FormSubmissions.tsx:140` | `flex, gap 1rem, mt 0.5rem, wrap` | `u-flex-row u-gap-md u-flex-wrap` | `'margin-top':'0.5rem'` |
| `pages/setup/Setup.tsx:196` | `flex, gap 12px` | `u-flex-row` | — |
| `components/admin/panels/SitemapPanel.tsx:49` | `flex, align center, gap 12px, wrap` | `u-flex-row u-flex-wrap` | — |
| `components/admin/panels/JobManagementPanel.tsx:54` | `flex, align center, between, mb 8px` | `u-flex-between` | `'margin-bottom':'8px'` |
| `components/admin/settings/ApiKeysPanel.tsx:92` | `flex, gap 8px, align center, mt 8px` | `u-flex-row` | `'margin-top':'8px'` |
| `pages/setup/sections/StorageSection.tsx:111` | `flex, gap 12px, align center` | `u-flex-row` | — |
| `pages/setup/sections/RedisSection.tsx:64` | `flex, gap 12px, align center` | `u-flex-row` | — |
| `pages/setup/sections/EmailSection.tsx:84` | `flex, gap 12px, align center` | `u-flex-row` | — |
| `pages/setup/sections/DatabaseSection.tsx:247` | `flex, gap 12px, align center, mt 8px` | `u-flex-row` | `'margin-top':'8px'` |
| `pages/admin/PageEditor.tsx:346` | `flex, gap 8px, align center` | `u-flex-row` | — |
| `pages/admin/Settings.tsx:372` | `form-actions, mt 1rem, gap 0.5rem, flex` | keep `form-actions`, add `u-flex-row` | `'margin-top':'1rem'` |
| `pages/admin/Settings.tsx:959` | `flex, align center, gap 0.5rem` | `u-flex-row` | — |
| `pages/admin/Settings.tsx:1104` | `flex, align center, gap 0.75rem, wrap` | `u-flex-row u-flex-wrap` | — |
| `pages/admin/PostPreview.tsx:41` | `flex, col, gap 1rem` | `u-flex-col u-gap-md` | — |
| `pages/admin/PostEditor.tsx:525` | `flex, col, gap 1rem` | `u-flex-col u-gap-md` | — |

**Do NOT convert (data-driven gap / public layout renderers):**
`components/blocks/BlockRenderer.tsx:70/275/567` (`gap: s().gap`, runtime),
`components/layout/Header.tsx:152`, `components/layout/Footer.tsx:155/196`,
`components/admin/editors/SiteHeaderEditor.tsx:372`,
`components/admin/editors/SiteFooterEditor.tsx:771/832`,
`pages/admin/Media.tsx:164`, `pages/admin/MessageView.tsx:60` — inspect each;
if `gap`/`flex-direction` derives from a signal/prop or the object mixes
non-flex layout (grid template, width math), leave it inline. Skipping these
is expected, not incomplete.

### Step 2.4 — Verify & commit
- [ ] `pnpm --filter @sitesurge/admin run build` — clean.
- [ ] Spot-check 2-3 migrated pages render with correct spacing (no collapsed rows).
- [ ] Commit: `style(cms): add .u-flex-* utilities; migrate static inline flex rows`
  Body:
  ```
  - global.scss: .u-flex-row/-col/-between + .u-gap-*/.u-flex-wrap/.u-items-* (token gaps).
  - Migrate ~17 static-gap admin/setup rows off inline display:flex; 12px/0.75rem normalized to $spacing-sm, 1rem to .u-gap-md.
  - Data-driven/public-renderer flex left inline (runtime gap).
  ```

---

## Task 3 — U3: Empty-state consolidation

**Rationale.** `.empty-state` (admin-only, `_forms.scss:175`) and
`.preview-empty-message` (global, no background) plus a scatter of bespoke
`__empty` rules all say "nothing to show". Unify on one `.empty-state` (moved
to app-wide `global.scss` so the public shop can use it too) with a `--plain`
variant that reproduces `.preview-empty-message`.

### Step 3.1 — Move `.empty-state` to `global.scss` and add `--plain`

Delete the block at `pages/admin/styles/_forms.scss:174-181` (leave the
`// Empty state` comment removed too). Then in `styles/global.scss`, replace
the `.preview-empty-message` block (`styles/global.scss:475-481`) with:

```scss
/** Shared empty / "nothing to show" state. Card variant (default) for
 *  list pages; `--plain` (no card) for editor previews & inline blocks.
 *  App-wide (imported at App.tsx root) so admin AND public reuse it. */
.empty-state {
  text-align: center;
  padding: $spacing-xl;
  color: $text-light;
  background: $background-dark;
  border-radius: $border-radius-md;

  // Preview / inline variant — no card chrome (replaces
  // the retired .preview-empty-message).
  &--plain {
    padding: $spacing-2xl $spacing-lg;
    background: none;
    border-radius: 0;
    font-size: $font-size-sm;
  }
}
```

`_forms.scss`'s admin-local extensions elsewhere (e.g.
`_mailing-lists.scss:96` nesting `.empty-state`) keep working: `global.scss`
loads first (App.tsx:9), admin partials cascade after.

### Step 3.2 — Retire `.preview-empty-message` call sites

Replace `class="preview-empty-message"` → `class="empty-state empty-state--plain"`:
- `pages/admin/PostPreview.tsx:48`
- `pages/admin/PagePreview.tsx:54`
- `pages/admin/PostEditor.tsx:547`
- `pages/admin/PageEditor.tsx:554`

(Grep `grep -rn "preview-empty-message" packages/cms/src` must return zero
after this step — including SCSS.)

### Step 3.3 — Fold bespoke `__empty` targets onto `.empty-state`

Worked example — `components/admin/media/MediaPickerModal.tsx:69`:
```tsx
// before
<div class="media-picker__empty">No {props.type} files found. Upload some first.</div>
// after
<div class="empty-state">No {props.type} files found. Upload some first.</div>
```
Then delete the now-orphaned `.media-picker__empty` rule if one exists in
`pages/admin/styles/_media.scss` (grep first; only remove if unused).

Mechanical repeats (swap class in TSX; then delete the matching bespoke SCSS
block **only after** confirming no other consumer):
- `components/admin/blocks/types/CampaignBlock.tsx:152` `block-campaign__empty` → `empty-state` (remove rule in `_block-editor.scss` if present)
- `components/admin/media/MediaSelectModal.tsx:150` `media-select-modal__empty` → `empty-state` (remove `MediaSelectModal.scss:108 &__empty`)
- `components/admin/editors/SiteFooterEditor.tsx:606` `footer-editor__empty` → `empty-state empty-state--plain` (remove `SiteFooterEditor.scss:308 &__empty`)
- `pages/shop/ShopIndex.tsx:96` `shop-store__empty` → `empty-state` (public — now valid because `.empty-state` is app-wide; check `pages/shop/shop.scss` `&__empty` is not shared by other shop pages before removing — `ShopCollection/Category/Cart/Checkout/Product` also use `shop-store__empty`, so **keep** the shop.scss rule and only change ShopIndex's class, OR convert all shop-store empties together. Recommended: change only `ShopIndex.tsx` and leave `shop-store__empty` intact for the others; do not delete that shared rule.)

Leave the many other `__empty` selectors (block previews, entity-search,
tooltips, etc.) untouched — they are not in this task's scope and several
carry bespoke layout.

### Step 3.4 — Docs

`components/admin/ADMIN_STYLES.md`:
- File-layout line for `_forms.scss` (lines ~24-26): remove `/ .empty-state`
  from its owned-selectors list.
- "Where to put a new admin style" example list (~line 64): change
  `.preview-empty-message` bullet to `.empty-state` / `.empty-state--plain`.
- Quick-reference table (~line 126): row "Empty preview state" →
  `.empty-state--plain (global.scss)`; add/adjust "Empty list state" →
  `.empty-state (global.scss)`.

### Step 3.5 — Verify & commit
- [ ] `pnpm --filter @sitesurge/admin run build` — clean.
- [ ] `grep -rn "preview-empty-message" packages/cms/src` → zero hits.
- [ ] Commit: `refactor(cms): consolidate empty states on shared .empty-state`
  Body:
  ```
  - Move .empty-state to global.scss (app-wide) + add --plain preview variant; retire .preview-empty-message.
  - Repoint preview/media/campaign/footer/shop-index empties onto .empty-state; drop orphaned bespoke __empty rules.
  - ADMIN_STYLES.md: refresh ownership + quick-reference rows.
  ```

---

## Task 4 — U2: Overlay / ModalShell primitive (most involved, incremental)

**Rationale.** The centered-backdrop overlay (fixed inset-0 dimmer + centered
panel + click-outside + Escape + `.modal-close`) is reimplemented inline in
`ConfirmModal`, `FeatureRemoveModal`, `FeatureDependencyModal`, and the media
modals. Hoist it into one `ModalShell`; migrate call sites one at a time,
preserving each site's dismiss behavior.

**Scope note (accuracy).** `ColorPicker`, `EntitySearchSelect`, and `Tooltip`
are *anchored popovers* (fixed near a trigger, no backdrop, no centering) —
ModalShell does not model them and they are **excluded** here. Their z-index
is already tokenized / handled in Task 1.

### Step 4.1 — SCSS for the shell (`styles/shared/_modals.scss`)

Append to `styles/shared/_modals.scss` (already has the `@use` header +
`.modal-close`). Reuse tokens; overlay uses the Task-1 `$z-index-modal`:

```scss
// ─── ModalShell — generic centered-backdrop overlay primitive ───
.modal-shell-overlay {
    position: fixed;
    inset: 0;
    background: var(--modal-overlay-bg, #{$modal-overlay-bg});
    display: flex;
    align-items: center;
    justify-content: center;
    padding: $spacing-lg;
    z-index: $z-index-modal;
}

.modal-shell {
    position: relative;
    background: $background;
    border-radius: $border-radius-lg;
    box-shadow: $shadow-xl;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;

    &--sm  { max-width: 440px; }
    &--md  { max-width: 640px; }
    &--lg  { max-width: 880px; }
    &--full{ max-width: 90vw; max-height: 90vh; }

    // Top-right close button slot (uses the shared .modal-close styles).
    > .modal-close {
        position: absolute;
        top: $spacing-sm;
        right: $spacing-sm;
    }
}
```

### Step 4.2 — The component (`components/admin/common/ModalShell.tsx`)

```tsx
import { Component, JSX, Show, onCleanup, onMount, } from 'solid-js';
import { Portal, } from 'solid-js/web';

export interface ModalShellProps {
    /** Controls mount/visibility. */
    open: boolean;
    /** Fired on backdrop click, Escape, or the ✕ button. */
    onClose: () => void;
    children: JSX.Element;
    /** Panel width preset. Default 'sm'. */
    size?: 'sm' | 'md' | 'lg' | 'full';
    /** Render the ✕ close button in the panel's top-right. Default false. */
    showClose?: boolean;
    /** Dismiss when the backdrop is clicked. Default true. */
    dismissOnBackdrop?: boolean;
    /** Dismiss on Escape. Default true. */
    dismissOnEscape?: boolean;
    /** Extra class on the panel (keep call-site inner classes working). */
    class?: string;
    /** Accessible label for the dialog. */
    ariaLabel?: string;
}

const ModalShell: Component<ModalShellProps> = (props,) => {
    const size = () => props.size ?? 'sm';
    const backdropDismiss = () => props.dismissOnBackdrop !== false;
    const escapeDismiss = () => props.dismissOnEscape !== false;

    const onKeyDown = (e: KeyboardEvent,) => {
        if (e.key === 'Escape' && props.open && escapeDismiss()) {
            e.stopPropagation();
            props.onClose();
        }
    };
    onMount(() => document.addEventListener('keydown', onKeyDown,),);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown,),);

    return (
        <Show when={props.open}>
            <Portal>
                <div
                    class="modal-shell-overlay"
                    onClick={(e,) => {
                        if (backdropDismiss() && e.target === e.currentTarget) props.onClose();
                    }}
                >
                    <div
                        class={`modal-shell modal-shell--${size()} ${props.class ?? ''}`}
                        role="dialog"
                        aria-modal="true"
                        aria-label={props.ariaLabel}
                        onClick={(e,) => e.stopPropagation()}
                    >
                        <Show when={props.showClose}>
                            <button
                                type="button"
                                class="modal-close"
                                aria-label="Close"
                                onClick={props.onClose}
                            >
                                &times;
                            </button>
                        </Show>
                        {props.children}
                    </div>
                </div>
            </Portal>
        </Show>
    );
};

export default ModalShell;
```

Notes: backdrop click uses `e.target === e.currentTarget` (only the dimmer,
not the panel); panel `stopPropagation` matches the existing
`FeatureRemoveModal`/`FeatureDependencyModal` behavior. Escape is opt-out for
destructive/confirm flows that want to force an explicit choice.

### Step 4.3 — Worked example: migrate `ConfirmModal.tsx`

Rewrite the body of `components/admin/common/ConfirmModal.tsx` to delegate
the overlay to `ModalShell` while keeping its public props and inner
`.confirm-modal__*` classes:

```tsx
import { Show, } from 'solid-js';
import ModalShell from './ModalShell';
import './ConfirmModal.scss';

interface ConfirmModalProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    danger?: boolean;
}

export default function ConfirmModal(props: ConfirmModalProps,) {
    return (
        <ModalShell open={props.open} onClose={props.onCancel} size="sm" ariaLabel={props.title}>
            <div class="confirm-modal">
                <h3 class="confirm-modal__title">{props.title}</h3>
                <p class="confirm-modal__message">{props.message}</p>
                <div class="confirm-modal__actions">
                    <button class="btn btn--secondary" onClick={props.onCancel}>
                        {props.cancelLabel || 'Cancel'}
                    </button>
                    <button
                        class={`btn ${props.danger ? 'btn--danger' : 'btn--primary'}`}
                        onClick={props.onConfirm}
                    >
                        {props.confirmLabel || 'Confirm'}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
}
```

`ConfirmModal.scss` keeps `.confirm-modal` (padding/title/message/actions) but
its `.confirm-modal-overlay` rule is now dead — leave the file but drop the
overlay rule, or leave it (harmless; the `.confirm-modal` panel styles still
apply *inside* `.modal-shell`). Recommended: trim `.confirm-modal-overlay`
from both `ConfirmModal.scss` and `styles/shared/_modals.scss` **only if**
grep shows no remaining `confirm-modal-overlay` consumers after all Step-4.4
migrations. Keep `padding: $spacing-xl` on `.confirm-modal`.

### Step 4.4 — Mechanical repeats

Each: replace the hand-rolled `<Portal><div class="…-overlay" onClick…><div
onClick={stopPropagation}>…` scaffold with `<ModalShell open onClose size
class>`; keep the inner panel markup/classes.

- **`components/admin/features/FeatureRemoveModal.tsx`** — wrap in
  `<ModalShell open onClose={p.onCancel} size="sm" class="feature-dep-modal feature-remove-modal">`.
  This is a destructive type-to-confirm flow: pass
  `dismissOnEscape={false}` is optional (current code allows backdrop-close
  via `onClick={p.onCancel}`, so keep backdrop dismiss default). Remove the
  now-unused `Portal` import.
- **`components/admin/features/FeatureDependencyModal.tsx`** — same wrap with
  `class="feature-dep-modal"`.
- **Media modals** (`components/admin/media/MediaSelectModal.tsx`,
  `MediaUploadModal.tsx`, `MediaPickerModal.tsx` if it renders its own
  overlay) — wrap with `size="full"` and `showClose` where they currently
  render a close ✕; drop the bespoke overlay div. Verify their `.scss`
  `&--container`/`&__close-icon` still apply inside `.modal-shell` (they
  target inner elements, so unaffected).
- **`components/admin/blocks/HeroContentEditor.tsx`** &
  **`components/admin/editors/SiteHeaderEditor.tsx`** — these mount
  `MediaSelectModal`/`MediaUploadModal`; once those use ModalShell, no direct
  change beyond confirming the mounts still open/close. (Their *drag ghosts*
  are `position:fixed` floats, **not** modals — do not wrap.)

Do these one file per commit-able chunk if preferred; each must preserve the
original dismiss affordances (backdrop click + any ✕).

### Step 4.5 — Docs

`components/admin/ADMIN_STYLES.md`:
- Quick-reference table: change the "Confirm modal" row to
  `<ModalShell> (components/admin/common) + .confirm-modal inner`, and add a
  "Centered overlay modal" row → `<ModalShell size onClose showClose>`.
- Note `.modal-shell*` lives in `styles/shared/_modals.scss`.

### Step 4.6 — Verify & commit
- [ ] `pnpm --filter @sitesurge/admin run build` — clean.
- [ ] Manually open: a confirm dialog, the feature-remove modal, and a media
      picker — each centers, dismisses on backdrop click + Escape (except
      where intentionally disabled), and (media) closes via ✕.
- [ ] **Layering check:** open the editor preview overlay, then trigger a
      confirm/media modal from within — the modal must appear *above* the
      preview (validates Task 1 + ModalShell `$z-index-modal`).
- [ ] Commit: `feat(cms): ModalShell overlay primitive; migrate confirm/feature/media modals`
  Body:
  ```
  - New ModalShell (Portal backdrop + centering + click-outside + Escape + optional .modal-close); .modal-shell* in shared/_modals.scss.
  - ConfirmModal delegates overlay to ModalShell (worked example); FeatureRemove/FeatureDependency + media modals migrated.
  - ADMIN_STYLES.md: document the primitive.
  ```

---

## Risks & rollback

- **Z-index reordering changes stacking (Task 1).** The deliberate inversion
  is preview/page-loading (`overlay 1035`) now *below* modals (`1050`) — this
  is the fix, but re-verify: (a) confirm/media modals render **above** the
  editor preview overlay; (b) the admin mobile drawer still shows its scrim
  *behind* the sliding sidebar and the hamburger *above* both; (c) toasts
  appear above tooltips. Rollback = revert the single variables.scss + literal
  commit; nothing else depends on it.
- **ModalShell dismiss regressions (Task 4).** Each call site had subtly
  different dismiss wiring (some backdrop-close via `onClick={onCancel}`, some
  panel `stopPropagation`, ConfirmModal via `e.target===e.currentTarget`).
  ModalShell preserves all three by default; the destructive FeatureRemove
  flow keeps its type-to-confirm gate on the button (unchanged) — only the
  overlay scaffold moves. If a site needs to *block* backdrop/Escape dismiss,
  pass `dismissOnBackdrop={false}` / `dismissOnEscape={false}`. Migrate + test
  one modal per commit so a regression is bisectable.
- **Empty-state move (Task 3).** `.empty-state` moving to `global.scss` relies
  on App.tsx loading global app-wide (verified: `App.tsx:9`). Admin partials
  that *nest* `.empty-state` still cascade after global. Risk: deleting a
  bespoke `__empty` SCSS block still referenced elsewhere — always grep before
  deleting; when shared (e.g. `shop-store__empty`), change only the one call
  site and keep the rule.
- **Build-per-task gate.** Every task ends with
  `pnpm --filter @sitesurge/admin run build`; do not proceed on a red build.

## Self-review checklist

- [ ] `variables.scss` adds **only** `$z-index-overlay` + `$z-index-toast`;
      no existing token value changed (existing `$z-index-modal` etc.
      consumers unaffected).
- [ ] Every row in the Task-1 mapping table applied; excluded local `< 100`
      z-indexes left untouched.
- [ ] `grep -rn "z-index: *[0-9]{3,}" packages/cms/src --include="*.scss"`
      returns no un-tokenized global overlay/modal literals.
- [ ] `.u-flex-*`/`.u-gap-*` added once in `global.scss`; only static-gap
      admin/setup rows migrated; data-driven/public-renderer flex untouched.
- [ ] `grep -rn "preview-empty-message" packages/cms/src` → zero.
- [ ] Deleted bespoke `__empty` rules confirmed unused first; shared ones
      (`shop-store__empty`) kept.
- [ ] `ModalShell.tsx` in `components/admin/common/`; `.modal-shell*` in
      `styles/shared/_modals.scss` (proper `@use` header respected).
- [ ] ConfirmModal migration preserves its public props + inner classes.
- [ ] Each migrated modal preserves original dismiss behavior; destructive
      flows keep their confirm gate.
- [ ] `ADMIN_STYLES.md` updated in the same commits (empty-state ownership +
      quick-ref; ModalShell primitive) — per repo documentation discipline.
- [ ] `pnpm --filter @sitesurge/admin run build` clean after each task; four
      commits, one per task, messages compressed per house style.
