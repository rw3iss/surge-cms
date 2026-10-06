# Phase C Implementation Plan (from improvement-audit-2026-08-12)

Executed autonomously in dependency-ordered waves; each wave builds + tests before the next.

## Wave 1 — Foundations (parallel; no file overlap)
- **A7 Backend registries** (`packages/api` only): `SEARCHABLE_ENTITIES` registry → one generic `searchEntity` (replaces 8 copy-pasted FTS blocks in `services/search.ts`); `SocialProvider` widened with `readCursor`/`writeCursor`/`isSyncEnabled` so `social.ts` `syncPlatform` is provider-agnostic (Twitter special-casing moves into its provider entry); `OAUTH_PROVIDERS` map replaces the throwing switch in `services/oauth/index.ts`. Keep public search shape + social free/paid X behavior identical; `npx vitest run` green.
- **UI kit definition** (`packages/cms/src/components/ui/**` + its scss only): make `.ui-button` a complete, standalone admin button class — sizes `--sm/--md/--lg`, colors `--primary/--secondary/--ghost/--danger/--success/--warning` — styled to match the current admin `.btn` so adoption is near-zero-visual; works on `<button>` AND `<a>`/`<A>`. Add a `Badge` component + `.ui-badge` (variants from `utils/badges`). Confirm `Tabs`/`FormField`/`FormSection` are complete. Report the exact `.btn`→`.ui-button` modifier mapping.
- **DataTable component** (me; new `components/admin/common/DataTable.tsx` + scss): presentational table driven by `usePaginatedList`/`useBulkActions` — `columns` config (`{header, cell, sortField?, width?}`), optional bulk bar + filter bar + pagination + select-all + loading/empty via `LoadingState`/`EmptyState`. No page migration yet.

## Wave 2 — Adoption (sequential / partitioned by disjoint file sets)
- Admin `.btn` → `.ui-button` class sweep (scoped to `pages/admin/**` + `components/admin/**`; public `.btn` untouched), modifier-mapped, build-verified.
- Migrate the core admin list pages to `<DataTable>`.
- Unify `FormField`/`FormSection` onto the `ui/*` kit; migrate the 8 `pages/setup/*` consumers.

## Wave 3 — Verify + ship
- Full dependency-ordered build + 168 API tests + live SSR/checkout spot-checks; commit + deploy.
