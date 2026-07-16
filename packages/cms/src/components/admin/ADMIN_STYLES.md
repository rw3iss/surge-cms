# Admin styles guide

Where admin SCSS lives, when to share with the main site, and how to add
new styles without breaking the rest.

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
    _buttons-badges.scss   ← .btn / .badge / .alert / .table-link
    _forms.scss            ← .form-section / .form-group / .form-row
                            / .form-help / .checkbox-label / .form-actions
                            / .questions-list / .question-card
                            / .options-section / .options-list / .option-row
    _collapsible-panel.scss
    _editor-properties.scss ← .editor-brief / .editor-pill / .editor-properties
                              / .page-editor / .editor-save-bar
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
