# Improvement Audit — 2026-05-11

## 1. Summary

- **Project:** SiteSurge CMS
- **Working directory:** `/home/rw3iss/Sites/rw/rw-cms`
- **Total findings:** 9 (UI: 3, styling: 2, architecture: 4)
- **Scope:** Focused on the just-shipped Mailing Lists feature (Phases 1–5) and cross-cutting patterns that emerged during its development. Did not re-audit pre-existing parts of the codebase.

The Mailing Lists rollout shipped functionally complete but introduced some local rough edges: broken SCSS `var()` fallbacks (interpolation missing), use of a non-existent `badge--danger` modifier, two near-identical site-palette extraction blocks, and a `populateBlockStyles` helper that already exists once in `pages.repo.ts`. These are clean small wins.

---

## 2. UI & UX improvements

### UI-1: `badge--danger` class doesn't exist
- **Where:** `frontend/src/pages/admin/MailJob.tsx:70,194`, `frontend/src/pages/admin/MailingLists.tsx:32`
- **Problem:** `_buttons-badges.scss` defines `.badge--success`, `.badge--info`, `.badge--muted`, `.badge--warning`, `.badge--error` — I used `.badge--danger` for `cancelled`/`failed` job rows and failed recipients. The badge renders unstyled (just shape, no color), so failed/cancelled rows look identical to subscribed/pending.
- **Fix:** Substitute `badge--error` everywhere.
- **Risk:** low.

### UI-2: MailingListEdit doesn't refresh on save
- **Where:** `frontend/src/pages/admin/MailingListEdit.tsx` `handleSave`
- **Problem:** After saving an existing list, the page keeps the old props in memory — if the operator changed `name` and saves, the header still shows the old name. New lists navigate to the canonical URL (which re-fetches), but edits don't.
- **Fix:** After successful update, re-fetch the list. Or update local signals from the response.
- **Risk:** low.

### UI-3: Job status filter tabs show all four even when no jobs exist
- **Where:** `frontend/src/pages/admin/MailJob.tsx` recipient table header
- **Problem:** Empty job shows "All / Pending / Sent / Failed" tabs but every tab is empty. Minor — not actively wrong, but the empty state could be tighter.
- **Fix:** Hide the tab strip when `totalRecipients === 0`. Defer — low value.
- **Risk:** low. (Skip in Phase A; trivial enough to leave.)

---

## 3. Styling & design system

### S-1: Broken SCSS `var()` fallbacks (16 sites in `_mailing-lists.scss`, 2 in `features.scss`)
- **Where:** `frontend/src/pages/admin/styles/_mailing-lists.scss` lines 43, 46, 52, 105, 125, 147, 159, 162, 183, 196, 211, 265, 292, 295, 297; `frontend/src/components/admin/features/features.scss` lines 23, 80
- **Problem:** Patterns like `color: var(--admin-text, $text-color)` look fine but the SCSS variable doesn't get interpolated inside the `var()` expression — it's emitted verbatim as `var(--admin-text, $text-color)`, which the browser parses as an invalid fallback. Most renderings still work because the custom property is set, but on installs without the admin theme tokens, color falls back to the default property color.
- **Fix:** Wrap in `#{$var}` interpolation everywhere. The 8 already-correct lines in the same file show the convention.
- **Risk:** low. Pure CSS output change.

### S-2: Modal close button (`.modal-close`) styles duplicated
- **Where:** `_mailing-lists.scss` defines `.modal-close`; nothing else in the codebase styles it.
- **Problem:** Generic enough that it should sit beside `.confirm-modal-overlay` in the shared admin modals partial so future modals can reuse it.
- **Fix:** Move the rule to `frontend/src/styles/shared/_modals.scss` (or wherever the shared modal scaffold lives — search first; it's referenced in `ADMIN_STYLES.md`).
- **Risk:** low if there's a clear shared file; medium if it forces creating one. Defer to Phase B if no obvious target exists.

---

## 4. Architecture & code quality

### A-1: Duplicate site-palette extraction (preview + send routes)
- **Where:** `backend/src/routes/mailTemplates.ts:166-176` (preview) and `backend/src/routes/mailSend.ts:53-67` (send)
- **Problem:** Both routes do the same: SELECT all `site_settings`, walk `site_colors` array, build `palette: Record<string, string>`, read `site_name` and `site_url`. ~15 LOC repeated.
- **Fix:** Extract to `backend/src/services/mail/siteContext.ts` exposing a `loadMailRenderContext(): Promise<{ siteName, siteUrl, palette }>`. Both routes import.
- **Risk:** low. Pure extraction, no behavior change.

### A-2: `populateBlockStyles` duplicated between pages.repo and mailTemplateBlocks.repo
- **Where:** `backend/src/repositories/pages.repo.ts:225-246` and `backend/src/repositories/mailTemplateBlocks.repo.ts` (new `populateBlockStyles<T>` I added)
- **Problem:** Identical contract: any block whose `style.id` matches a `block_styles` row gets its style replaced with the template's flat props. My new version is generic (`<T>`); the pages version isn't.
- **Fix:** Promote my generic version to `backend/src/services/blockStyleResolution.ts`. Pages.repo.populateBlockStyles re-exports or calls into it. Risk: pages route hot path, but the function is small and pure.
- **Risk:** medium (touches a page-render hot path). Defer to Phase B.

### A-3: `editorToBackend` / `backendToEditor` block converters duplicated across 3 pages
- **Where:** `frontend/src/components/admin/mail/blockConverters.ts` (new, shared between MailTemplateEdit + MailSend) but `frontend/src/pages/admin/PageEditor.tsx:40-92` and `frontend/src/pages/admin/PostEditor.tsx` each have their own near-identical copies.
- **Problem:** Three implementations of the same conversion, all subtly tracking `__styleRef` vs `styleRef` precedence. If the contract drifts (e.g. a new field), all three need updating.
- **Fix:** Promote `blockConverters.ts` to a top-level shared module (`frontend/src/services/blockConverters.ts` or similar) and have Pages/Posts editors use it.
- **Risk:** medium. Touches two hot pages. Defer to Phase B.

### A-4: `MailingListEdit.tsx` contains an in-file `SubscriberFormModal` component
- **Where:** `frontend/src/pages/admin/MailingListEdit.tsx:307-389` (≈80 LOC inside the same file)
- **Problem:** Other pages keep modals as separate component files (e.g. `SubscriberEditModal.tsx` referenced in the original plan). Inlining makes the page file bigger and harder to navigate.
- **Fix:** Extract to `frontend/src/components/admin/mailing-lists/SubscriberFormModal.tsx`.
- **Risk:** low. Pure file move + import update.

---

## 5. Execution log

### Phase A — applied

- **UI-1** ✅ replaced `badge--danger` with `badge--error` in MailJob.tsx + MailingLists.tsx (3 sites).
- **UI-2** ✅ extracted `refreshList()` helper; `handleSave` now re-fetches after a successful update so the header reflects server-normalized state.
- **S-1** ✅ fixed 18 broken `var()` fallback interpolations in `_mailing-lists.scss` (16) and `features.scss` (2).
- **A-1** ✅ extracted `backend/src/services/mail/siteContext.ts` exposing `loadMailRenderContext()`. Preview + send routes now share the palette/site-name extraction.
- **A-4** ✅ extracted `SubscriberFormModal` to `frontend/src/components/admin/mailing-lists/SubscriberFormModal.tsx`.

### Phase B — applied (user-approved during the same pass)

- **A-2** ✅ consolidated `populateBlockStyles` into `backend/src/services/blockStyleResolution.ts`. `pages.repo` and `mailTemplateBlocks.repo` both delegate to the shared helper. The shared helper strips identity columns (`id`, `name`, `isDefault`, `createdAt`, `updatedAt`) from inlined templates — a small behavior improvement; the old pages.repo version leaked them into the resolved style (renderer ignored them anyway).
- **A-3** ✅ extracted the bug-prone styleRef↔style kernel to `frontend/src/services/blockStyleRef.ts` (`deriveStyleRefFromStyle`, `resolveActiveStyleRef`, `styleRefToPersistedStyle`). PageEditor, PostEditor, and the mail block converters all call into it. Full-converter unification was not done — the wire shapes for `blocks` vs `mail_template_blocks` genuinely diverge (title/content/is_visible columns vs JSONB settings).
- **S-2** ✅ relocated `.modal-close` to `frontend/src/styles/shared/_modals.scss` next to the rest of the modal scaffold. Now uses `var(--admin-text-muted, …)` with proper interpolation and `$spacing-*` tokens.

### Phase C — none

Nothing required deferral.

---

## Docs updated

- `CLAUDE.md` Core Capabilities — added Mailing Lists + Feature Module System bullets so the project doc reflects the new user-visible surfaces.

## Verification

`npm run build` (full repo: shared → backend → frontend → PWA) passed cleanly after each phase. No TypeScript errors. No revert was necessary.

---

## Follow-up sweep — codebase-wide check for the same issue classes

After Phase A + B landed, ran a wider scan for the same bug patterns elsewhere:

- **Non-existent badge variants.** `badge--danger` and `badge--secondary` found in `frontend/src/components/admin/panels/JobManagementPanel.tsx:38,39` (the job-management panel under Settings → Admin). Mapped `--danger → --error`, `--secondary → --muted` to use the palette that actually exists.
- **SCSS `var(--token, $scss-var)` interpolation bug.** Found in `frontend/src/components/admin/forms/forms.scss:74` and `frontend/src/pages/admin/styles/_forms.scss:74` (different partials, same line by coincidence — both define `::placeholder` color). Fixed with `#{$x}` interpolation.
- **Bare `class="modal-overlay"`.** Zero remaining — all admin modals now use `.confirm-modal-overlay`.
- **Duplicate converter / style-resolution logic.** Already caught in A-2 / A-3; no further duplications surfaced in this sweep.

Final state: a full-repo grep for `var\(--[a-z-]+, \$` and `badge--danger|badge--secondary` both return zero hits. Build still green.
