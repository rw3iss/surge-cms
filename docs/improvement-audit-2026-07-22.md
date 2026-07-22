# Improvement Audit — 2026-07-22

## 1. Summary
- Project: SiteSurge CMS (`@sitesurge/*` monorepo — api / cms / shared / cms-client / cms-mcp)
- Working directory: `/home/rw3iss/Sites/rw/rw-cms`
- Method: three parallel read-only audit passes (recent-work quality, UI/UX + styling, architecture/SOLID) over the block-style + rendering system and recently-touched code.
- Total findings: 22 (recent-work: 7, UI/styling: 13, architecture: 5 — overlapping headline).

Two findings are **live bugs**, not cosmetics:
- **Block-style → CSS mapping is duplicated and drifted** between `BlockRenderer` (public) and `ContentBlock.rteContentStyle` (admin preview) → the admin WYSIWYG silently ignores width/maxWidth/minHeight/height/margin/gap/horizontalAlign and gradient backgrounds.
- **`fontFamily` data-loss**: a font set while saving a block-style *template* is dropped server-side — it exists in cms `BlockStyleData` but not in shared `BlockStyle` / DTO / zod / repo / DB.

## 2. UI & UX improvements
- **U1** Two near-duplicate `Toggle` components (`components/ui/Toggle.tsx` used 2×, `components/admin/common/Toggle.tsx` used 22×) with divergent a11y (`role=switch/aria-checked` vs `aria-pressed`) and SCSS. → unify on one. Risk: med. **Phase C** (touches 22 call sites' semantics).
- **U2** `FeatureToggleRow` is a third hand-rolled switch. → fold into canonical Toggle later. Risk: med. **Phase C**.
- **U3** Repeated muted-centered loading/empty paragraph inline style (`BlockRenderer.tsx:592,709,712,944`) duplicates the purpose-built `.empty-state--plain` / `.form-help-muted`. → use the utility. Risk: low. **Phase A**.
- **U4** `#6b7280` muted-gray fallback hand-duplicated across ~15 TSX spots (= `$text-light`). → route through utilities / standardize var name. Risk: low. **Phase A (admin subset) / B (public+setup)**.
- **U5** `CmsUpdatePanel` badges reimplement the `.badge badge--success/info/muted` system used by `JobManagementPanel`. → reuse `.badge`. Risk: low. **Phase B**.
- **U6** `ServerLogsPanel.tsx:74` error color `var(--admin-text, #b00020)` is semantically wrong (falls back to normal text token, not an error token). → error token. Risk: low. **Phase A**.
- **U7** RTE link dialog Insert/Cancel don't use the `.btn` system (bespoke SCSS + fragile `button:not(.ui-toggle)`). → `.btn` classes. Risk: med. **Phase B**.
- **U8** RTE toolbar buttons: no `:focus-visible` ring (keyboard a11y). → add. Risk: low. **Phase A**.
- **U9** RTE icon-only toolbar buttons have `title` but no `aria-label` (11 buttons). → add `aria-label`. Risk: low. **Phase A**.
- **U10** `Tooltip` trigger uses `role=button` with no key handler + static `aria-label="Help"`. → drop role or add keys; derive label. Risk: low. **Phase B**.
- **U11** Repeated inline `style={{ margin: 0 }}` spacing patches on `.settings-card__title` / `.form-help-muted` across panels. → modifier class. Risk: low. **Phase B**.

## 3. Styling & design system
- **S1** `CmsUpdatePanel` SCSS raw values: `font-size: 12px` → `$font-size-xs`, badge `padding: 2px` → `$spacing-2xs` (`_settings.scss:455,484`). **Phase A**.
- **S2** `RichTextEditor.scss:20` `gap: 2px` → `$spacing-2xs`. **Phase A**.
- **S3** `BlockStyleEditor.tsx/scss` — clean (no inline styles, no hex). No action.

## 4. Architecture & code quality
- **A1 [HEADLINE]** Extract a single pure `blockStyleToCss()` helper (cms util beside `groupStyle.ts`, injecting `colorCssValue`/`fontStack`) consumed by both `BlockRenderer` (public) and `ContentBlock` (admin preview). Closes the drift table (width/margin/gap/horizontalAlign/gradient missing in admin). Not `@sitesurge/types` yet — SSR renders no visual block style. Risk: med (public path). **Phase A/C — applied for admin parity + shared helper**.
- **A2** `fontFamily` end-to-end persistence (shared `BlockStyle` + DTO + zod + repo + migration) — fixes the data-loss drift; then `BlockStyleData = BlockStyle` alias so the two types can't diverge again. Risk: low-med (migration). **Phase B — applied**.
- **A3** `block_styles` persistence fans one property to 5 lists (repo INSERT + repo update-map + zod + DTO + defaults). → single ordered column source. Risk: med (write path). **Phase C (plan)**.
- **A4** `BlockStyleService.withDefaults` + `BlockStyleEditor.handleReset` omit newer fields (`textAlign`/`backgroundPosition`/`fontFamily`/`gap`) → **Reset Styles leaves stale values** (real bug). → drive both from the full key set. Risk: low. **Phase B — applied**.
- **A5** `rteContentStyle` name/JSDoc is RichText-centric but also drives the HTML editor. → rename `resolvedContentStyle`. **Phase A**.

## 5. Recent-work correctness
- **C1** RTE `insertLink` ignores `restoreSelection()` failure → can link the wrong place. → `if (!restoreSelection()) return;`. **Phase A**.
- **C2** `systemUpdate.runUpdate` — no concurrency lock, no `updateAvailable` guard, and unconditional `process.exit(0)` even with no supervisor (dev). → add lock + guard + refuse-to-exit-in-dev safety. Risk: med/high. **Phase B — applied**.
- **C3** `systemUpdate` `PRIMARY_PACKAGE` redundantly re-listed in `CMS_PACKAGES`. → de-dup. **Phase A**.
- **C4** Stale `CLAUDE.md` block-type list (line ~219/221) omits ~9 real types + names removed `SocialMediaBlock`. → doc fix. **Phase A**.

## 6. Execution
- **Phase A (auto-applied):** U3, U4(admin), U6, U8, U9, S1, S2, A5, C1, C3, C4, + the admin-parity half of A1.
- **Phase B (applied under "implement all phases"):** A1 (full shared helper), A2 + A4 (bugs), C2 (self-update safety), U5/U6.
- **Phase C (planned, not applied):** U1/U2 Toggle unification (22 call sites), A3 column-list single-source, U7 RTE `.btn` migration, U10 Tooltip, utils barrel. These deserve a dedicated reviewed change — run `/implement` or `superpowers:writing-plans`.

_Applied-status notes are appended inline as work lands._
