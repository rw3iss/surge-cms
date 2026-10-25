# Admin styles guide

Where admin SCSS lives, when to share with the main site, and how to add
new styles without breaking the rest.

## Booleans — MANDATORY, no raw checkboxes

**Every boolean uses the `Toggle` switch** (`components/ui/Toggle`, re-exported
as `components/admin/common/Toggle`) — never `<input type="checkbox">`.

```tsx
import Toggle from '../common/Toggle';

<Toggle checked={enabled()} onChange={setEnabled} label="Show in navigation" />
```

A **radio group** may use switches too, but prefer restating the choice as
independent toggles where that reads naturally; a set of switches where exactly
one may be on is confusing, so keep a real radio group when the options are
genuinely exclusive and numerous.

**Option lists are switches too** (owner's rule, 2026-10-25): a list of
choices in a form — roles that see a widget, a product's categories, the
fields to collect, the products in an announcement — is one `Toggle` per
option, **switch first, label after, on one row**. Plugin config pages (plain
DOM) get the same switch from `host.ui.form(cfg).toggle()` / `.roles()`.

### The one exception: table row selection

Ticking rows in a data table for a bulk action ("select all", per-row ticks),
the picker rows of a select modal, and a public form's "choose all that apply"
stay `components/ui/Checkbox` (custom-styled, never the browser's own).

### The label is part of the hit area

Clicking a toggle's **words** flips it, exactly as a native checkbox's
`<label>` does. A label that looks clickable and is not reads as broken.

This cannot be a real `<label for>`: the control is a `role="switch"` button,
which is not a labelable element. `Toggle` and `FormField` therefore both route
label clicks through `utils/labelActivation`, which excludes descendants that
own their own click — keyed on **focusability, not tag name**, because the help
tooltip is a `<span tabindex="0">` and flipping a setting because someone
reached for help is worse than an inert label.

`FormField`'s label activates its control too: a switch is toggled, anything
else is focused (focus, not a synthetic click — a click would not open a
`<select>`, and needing two clicks for a dropdown is worse than one). Its label
is a SIBLING of the control rather than its parent, so the native behaviour
never applied there either.

If you place a toggle's label yourself instead of passing `label`, you own the
click handling — prefer passing it.

### Label spacing

`Toggle` lays out switch-first with `gap: 0.5rem`. That reads cramped when the
label is a full sentence rather than two words — widen it on the containing row
(`.my-row .toggle-control { gap: $spacing-md; }`) rather than changing the
shared default, which would shift every one of the 30+ files using it.

## Forms & field labels — MANDATORY, one style everywhere

**Every admin form field uses the `FormField` component** (`components/admin/forms`)
— never a raw `<label>` + `<input>`. `FormField` renders the ONE canonical field
label used across the entire admin: **uppercase, bold (700), small
(`$font-size-xs`), letter-spaced, muted** (`--admin-text-muted`). It supports an
inline help `tooltip` and sub-text `hint`.

```tsx
import { FormField, FormSection } from '../../components/admin/forms';

<FormSection title="Basics">
  <FormField label="Title" tooltip="Shown in listings.">
    <input type="text" value={title()} onInput={e => setTitle(e.currentTarget.value)} />
  </FormField>
</FormSection>
```

- The label style lives in `components/admin/forms/forms.scss` (`.admin-form-field__label`).
  `FormField.tsx` self-imports that scss, so the labels are styled even when the
  component is imported directly (not via the `../forms` barrel).
- Legacy label patterns (`.form-group > label`, `.block-edit-form__field > span`,
  `.block-style-editor__label`, `.admin-field-label`) are broadened to the SAME
  canonical style in `forms.scss` — so old markup matches too. Prefer `FormField`
  for anything new.
- **Do NOT hand-roll a form field with an unstyled `<label>`.** If you catch a
  page doing so (raw labels look large/unstyled), convert it to `FormField`.

## Text inputs — `CommitInput` (commit on blur)

Text, number, date and textarea fields **commit on blur** (and Enter on a
single-line field), never per keystroke. Use **`CommitInput`**
(`components/admin/forms`, exported from the barrel next to `FormField`)
instead of hand-rolling the local-draft pattern:

```tsx
import { CommitInput, FormField } from '../../components/admin/forms';

<FormField label="Height">
  <CommitInput value={props.height} onCommit={(v) => update({ height: v })}
    validate={(v) => (v && !cssLength(v) ? 'Not a CSS length' : null)} />
</FormField>
```

- It keeps a local draft, lifts it through `onCommit`, and syncs an outside
  change only while the field is NOT focused — so a parent re-render never
  moves the caret.
- `validate` returns a message to show under the field (the draft is kept and
  nothing is committed); `multiline` + `commitOnEnter` for a textarea; `trim`
  defaults on for single-line fields; `type="number"` commits the string.
- The one exception is a real search-as-you-type box — it uses `onInput` and
  says so in a comment.
- Editable LISTS of fields belong in `createStore` (patch in place), or `<For>`
  remounts every row on each change and the focused input is lost.

## Multi-select dropdowns

**Picking several values from a known, static list of options uses
`MultiSelect`** (`components/ui/MultiSelect`) — never a hand-rolled list of
`Checkbox` rows or a native multi-`<select>`. Closed, it shows the selection
as removable chips (× on each) or a placeholder; open, it's a popover of
`ui/Checkbox` rows (so still no native checkbox) plus Select all / Clear, with
full keyboard support (`Up`/`Down`, `Space`/`Enter`, `Backspace` to drop the
last chip, `Escape`/outside-click/`Tab` to close).

```tsx
import { MultiSelect } from '../../components/ui';

<MultiSelect
  options={[{ value: 'editor', label: 'Editor' }, { value: 'admin', label: 'Admin' }]}
  value={roles()}
  onChange={setRoles}
/>
```

- Reach for `EntitySearchSelect` instead when the list isn't known up front —
  it's fetched async and the use case is picking ONE record by searching
  (campaigns, forms, posts), not toggling several values from a fixed set.
- Reach for `Select` for a single value from a short static list.
- The selection array is always returned in **options order**, not the order
  things were clicked in — don't re-sort it again downstream.
- Positioning follows the same recipe as `AddBlockMenu` / `AnchoredDropdown`:
  Portal-rendered, placed below the control and flipped above when cramped,
  at `$z-index-popover` so it wins over a modal — this is why it works
  unmodified inside modals and side panels.

## Choosing entity data — MANDATORY, one "Set data…"

Anywhere an editor chooses WHICH records something shows (an entity binding, a template slot, a gallery's items, a posts list, a preview sample), use **`components/admin/entities/DataBindingField`** — never separate "Select…", "Configure query…" or "Pick records…" buttons, and never a bespoke picker modal. It renders a one-line summary + **Set data…** + Clear and opens `EntitySearchSelectModal mode="data"`: ticked records = a selection, none ticked = a live query, with a line saying which will be saved.

- Map your block's settings to a `SlotBinding` for `value` and back in `onChange` (see `blocks/postDataBinding.ts` and the Gallery block) — the stored shape does not have to change.
- `allowMultiple={false}` for a one-record binding, `allowQuery={false}` when only a selection can be stored, `maxRecords` for a cap, `queryFilters`/`querySort={false}` when the consumer cannot store them (don't show controls that are silently dropped).
- Extra per-block options (reorderable chips, a limit, a date window) go in the field's `children`.
- `EntitySearchSelectModal mode="single"` is only for relation fields (pick one record into a form field).

## Sections and field rows — MANDATORY spacing

Every admin settings / edit page uses the SAME structure, and gets its vertical
spacing from `pages/admin/styles/_sections.scss` — never from page-local margins:

```tsx
<section class="admin-section">
  <header class="admin-section__header">
    <h2>Default sender</h2>
    <p class="form-help-muted">One line of help.</p>
  </header>
  <FormField label="From name">…</FormField>        {/* rows stack… */}
  <Toggle label="…" checked={…} onChange={…} />
  <div class="admin-form-row">                       {/* …or sit side by side */}
    <FormField label="Price">…</FormField>
    <FormField label="Frequency">…</FormField>
  </div>
</section>
```

| Gap | Where | Value |
|---|---|---|
| Between sections | `.admin-section + .admin-section` | `$spacing-xl` |
| Between rows (above each label) | every direct child of `.admin-section` / `.admin-section__body` after the first | `$spacing-md` |
| Fields on one row | `.admin-form-row` grid, `align-items: start` (labels line up even if one field has a hint) | `$spacing-md` |

Rules:
- Put rows DIRECTLY in the section (or in one `.admin-section__body`; a legacy `.form-section` wrapper inside a section is treated the same — its own margin/padding/divider are dropped). Don't wrap each field in its own `<div>` with a margin, and don't add `margin-bottom` to fields.
- Side-by-side fields go in `.admin-form-row` (not a hand-rolled flex row), so they align to the TOP: every label on one line, every input on one line, and a field's hint BELOW its own input (it pushes only what is under it). **Never `align-items: end` (or `flex-end`) on a row of fields** — a field with a hint is taller, so bottom alignment lifts its label and input above the rest.
- A button in a row of fields goes in `<FormRowAction>` (`components/admin/forms`): it renders an invisible label-height spacer, so the button sits level with the inputs. (Bottom alignment is fine only for a toolbar of controls WITHOUT hints, e.g. filter dropdowns.) In a narrow side panel (block editor, properties) use the existing `.admin-form-row-2` (130px columns) instead.
- The rules are `:where()` (specificity 0): a page that genuinely needs different spacing overrides them locally — but a NEW page should need nothing.
- Check a new page at a glance: each section heading has clear air above it, and every label has a small gap above it.

## Modals — padding

`ModalShell` (`components/admin/common/ModalShell`) draws the frame, backdrop
and close button only — **it adds no inner padding**. Every modal's root
content element sets `padding: $spacing-lg` (24px) itself and stacks its rows
with `gap: $spacing-md`, e.g.

```scss
.my-modal { padding: $spacing-lg; display: flex; flex-direction: column; gap: $spacing-md; }
```

A modal whose title touches the frame's edge is missing this.

### Focus trap — `useFocusTrap`

`ModalShell` keeps keyboard focus inside the open panel: Tab / Shift+Tab wrap
inside it, and closing returns focus to the element that was focused when it
opened. It uses the shared **`hooks/useFocusTrap`**:

```tsx
import { useFocusTrap } from '../../hooks/useFocusTrap';

let panel: HTMLDivElement | undefined;
useFocusTrap(() => panel, () => props.open);   // second arg optional (default: always on)
```

- Traps form a stack and only the TOP one handles Tab, so a modal opened over
  another (the media viewer over the media picker) keeps focus.
- It does not move focus on open — an autofocused field keeps it; the first Tab
  from outside lands inside the panel.
- A full-screen dialog with its own keydown handler (the gallery lightbox) can
  call `trapTab(root, event)` directly.
- Any dialog built WITHOUT `ModalShell` must use this hook — `aria-modal` alone
  does not stop Tab leaving the dialog.

## Sticky page header

Every edit/list page's `.admin-header` (the title + Save/manage actions row) is
**sticky by default** (`position: sticky; top: 0` over the window scroll, solid
`--admin-page-bg`). Just use `<div class="admin-header">…</div>` — no modifier
needed. Keep primary actions (Save/Delete) in `.admin-header__actions`.

**Edit pages never put their controls at the bottom.** Delete · Cancel · Save go
in the sticky header, in that order — `<EditorSaveBar>` (`admin/common/EditorSaveBar`)
renders exactly those buttons for the header. A long form's Save must stay
reachable without scrolling to the end. Modal footers are the exception.

## File layout

```
frontend/src/styles/
  variables.scss          ← design tokens used everywhere
  global.scss             ← public site base + shared utilities
  shared/                 ← partials used by admin AND main site
    _modals.scss          ← .confirm-modal, .confirm-modal-overlay,
                            .modal-shell* (ModalShell primitive)
    (add new files here when truly shared)

frontend/src/pages/admin/
  AdminLayout.scss        ← slim index; @use's the partials below
  styles/
    _admin-typography.scss ← --admin-font-* CSS custom properties
    _admin-shell.scss      ← .admin-layout / .admin-header / .admin-table*
                            / .admin-form* / .admin-filter-bar / .admin-list-page
    _buttons-badges.scss   ← .btn / .badge / .alert (--error/--success/--warning,
                            each themed from $*-bg/$*-fg/$*-border tokens) / .table-link
                            / .gb-panel (GiveButter campaign-editor panel)
    _forms.scss            ← .form-section / .form-group / .form-row
                            / .form-help / .checkbox-label / .form-actions
                            / .questions-list / .question-card
                            / .options-section / .options-list / .option-row
    _collapsible-panel.scss
    _editor-properties.scss ← .editor-brief / .editor-pill / .editor-properties
                              / .page-editor
                              / .autosave-indicator / .schedule-field
                              / .revisions-panel
    _block-editor.scss      ← .block-editor / .content-block (incl. hover bar
                              + group/group_item recursion) / .add-block-menu
                              / .add-block-dropdown / .block-style-editor
                              / .block-toolbar / .block-* per-type panels
                              / .bec-* (BlockEditController fields)
                              / .site-preview-container
    _inline-editors.scss    ← .html-inline-editor / .rich-text-inline-editor
                              / .image-block-strip / .image-block-source
                              / .social-slot-row / .social-slot-list
                              / .social-post-modal* / .social-picker
                              / .social-media-grid
    _appearance.scss        ← .color-picker / .color-wheel / .appearance-panel
                              / .theme-section / .theme-field
                              / .site-colors-* / .font-manager
    _settings.scss          ← .settings-features / .feature-toggle
                              / .settings-fields / .settings-field
                              / .connection-card / .connections-list
                              / .settings-tabs* / .settings-card / .settings-grid
                              / .settings-general
    _media.scss             ← .media-grid / .media-modal / .media-picker
    _dashboard.scss         ← .dashboard-* / .stat-card / .quick-action-btn
                              / .global-search / .skeleton / .text-muted
    _entity-search.scss     ← .entity-search (popover-based search input)
    _pagination.scss        ← .pagination
    _shop.scss              ← .shop-admin* (dashboard/product editor/orders)
                              / .shopify-banner (Shopify-override notice; themes
                              from the $success-* tokens)
```

## Where to put a new admin style

1. **Is it likely to be useful on the main site too?** Hoist it to
   `frontend/src/styles/shared/` (or, for tiny presentation helpers,
   `frontend/src/styles/global.scss`). Examples already there:
   - `.confirm-modal-overlay`, `.confirm-modal` — shared modal scaffold.
   - `.empty-state` / `.empty-state--plain` — shared "nothing to show"
     state (card default; `--plain` for editor previews & inline blocks).
   - `.form-help-muted` — muted helper text under form inputs.
   When you add to `shared/`, also wire it into `AdminLayout.scss` via
   `@use '../../styles/shared/yourpartial'` and into `global.scss` (or
   the public-site entry that needs it) via the same.

2. **Is it admin-only?** Add it to the partial that owns its feature
   in `pages/admin/styles/`. The naming convention is one partial per
   logical surface (block editor, dashboard, settings…), already
   reflected in the layout above. If a clear partial doesn't exist,
   add a new one and `@use` it from `AdminLayout.scss`.

3. **Avoid `style={{ ... }}` in JSX** for anything more than a one-off
   dynamic value. Repeated inline patterns belong in a partial; the
   common ones (helper text, empty messages, modal scaffolding) already
   have utility classes — use them.

## How partials reference design tokens

Every partial starts with:

```scss
@use 'sass:color';
@use '../../../styles/variables' as *;   // ../../variables in shared/
```

This pulls in `$primary-color`, `$spacing-*`, `$z-index-*`, `$shadow-*`,
the breakpoint mixins, etc. **Do not redefine these locally** — extend
`variables.scss` instead and every consumer benefits.

Hardcoded magic values (`#888`, `1100`, `0.5rem`) should map onto the
token palette: `$text-light`, `$z-index-popover`, `$spacing-sm`. If you
need a shade that doesn't exist yet, add it to `variables.scss` first.

## Relationship to main-site styles

The admin extends the same token foundation as the public site
(`variables.scss`) plus base utilities from `global.scss`
(`.empty-state`, `.form-help-muted`, `.page-wrapper`,
`.rich-text`, etc.). Where a piece of UI logically applies to both
audiences (modals, form-help text, empty states), put it in
`styles/shared/` or `global.scss` and reuse — don't duplicate.

The public site's `Layout` component already loads `global.scss`. The
admin loads `AdminLayout.scss`, which `@use`s `styles/shared/_modals`
and inherits `global.scss` via the public `Layout` component used in
the editor's preview overlay.

## Why this split

`AdminLayout.scss` had grown to ~5000 lines covering admin chrome,
every block editor, every modal, the dashboard, settings, and the
appearance panels. Merge conflicts were frequent, navigation was
slow, and the file fought search tools. The split groups by feature
so adding a new editor surface or panel doesn't require touching a
mile-long file. Two-pass `@use` keeps compile cost flat.

## Quick reference — common selectors

| Need | Use |
|---|---|
| Confirm modal | `<ModalShell>` (components/admin/common) + `.confirm-modal` inner |
| Centered overlay modal | `<ModalShell size onClose showClose>` (`.modal-shell*` in shared/_modals.scss) |
| Empty list state | `.empty-state` (global.scss) |
| Empty preview state | `.empty-state--plain` (global.scss) |
| Muted helper text | `.form-help-muted` (global.scss) |
| Admin button | `.btn .btn--primary / --secondary / --ghost / --small` |
| Status badge | `.badge .badge--success / --warning / --info` |
| Inline form field | `<FormField>` component from `admin/forms/` |
| Section heading | `<FormSection>` component from `admin/forms/` |
| Page wrapper (public) | `.page-wrapper` |
| Generic flex helpers | `@include flex-center;` / `@include flex-between;` |
| Truncate single line | `@include truncate;` |
| Multi-line clamp | `@include line-clamp(N);` |
| Responsive | `@include sm { ... }` / `md` / `lg` / `xl` / `mobile-only` |

## When you change tokens

Editing `variables.scss` propagates to every partial automatically. If
the change is structural (e.g. renaming a token) run
`grep -rln "OLD-TOKEN" frontend/src` to find all consumers before
committing.
