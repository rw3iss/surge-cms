# Generic Entities & Content-Block Templates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn SiteSurge's bespoke, per-entity architecture into a **generic entity-type
system** (admin-definable types with per-type generated tables) plus a **content-block
template layer** that renders any entity — one, many, or mixed — anywhere the block system
is used (pages, posts, carousels), via the existing `{{ }}` engine.

**Architecture:** A DB-backed **entity-type registry** (`entity_types` + `entity_fields`)
loaded and cached by a backend **EntityManager**; a **table generator** (runtime migrations
under an advisory lock, modeled on `features/migrations.ts` and the plugin ledger) that
creates/alters one real table per type; a **generic repo/service/routes/SDK** parameterized
by `(tableName, fieldSchema)`; a shared **EntityTypeRegistry** that replaces the three
hardcoded template-runtime switches; **content-block templates** modeled on
`mail_templates`/`mail_template_blocks` (an entity-bound, nestable block subtree edited with
the existing `BlockEditor`/`BlockStyleEditor`); and a new **`entity` block type** whose data
binding (context / single / list / query) resolves entities and renders a template subtree
with the entity bound into `templateContext`.

**Tech Stack:** TypeScript everywhere. Backend: Express + raw `pg` + Redis (Valkey), the
`defineRoute`/`registerModule` manifest framework, `base.repo` helpers, zod. Frontend:
SolidJS + Vite + SCSS, the existing block editor + `{{ }}` engine. Shared: `@sitesurge/types`
(pure template engine + DTOs + the new entity contracts). SDK: `@sitesurge/client`
(`ModuleBase`). MCP: `@sitesurge/mcp`.

**Companion analysis:** `docs/superpowers/specs/2026-08-09-generic-entities-and-block-templates.md`
(read it first — current-system ground truth + seam map).

---

## Guiding principles (apply to every task)

- **SOLID + DRY.** One generic implementation over `(tableName, fieldSchema)`; no per-entity
  copy-paste. Reuse the existing `base.repo`, `blockStyleRef`, `populateBlockStyles`,
  `buildBlockTree`, `BlockEditor`, `BlockStyleEditor`, `TemplatedContent`, and the
  `mailTemplateBlocks` replace-all pattern verbatim where possible.
- **TDD.** Every backend module ships with vitest tests (the repo already runs vitest in
  `packages/api`). The critical cores (table generator, generic repo, EntityManager cache,
  data binding, template resolution) are written test-first. Registry/coverage tests guard
  exhaustiveness (mirror `ssr/blocks/blocks.test.ts`).
- **SDK-first.** All new admin UI and all module CRUD go through `@sitesurge/client`
  (`cms.entities.*`, `cms.entityTypes.*`, `cms.contentBlockTemplates.*`). The SDK is the
  test/verification surface for the generic system.
- **No behavior change without intent.** The static block system keeps working byte-for-byte;
  generic/dynamic blocks are additive. Foundational refactors (Phase 0) are behavior-preserving.
- **Delete dead code you touch.** Remove the legacy `style_template_id`/`style_custom` dead
  columns and any switch arms superseded by the registry, once their replacements are proven.
- **Docs in the same phase.** Every phase that changes API/SDK/admin surface updates
  `CLAUDE.md`, `docs/`, `/admin/help`, and the new `docs/sdk/` headless docs.
- **Frequent commits.** One commit per task (or per green test cycle). Deploy to
  surge.ryanweiss.net per the standing workflow once each phase is green.

---

## Data model & contracts (the load-bearing design)

These types live in **`packages/shared/src/entities/`** (new), re-exported from the
`@sitesurge/types` barrel, so backend + cms + SDK + MCP share ONE definition.

### Field types → column mapping

```ts
// packages/shared/src/entities/fieldTypes.ts
export type EntityFieldType =
  | 'text'        // VARCHAR(255)
  | 'longtext'    // TEXT
  | 'richtext'    // TEXT (rendered through {{ }} + sanitizer)
  | 'markdown'    // TEXT
  | 'number'      // NUMERIC
  | 'integer'     // INTEGER
  | 'boolean'     // BOOLEAN
  | 'date'        // DATE
  | 'datetime'    // TIMESTAMPTZ
  | 'enum'        // VARCHAR + CHECK (options in EntityFieldDef.options.values)
  | 'json'        // JSONB
  | 'media'       // UUID (media id) [+ optional FK to media]
  | 'relation'    // UUID (target entity id); options.relationType = target key; many→join table
  | 'slug'        // VARCHAR(255) (unique per type when hasSlug)
  | 'blocks';     // no column — body stored in the shared block store (see Phase 8)

export const FIELD_COLUMN_SQL: Record<Exclude<EntityFieldType,'blocks'>, string>; // mapping table
```

### Entity type + field definitions (stored in DB, cached by EntityManager)

```ts
// packages/shared/src/entities/types.ts
export interface EntityFieldDef {
  id: string;
  key: string;                 // column name (snake_case enforced)
  label: string;
  type: EntityFieldType;
  core: boolean;               // locked: cannot rename/retype/remove (core types only)
  required: boolean;
  unique: boolean;
  indexed: boolean;
  searchable: boolean;         // included in search_vector + generic search
  defaultValue?: unknown;
  options?: {                  // type-specific
    values?: string[];         // enum
    relationType?: string;     // relation target entity key
    relationMany?: boolean;    // many-to-many (join table)
    min?: number; max?: number; pattern?: string;
  };
  position: number;
}

export interface EntityRouting {
  detailEnabled: boolean;  detailPrefix: string;   // e.g. '/recipes' → /recipes/:slug
  indexEnabled: boolean;   indexPrefix: string;    // e.g. '/recipes'
}
export interface EntityCaching {
  indexEnabled: boolean;   indexTtlSeconds: number;
  recordEnabled: boolean;  recordTtlSeconds: number;
}

export interface EntityTypeDef {
  id: string;
  key: string;                 // machine name ('post', 'recipe') — unique
  label: string;               // singular display ('Post')
  labelPlural: string;         // plural display ('Posts')
  singularVar: string;         // template var for single binding ('post')
  pluralVar: string;           // template var for list binding ('posts')
  description?: string;
  origin: 'core' | 'custom';
  internal: boolean;           // core/system: enable/disable only via feature modules
  ownerFeature?: string;       // FeatureKey that scaffolds it (core types)
  tableName: string;           // generated ('ce_recipe') or adopted ('posts')
  hasSlug: boolean; hasStatus: boolean; searchable: boolean; revisioned: boolean;
  routing: EntityRouting;
  caching: EntityCaching;
  // Bespoke admin editor override (core modules point at their existing editors):
  adminListRoute?: string;                 // e.g. '/admin/posts'
  adminEditRoute?: string;                 // template with :id, e.g. '/admin/posts/:id/edit'
  fields: EntityFieldDef[];
  createdAt: string; updatedAt: string;
}

export interface EntityRecord { id: string; slug?: string; status?: string;
  createdAt?: string; updatedAt?: string; [field: string]: unknown; }

export interface EntityQuery {
  filter?: Record<string, unknown>;      // field → value | { op, value }
  search?: string;                        // full-text over searchable fields
  sortBy?: string; sortOrder?: 'asc' | 'desc';
  page?: number; limit?: number;
  status?: string;
}
```

### Content-block templates (modeled on `mail_templates` / `mail_template_blocks`)

```ts
// packages/shared/src/entities/templates.ts
export interface ContentBlockTemplate {
  id: string;
  name: string;
  description?: string;
  entityTypeKey: string | null;   // bound type; null = generic (no entity var)
  mode: 'single' | 'list';        // single entity vs array; drives variable name
  maxRecords?: number | null;     // list mode cap (constrains selection/query limit)
  createdAt: string; updatedAt: string;
}
// content_block_template_blocks == mail_template_blocks shape:
// { id, templateId, parentBlockId, blockType, position, settings, style }
```

### The new `entity` block + its binding

```ts
// packages/shared/src/entities/entityBlock.ts
export type EntityBinding =
  | { mode: 'context' }                                   // bind current route entity
  | { mode: 'single'; ref: string }                       // id or slug
  | { mode: 'list'; refs: string[] }                      // specific ids/slugs (≤ template.maxRecords)
  | { mode: 'query'; query: EntityQuery };                // open query

export interface EntityBlockSettings {
  templateId: string;
  entityType: string;             // redundant-but-cached from the template (for the picker)
  binding: EntityBinding;
}
```

`entity` is added to the `BlockType` union + `ALL_BLOCK_TYPES` + both DB enums. In
carousels, `HeroItem` gains a `type:'entity'` variant carrying `EntityBlockSettings`, so a
carousel item is "a template + a binding" — enabling mixed entity types per carousel.

### The shared EntityTypeRegistry (collapses the 9 template switches)

```ts
// packages/shared/src/entities/registry.ts
export interface EntityKindDescriptor {
  key: string;
  fields: EntityFieldDef[];              // for the generic field renderer + validation
  singularVar: string; pluralVar: string;
  // platform-injected — SDK-backed on cms, service-backed on server:
  getById(id: string): Promise<EntityRecord | null>;
  getBySlug(slug: string): Promise<EntityRecord | null>;
  list(query: EntityQuery): Promise<{ items: EntityRecord[]; total: number }>;
  count(query?: EntityQuery): Promise<number>;
  detailPath?(rec: EntityRecord): string; // for links (replaces hardcoded '/posts/'+slug)
}
export interface EntityTypeRegistry {
  get(key: string): EntityKindDescriptor | undefined;
  all(): EntityKindDescriptor[];
  register(d: EntityKindDescriptor): void;
}
```

The three template runtimes (`cms/services/template/runtime.ts`,
`api/services/ssr/templateRuntime.ts`, `api/services/mail/templateRuntime.ts`) replace their
`switch(name)` with `registry.get(name)?.getById/getBySlug`, and their whole-entity render
switches (`TemplateEntity.tsx`, `entityToHtml`, `entityToMailHtml`) fall back to a **generic
field renderer** driven by `descriptor.fields` when no bespoke component/emitter is registered.

---

## New file map (high level)

```
packages/shared/src/entities/        # NEW — fieldTypes, types, templates, entityBlock, registry, index
packages/shared/src/api/routes/entities.ts   # NEW — DTOs (types + instances + templates)
packages/api/src/entities/           # NEW — EntityManager, tableGenerator, columnMap, coreDescriptors
packages/api/src/repositories/genericEntity.repo.ts   # NEW
packages/api/src/repositories/entityTypes.repo.ts     # NEW (entity_types + entity_fields)
packages/api/src/repositories/contentBlockTemplates.repo.ts  # NEW (+ ...Blocks, modeled on mailTemplateBlocks)
packages/api/src/services/entities.ts                 # NEW (generic instance CRUD + cache)
packages/api/src/services/entityTypes.ts              # NEW (schema CRUD + table gen orchestration)
packages/api/src/services/contentBlockTemplates.ts    # NEW
packages/api/src/services/entityTemplateRuntime.ts    # NEW (server-side registry wiring shared by ssr/mail)
packages/api/src/routes/entities.ts                   # NEW (registerModule 'entities')
packages/api/src/db/migrations/0NN_*.sql              # NEW (entity_types, entity_fields, entity_migrations, content_block_templates[_blocks], block_type enum add)
packages/cms-client/src/modules/entities.ts           # NEW (cms.entities, cms.entityTypes, cms.contentBlockTemplates)
packages/cms/src/services/entityRegistry.ts           # NEW (cms-side EntityTypeRegistry from cms.entityTypes)
packages/cms/src/pages/admin/entities/                # NEW — EntitiesList, EntityDetail (Schema/Data tabs), EntityRecordEdit, TemplateList, TemplateEditor
packages/cms/src/components/admin/entities/           # NEW — EntitySearchSelectModal, SchemaFieldEditor, EntityDataTable, EntityRecordForm, EntityBindingPanel
packages/cms/src/components/blocks/EntityBlock.tsx     # NEW — public renderer for the `entity` block
packages/cms/src/components/blocks/entities/GenericEntityCard.tsx  # NEW — default field renderer
packages/api/src/services/ssr/blocks/entity.ts         # NEW — SSR emitter
packages/api/src/services/mail/blocks/entity.ts        # NEW — mail emitter
docs/sdk/                                               # NEW — headless SDK docs (+ md→html script)
scripts/docs-md-to-html.mjs                            # NEW — transcribe help markdown → html
```

---

## Open decisions — RESOLVE AT KICKOFF (recommendations inline)

These change the plan's shape. My recommendation is first; the user confirms/overrides
before Phase 1. **Items 1, 2, 3, 7 are RESOLVED (2026-08-09) — marked below.**

1. **Core-entity adoption strategy (Phase 8, highest risk). ✅ RESOLVED → FULL MIGRATION.**
   Core types (`post`/`page`/`user`/`campaign`/`form`) are **fully migrated onto the generic
   repo**: their services are rewritten to run through `services/entities.ts`, data is
   reshaped/migrated where columns differ, and the bespoke duplicate paths are deleted — one
   code path, clean end-state. This is deferred to **Phase 8 (Milestone 4)**, so during
   Milestones 1–3 core types are registered as read descriptors whose registry fetchers point
   at the EXISTING services (template resolution stays behavior-identical); Phase 8 swaps those
   fetchers to the generic repo and migrates data, entity-by-entity, live-site-safe.
   *(Rejected: adapt-in-place / permanent coexistence.)*

2. **Blocks per template. ✅ RESOLVED → MULTI-BLOCK SUBTREE.** A template is a full nested
   block subtree (reuse `mail_template_blocks` verbatim). The `entity` block renders the
   template's whole subtree as its children.

3. **How a used template renders in the page. ✅ RESOLVED → NESTED UNDER THE BLOCK.** The
   `entity` block keeps its own wrapper/style/position and renders the template subtree as its
   children via `BlockRenderer` recursion (like a group). *(Rejected: flatten-in-place.)*

4. **Context auto-binding.** On an entity detail page (e.g. a post page), should an `entity`
   block whose `binding.mode='context'` auto-receive that route's entity?
   - **Recommendation: yes** — the route/page already exposes its entity to `templateContext`;
     `context` binding reads it (falls back to empty if absent).

5. **One block type or two.** `entity` (single+list via binding) vs separate `entity`/`entity_list`.
   - **Recommendation: ONE `entity` block**; `binding.mode` + `template.mode` cover single vs
     list. Carousels reuse it via a `HeroItem.type='entity'` variant. Less surface, DRY.

6. **Custom table naming.** `ce_<key>` (recommended, avoids collisions) vs `entity_<key>`.

7. **Milestone sequencing. ✅ RESOLVED → Milestone 1 = Phases 0–5** (foundations → entity
   engine → API/SDK → admin Entities UI → templates → the `entity` block on pages).
   Milestone 2 = **Phase 6** (carousels/mixed). Milestone 3 = **Phase 7** (public entity
   routes). Milestone 4 = **Phase 8** (full core-module migration + posts/pages block-store
   bridge). Docs (Phase 9) fold into each.

8. **Field type set (initial).** Confirm the `EntityFieldType` list above; `relation`/`blocks`
   can land in a later phase if we want to ship faster.

9. **posts-vs-pages block storage.** Bridge now vs Phase 8. **Recommendation: Phase 8**;
   templates work on **pages** first (which already nest), posts once bridged.

10. **SDK shape for templates.** `cms.contentBlockTemplates.*` (recommended, top-level) vs
    `cms.entities.templates.*`.

---

## PHASE 0 — Foundations & behavior-preserving refactors

Small, safe, no user-visible change. De-risks everything after.

### Task 0.1 — Single source of truth for `BlockType` ✅ DONE
**Files:** Modify `packages/shared/src/types/content.ts` (keep the canonical union) · Modify
`packages/cms/src/config/blockTypes.ts` (import `BlockType` from `@sitesurge/types` instead
of redefining) · `packages/shared/src/utils/blockCatalog.ts` (unchanged; still the runtime array).
- [x] Delete the duplicate `BlockType` union in `config/blockTypes.ts`; import + re-export from shared.
- [x] Admin build green (`pnpm --filter @sitesurge/admin build`). Existing coverage tests
  (`blockCatalog`, ssr/mail) unaffected.
- [x] Commit.

### Task 0.2 — Generic entity-ref shape in block settings ✅ DONE
**Files:** Created the FULL shared `packages/shared/src/entities/` module (front-loaded, since
Phases 1–6 depend on it): `fieldTypes.ts` (`EntityFieldType` + `FIELD_COLUMN_SQL`), `types.ts`
(`EntityFieldDef`/`EntityTypeDef`/`EntityRecord`/`EntityQuery`/routing/caching), `templates.ts`
(`ContentBlockTemplate`/`ContentBlockTemplateBlock`), `entityBlock.ts` (`EntityBinding`/
`EntityBlockSettings`), `registry.ts` (`EntityKindDescriptor`/`EntityTypeRegistry` +
`createEntityTypeRegistry`), `index.ts` · `shared/src/index.ts` barrel adds `export * from
'./entities'` · `BlockSettings.entity?` added in `content.ts`.
- [x] All type-only (no runtime consumer yet). shared/api/admin/client builds all green. Commit.

### Task 0.3 — Thread `templateContext` through group/child recursion ✅ DONE
**Files:** `packages/cms/src/components/blocks/BlockRenderer.tsx` (GroupBlock/GroupItemBlock
now accept `ctx?: TplCtx` and pass it to child `BlockRenderer` calls; dispatch site passes
`ctx={props.templateContext}`).
- [x] `GroupBlock`/`GroupItemBlock` thread `templateContext` to their children.
- [x] Admin build green. **Render-level assertion deferred to Phase 5** (first real
  `{{entity}}`-in-group case; cms has no jsdom/testing-library render harness and scaffolding
  one solely for this prop-thread would be scope creep — verified structurally + at build).
- [x] Commit.

### Task 0.4 — SSR walks the block tree ✅ DONE
**Files:** `ssr/blocks/index.ts` (extended `SsrBlockInput` with `id`/`parentBlockId`/`children`;
added `assembleSsrBlockTree` + `renderChildren`; `group`/`group_item` now recurse) ·
`ssr/bodyBuilder.ts` (`PageBody.blocks: SsrBlockInput[]`) · `ssr/routes.ts` (SELECT
`id, parent_block_id …` ordered parent-first, resolve `{{ }}` flat, then assemble the tree).
- [x] **Test:** `blocks.test.ts` — flat `page→group→group_item→rich_text` assembles to a tree
  and the nested rich_text is emitted (was empty). Childless group still emits `''`.
- [x] `vitest` 8/8 green; api build green. Fixes the pre-existing "groups emit nothing in SSR" gap.
- [x] Commit.

### Task 0.5 — Promote `reference.ts` into shared (schema-shaped, generated-ready)
**Files:** Move the machine-readable `ENTITIES` catalog into
`packages/shared/src/entities/reference.ts` as `EntityFieldDef[]`-compatible data; keep
`packages/cms/src/services/template/reference.ts` re-exporting for the editor/help pages.
- [ ] No behavior change; it becomes the seed for core descriptors (Phase 1) and is later
  generated FROM the registry (Phase 2). Commit.

**Phase 0 exit:** union deduped, ctx threads through groups, SSR walks trees, entity-ref types
exist — all with green tests, no user-visible change. Deploy.

---

## PHASE 1 — Entity-type registry + storage engine (backend, no UI)

### Task 1.1 — Migration: registry + ledger tables
**Files:** `packages/api/src/db/migrations/0NN_create_entity_registry.sql`
- [ ] `entity_types` (columns mirroring `EntityTypeDef` scalars + jsonb `routing`/`caching`),
  `entity_fields` (mirroring `EntityFieldDef`, FK→entity_types CASCADE, `UNIQUE(entity_type_id,
  key)`), `entity_migrations` (ledger: `id`, `entity_type_key`, `statement_hash`, `applied_at`).
- [ ] Idempotent (`IF NOT EXISTS`). Add to base `schema.sql` too (fresh-install parity).
- [ ] Commit.

### Task 1.2 — Column mapping + field validation (pure, test-first)
**Files:** `packages/api/src/entities/columnMap.ts`
- [ ] **Tests:** `mapFieldToColumnSql(field)` for every `EntityFieldType`; `validateRecord
  (fields, data)` (required/enum/pattern/min-max/type coercion); slug generation.
- [ ] Implement using `FIELD_COLUMN_SQL`. Green. Commit.

### Task 1.3 — Table generator (runtime migrations under advisory lock)
**Files:** `packages/api/src/entities/tableGenerator.ts`
- [ ] Reuse the `pg_advisory_xact_lock(hashtext($1))` pattern from `features/migrations.ts:52`.
- [ ] `ensureTable(typeDef, client)` → `CREATE TABLE IF NOT EXISTS <tableName> (id uuid pk …,
  standard cols per hasSlug/hasStatus/searchable, + one column per field)`, records each DDL
  statement in `entity_migrations` (hash-guarded, idempotent).
- [ ] `addColumn`/`dropColumn`/`renameGuard` (reject on core fields), `ensureIndexes`
  (indexed/unique/searchable → `tsvector` trigger).
- [ ] **Tests (integration, real pg):** create a `recipe` type → table exists with expected
  columns; add a field → column added; idempotent re-run is a no-op; core-field drop rejected.
- [ ] Green. Commit.

### Task 1.4 — `entity_types`/`entity_fields` repository
**Files:** `packages/api/src/repositories/entityTypes.repo.ts`
- [ ] CRUD over the two tables (using `base.repo` helpers); `findAllWithFields()` (one query
  + assemble), `findByKey`, `upsertType`, `replaceFields`.
- [ ] Tests. Commit.

### Task 1.5 — EntityManager (cached metadata authority)
**Files:** `packages/api/src/entities/entityManager.ts`
- [ ] In-memory cache of all `EntityTypeDef`s (with fields), loaded at boot; `getType(key)`,
  `getField`, `requireType`, `all()`; `invalidate()` on any schema change; optional Redis
  broadcast so multi-instance stays coherent (document a single-instance assumption for now).
- [ ] **Tests:** load, get, invalidate-on-change. Commit.
- [ ] Wire `entityManager.load()` into boot (`index.ts`/`bootRunningMode`).

### Task 1.6 — Core descriptors (adopt existing tables) + feature scaffolding hook
**Files:** `packages/api/src/entities/coreDescriptors.ts` · Modify
`packages/api/src/features/registry.ts` (add `entityTypes?: EntityTypeDef[]` to `FeatureConfig`
and scaffold them in `onEnable`; add `adminListRoute`/`adminEditRoute` on those descriptors).
- [ ] Define `post`/`page`/`user`/`campaign`/`form` descriptors: `origin:'core'`,
  `internal:true`, `ownerFeature`, `tableName` = existing table, fields describing existing
  columns (from `reference.ts`), `adminEditRoute` = existing editor.
- [ ] `scaffoldCoreType(def, client)` = upsert into `entity_types`/`entity_fields` (no CREATE
  TABLE for adopted tables; adopt-in-place per Decision 1A). Called from feature `onEnable`.
- [ ] Seed on boot for already-enabled features (idempotent) so existing installs register.
- [ ] **Tests:** enabling `posts` registers the `post` type; core fields flagged `core:true`.
- [ ] Commit.

**Phase 1 exit:** the DB can hold entity-type definitions; custom types generate real tables;
core types are registered as adopted descriptors; EntityManager serves cached metadata. Deploy.

---

## PHASE 2 — Generic entity API + SDK + template-runtime unification

### Task 2.1 — Generic entity repository (test-first)
**Files:** `packages/api/src/repositories/genericEntity.repo.ts`
- [ ] `list(typeDef, query)` (dynamic WHERE from `filter`, `buildSortClause` over field
  allowlist, `paginatedQuery`, full-text `search` over searchable columns), `getById`,
  `getBySlug`, `create`, `update`, `delete` — all parameterized by `typeDef`
  (tableName + fields), snake↔camel via `mapRow`.
- [ ] **Tests (real pg, using a scratch `recipe` type):** CRUD, pagination, sort allowlist
  (reject unknown), search, unique/slug conflict → typed error.
- [ ] Green. Commit.

### Task 2.2 — Generic entity service (validation + caching)
**Files:** `packages/api/src/services/entities.ts` · cache keys in `services/cache.ts`
(`CACHE_KEYS.entityList(type,hash)`, `entityRecord(type,id)`), `invalidateEntityCache(type)`.
- [ ] Validate via `columnMap.validateRecord`; slug/status handling; **caching honoring
  `typeDef.caching`** (index + record TTLs); invalidation on write; revisions when
  `revisioned`.
- [ ] **Tests:** cache hit/miss per rules; invalidation; validation errors. Commit.

### Task 2.3 — Schema-CRUD service (orchestrates the table generator)
**Files:** `packages/api/src/services/entityTypes.ts`
- [ ] `createType`, `updateType` (routing/caching/naming + non-core field add/edit/remove →
  table generator ALTERs), `deleteType` (custom only; drop table + ledger), `extendCoreType`
  (add non-core field only; reject core-field mutation). All under advisory lock; EntityManager
  invalidated after commit.
- [ ] **Tests:** create/extend/lock enforcement/delete. Commit.

### Task 2.4 — DTOs + routes (`registerModule('entities', …)`)
**Files:** `packages/shared/src/api/routes/entities.ts` (DTOs) · `packages/api/src/routes/entities.ts`
- [ ] Routes via `defineRoute`:
  - Types: `GET /entities/types` (auth `staff`), `GET /entities/types/:key`,
    `POST /entities/types` (`admin`), `PUT /entities/types/:key`, `DELETE /entities/types/:key`.
  - Instances: `GET /entities/:type` (`optional`, role-shaped), `GET /entities/:type/:idOrSlug`,
    `POST /entities/:type` (`staff`), `PUT /entities/:type/:id`, `DELETE /entities/:type/:id`.
  - `zodFromFields(fields)` builds the instance body schema at runtime; bind list/response DTOs.
- [ ] `registerModule('entities', entityRoutes, { mountPath: '/api/v1/entities' })`.
- [ ] Manifest + drift: run `npm run docs:api`; add a coverage test that every registered
  entity type resolves through the routes.
- [ ] **Tests:** route-level (list/get/create/update/delete over a scratch type; core-schema
  lock returns 4xx). Commit.

### Task 2.5 — SDK module
**Files:** `packages/cms-client/src/modules/entities.ts` · register in `modules/index.ts`
(`assembleModules` + `CmsModules`).
- [ ] `EntitiesModule` (`cms.entities.list/get/create/update/remove`), `EntityTypesModule`
  (`cms.entityTypes.list/get/create/update/remove/extend`). Extend `ModuleBase`.
- [ ] `npm run check:drift -w packages/cms-client` green. Tests. Commit.

### Task 2.6 — Wire the shared EntityTypeRegistry into all three template runtimes
**Files:** `packages/shared/src/entities/registry.ts` (impl) · `packages/cms/src/services/
entityRegistry.ts` (cms: fetch types via `cms.entityTypes`, fetchers via `cms.entities`) ·
`packages/api/src/services/entityTemplateRuntime.ts` (server: fetchers via `services/entities`
+ core services) · Modify `cms/services/template/runtime.ts`, `api/services/ssr/templateRuntime.ts`,
`api/services/mail/templateRuntime.ts` to consult the registry (generic loop) instead of the
`switch(name)`; keep the existing core cases as registered descriptors so behavior is identical.
- [ ] Modify `TemplateEntity.tsx`, `entityToHtml`, `entityToMailHtml` to fall back to a
  **generic field renderer** (`GenericEntityCard` / a field-list HTML serializer) when no
  bespoke component/emitter is registered.
- [ ] Generate `reference.ts` FROM the registry (Task 0.5's shared data now sourced from types).
- [ ] **Tests:** `{{post.title}}` still resolves (regression); a scratch `recipe` type resolves
  `{{recipe('slug').name}}` and whole-entity render on all three surfaces.
- [ ] Green. Commit. Deploy.

**Phase 2 exit:** full generic entity CRUD over the API + SDK; `{{ }}` resolves any registered
type on cms/SSR/mail from one registry. Core behavior unchanged.

---

## PHASE 3 — Admin "Entities" section

### Task 3.1 — Sidebar + routes
**Files:** `packages/cms/src/pages/admin/AdminLayout.tsx` (add `{ path:'/admin/entities',
label:'Entities', icon:'…', adminOnly:true }` to `NAV_ITEMS`) · admin router (lazy routes for
`/admin/entities`, `/admin/entities/:type`, `/admin/entities/:type/:id[/edit]`,
`/admin/entities/:type/templates[/:templateId]`).
- [ ] Add an outline icon. Commit.

### Task 3.2 — Entities list (custom rows, not a table)
**Files:** `packages/cms/src/pages/admin/entities/EntitiesList.tsx` (+ scss)
- [ ] Custom row per type: name + description, badges (`core`/`custom`, enabled), **record
  count** (`cms.entities.count` or list meta), **Templates** link showing template count, and
  **Edit schema** button. "New entity type" action (custom only).
- [ ] Data via `cms.entityTypes.list`. Commit.

### Task 3.3 — Entity detail: Schema tab
**Files:** `packages/cms/src/pages/admin/entities/EntityDetail.tsx`,
`components/admin/entities/SchemaFieldEditor.tsx`
- [ ] Top: basic props — enable **detail route** (+ prefix), **index/list page** (+ prefix),
  **caching** (index/record toggles + TTLs), **singular/plural** names. Core: read-only where
  locked.
- [ ] Field list: name/key/type/flags; core fields **read-only**; add/edit/remove non-core
  fields (all types from `EntityFieldType`, with per-type options: enum values, relation
  target, required/unique/indexed/searchable/default).
- [ ] Save → `cms.entityTypes.update` / `.extend`. Commit.

### Task 3.4 — Entity detail: Data tab (full-featured table)
**Files:** `components/admin/entities/EntityDataTable.tsx`
- [ ] Paginated (`page`/`limit`), **all columns sortable** (header click → `sortBy/sortOrder`),
  **search bar** over searchable fields, row **Edit** button → `adminEditRoute` (module custom
  route) if set, else `/admin/entities/:type/:id/edit`. Reuse existing `Pagination`.
- [ ] Data via `cms.entities.list`. Commit.

### Task 3.5 — Generic record view/edit
**Files:** `packages/cms/src/pages/admin/entities/EntityRecordEdit.tsx`,
`components/admin/entities/EntityRecordForm.tsx`
- [ ] Schema-driven form: one control per field type (text/number/bool/date/enum/media
  picker/relation picker/json/richtext). Read route + `/edit` route (permission-separable).
- [ ] Save via `cms.entities.create/update`. Commit.

### Task 3.6 — Reusable entity search/select modal
**Files:** `components/admin/entities/EntitySearchSelectModal.tsx`
- [ ] Props: `entityType`, `mode:'single'|'multiple'|'query'`, `max?`. Renders a search form
  (searchable fields) + sortable results table + selection; in `query` mode edits an
  `EntityQuery` (filter/sort/limit). Returns `ref|refs|query`. Portal-mounted like the media
  modal. **Shared** — used by the template block panel (Phase 5) and anywhere else.
- [ ] Commit.

**Phase 3 exit:** admins can define/extend types and manage instances end-to-end. Deploy.

---

## PHASE 4 — Content-block templates

### Task 4.1 — Migration + repo (modeled on mail templates)
**Files:** `db/migrations/0NN_create_content_block_templates.sql`
(`content_block_templates` + `content_block_template_blocks` — the latter mirrors
`mail_template_blocks` exactly, incl. `parent_block_id`, `block_type`, `settings`/`style`
JSONB) · `repositories/contentBlockTemplates.repo.ts` (+ `...Blocks`) — copy the
`mailTemplateBlocks.repo.ts` shape (`findByTemplate`, `findByTemplateResolved` via
`populateBlockStyles`, `replaceAll` txn).
- [ ] Tests (round-trip a nested subtree; style refs resolve). Commit.

### Task 4.2 — Service + routes + SDK
**Files:** `services/contentBlockTemplates.ts` · `routes/entities.ts` (add
`GET/POST/PUT/DELETE /entities/:type/templates[/:id]` + block save/load) ·
`shared/src/api/routes/entities.ts` DTOs · `cms-client/src/modules/entities.ts`
(`cms.contentBlockTemplates.*`).
- [ ] Template CRUD scoped to an entity type; block subtree save/load. Cache list per type.
- [ ] Tests + drift. Commit.

### Task 4.3 — Template list + editor UI (reuse the block editor wholesale)
**Files:** `pages/admin/entities/TemplateList.tsx`, `TemplateEditor.tsx`
- [ ] List page: templates for a type (name, single/list badge, block count) + create/edit.
- [ ] Editor: the **existing `BlockEditor` + `BlockStyleEditor` (+ breakpoints)** bound to the
  template's block subtree (like `MailTemplate` does), plus a **template properties panel**
  (name, description, `mode: single|list`, optional `maxRecords`). The `{{ }}` reference panel
  is auto-scoped to the bound entity type's fields (`{{post.<field>}}` / `{{posts[0].<field>}}`).
- [ ] Save via `cms.contentBlockTemplates.*`. Commit.

**Phase 4 exit:** admins can author reusable, entity-bound, multi-block templates with full
style + breakpoint support. Deploy.

---

## PHASE 5 — The `entity` block (single template on pages/posts)

### Task 5.1 — Register the new block type
**Files:** `shared/src/types/content.ts` (add `'entity'` to `BlockType`) ·
`shared/src/utils/blockCatalog.ts` (`ALL_BLOCK_TYPES`) · `cms/config/blockTypes.ts`
(registry entry, category `blocks`, `defaultData`) · `db/migrations/0NN_add_entity_block_type.sql`
(`ALTER TYPE block_type ADD VALUE 'entity'` + `content_block_type`).
- [ ] Coverage tests (`blockCatalog`, ssr/mail) force the new arms. Commit.

### Task 5.2 — Data binding resolver (shared, test-first)
**Files:** `packages/cms/src/services/entityBinding.ts` (+ server twin in
`services/entityTemplateRuntime.ts`)
- [ ] `resolveBinding(templateId, binding, ctx)` → `{ var, value }` where `value` is one
  `EntityRecord` (single/context) or `EntityRecord[]` (list/query, capped at
  `template.maxRecords`), and `var` is the type's `singularVar`/`pluralVar`. Uses the registry
  fetchers; caches per entity rules.
- [ ] **Tests:** each mode; list cap enforced; context fallback empty. Commit.

### Task 5.3 — Public renderer
**Files:** `packages/cms/src/components/blocks/EntityBlock.tsx` · wire a `<Match
when={type==='entity'}>` arm (or the new `Record<BlockType,Component>` map if we do Decision-7
data-driven dispatch) in `BlockRenderer.tsx`.
- [ ] Load the template subtree (`cms.contentBlockTemplates.getBlocks`), resolve the binding,
  bind `{ [var]: entityRef(type, data) }` (or an array) into `templateContext`, render the
  subtree via `BlockRenderer` recursion (ctx threaded — Phase 0.3). Loading/empty states.
- [ ] Tests. Commit.

### Task 5.4 — Admin edit panel + preview
**Files:** `packages/cms/src/components/admin/blocks/types/EntityBlock.tsx`,
`components/admin/entities/EntityBindingPanel.tsx` · register in `BlockEditController.tsx`.
- [ ] Panel: pick **entity type** → pick **template** (lists templates for that type) → pick
  **binding**: single (open `EntitySearchSelectModal` mode single) / list (mode multiple, ≤max)
  / query (mode query) / context (toggle). Preview renders via the public `EntityBlock`
  (admin catch-all already delegates).
- [ ] Commit.

### Task 5.5 — SSR + mail emitters
**Files:** `services/ssr/blocks/entity.ts`, `services/mail/blocks/entity.ts` + register in the
`Record<BlockType,…>` registries.
- [ ] Resolve binding server-side (anonymous ctx for SSR), render the template subtree to
  indexable HTML (SSR) / table HTML (mail) by recursing the existing per-type emitters.
- [ ] Coverage tests pass. Commit. Deploy.

**Phase 5 exit (Milestone 1 done):** an admin can drop an `entity` block on a page, pick a
template + a data source, and it renders on the public site, in previews, in SSR, and in mail.

---

## PHASE 6 — Array-like templates (carousels, mixed types)

### Task 6.1 — Extend the carousel item model
**Files:** `shared/src/types/hero.ts` (add `HeroItem.type='entity'` carrying
`EntityBlockSettings`) · `ResolvedHeroCarousel.tsx` (a generic `resolveEntityItem` mirroring
`resolvePostsItem`: resolve binding → render each entity through its template) ·
`PostQueryControls`/carousel editor (add an "Entity template" item option using
`EntityBindingPanel` + `EntitySearchSelectModal`).
- [ ] Each carousel item can carry a DIFFERENT template + entity type + binding → **mixed
  entity types in one carousel**. Reuse `HeroCarousel`'s expand-then-flatten; a slide's content
  is the rendered template subtree.
- [ ] Tests: single-type list; mixed-type list; per-item cap. Commit. Deploy.

**Phase 6 exit (Milestone 2):** carousels render entity templates, including mixed types.

---

## PHASE 7 — Public entity index/detail routes (stubbed via content blocks)

### Task 7.1 — Generic public routes
**Files:** `packages/cms/src/pages/EntityIndex.tsx`, `EntityDetail.tsx` + public router
(register `routing.detailPrefix`/`indexPrefix` from enabled types) · SSR route parity ·
sitemap/RSS hooks.
- [ ] Detail (`/{prefix}/:slug`) and index (`/{prefix}`) render via the block system (like
  `DynamicPage`), exposing the resolved entity to `templateContext` (Decision 4 context
  binding). Stub with basic fields now; full block-driven layouts later. Honor caching rules.
- [ ] Tests. Commit. Deploy.

**Phase 7 exit (Milestone 3):** custom entities get public routes rendered through content blocks.

---

## PHASE 8 — Full core-module migration + block-store bridge (highest risk)

Decision 1 = **full migration**. One entity at a time, live-site-safe: rewrite each core
module onto the generic repo, reshape/migrate data where columns differ, then **delete the
bespoke duplicate path**. Single code path is the exit state.

### Task 8.0 — Parity gate (pre-req)
- [ ] Before migrating any core entity, confirm `services/entities.ts` + `genericEntity.repo`
  reach feature parity for that entity's needs (status workflow, revisions, search, slug,
  relations, block-body via 8.2, caching). Add generic-side features until parity holds.

### Task 8.1 — Migrate each core entity onto the generic repo (per entity, per PR)
**Files:** per entity: a **data migration** (reshape existing table to the generic contract
where columns differ; keep the same table, `origin:'core'`), rewrite `services/<entity>.ts`
to run CRUD through `services/entities.ts`, keep `cms.<entity>` method names as **facades
over `cms.entities`** (DTOs preserved — drift = compile error), then **remove the now-dead
bespoke repo/SQL**. Registry fetchers for that type flip from the old service to the generic
repo.
- [ ] Order: lowest-risk first (e.g. `campaign`/`form`), `post`/`page` last (block bodies).
- [ ] Full regression tests per entity (list/get/slug/status/search/revisions/SSR/`{{ }}`),
  surge deploy + smoke between each. Roll back a single entity without touching others.

### Task 8.2 — Bridge posts↔pages block storage
**Files:** unify on the nesting model — either migrate `post_content_blocks` onto a shared
block store with `parent_block_id`, or add `parent_block_id` + per-parent reorder to posts.
Reconcile the two block enums.
- [ ] Migration + repo changes + tests; posts can now host nested `entity`/group blocks.
- [ ] Commit. Deploy.

**Phase 8 exit (Milestone 4):** core modules sit on the generic system; posts support nesting;
one code path.

---

## PHASE 9 — Documentation, help pages, headless SDK docs, cleanup

### Task 9.1 — Internal + repo docs
- [ ] Update `CLAUDE.md` (new Entities + Templates sections), `docs/API.md`/`api-manifest.json`
  (`npm run docs:api`), and the spec/plan cross-links.

### Task 9.2 — Admin help pages + md→html
**Files:** `scripts/docs-md-to-html.mjs` (transcribe markdown → html) · `/admin/help/entities`,
`/admin/help/content-block-templates` · reuse the existing `/admin/help/variables-and-functions`
pattern; auto-list each entity type's field schema (generated from the registry).

### Task 9.3 — Headless SDK docs
**Files:** `docs/sdk/` (Overview, entities, entity-types, content-block-templates, examples) —
first-class `cms.entities.*` / `cms.entityTypes.*` / `cms.contentBlockTemplates.*` reference.
Wire the md→html script so the same source feeds `/admin/help`.

### Task 9.4 — MCP surface
**Files:** `packages/cms-mcp` — add `describe_entity_types`, generic entity CRUD tools, and
template tools (parallel to `describe_block_types`). Update `docs/MCP.md`.

### Task 9.5 — Dead-code sweep
- [ ] Remove the legacy `style_template_id`/`style_custom` dead columns; delete any template
  runtime switch arms fully replaced by the registry; run `/dead-code` scope over touched files.

**Phase 9 exit:** docs current, help pages live, headless SDK documented, MCP covers entities,
dead code gone.

---

## Self-review (spec coverage)

- Admin **Entities** sidebar + custom-row list + record/template counts → 3.1–3.2. ✅
- Schema tab (core read-only + extensible, routing, index/detail toggles + prefixes, caching
  TTLs, singular/plural names) → 3.3, 1.1, types. ✅
- Data tab (paginated, all-column sort, searchable-field search, per-row edit → module custom
  route or generic) → 3.4, 1.6 `adminEditRoute`. ✅
- Generic record view/edit with `/edit` route + permissions → 3.5. ✅
- EntityManager high-level metadata cache + read caching by rules → 1.5, 2.2. ✅
- Entity block-template management per type (list + count + editor) with the **same** style
  panel + breakpoints, multi-block support, properties panel (name, single/list, max) → 4.x. ✅
- New `entity` block type on pages/posts: pick type + template + data source (single / list ≤max
  / query) via a shared smart select-modal; preview → 5.x, 3.6. ✅
- Array-like blocks (carousel) using templates as items, mixed types → 6.1. ✅
- Variable binding by singular/plural name (`{{post.x}}` / `{{posts[0].x}}`), plus all existing
  built-ins → 5.2, template mode, 2.6. ✅
- Full API + SDK first-class support; modules use the SDK → 2.4–2.5, 8.1, principles. ✅
- Docs (internal + `/admin/help` + `docs/sdk/` + md→html script) → 9.x. ✅
- Foundational refactors from the spec → Phase 0 (+ 8.2 block-store bridge). ✅
- Per-type generated tables → 1.3. Core-as-internal, feature-scaffolded → 1.6. ✅

**Placeholder scan:** none — every task lists exact files + the concrete contract; the
architectural cores (Phases 0–2, 5) carry full type/DDL/route/SDK signatures above. Mechanical
per-entity work (8.1) is a repeated recipe, intentionally not copy-pasted.

---

## Execution handoff

Plan saved. **Before implementation, resolve the "Open Decisions" (10 items).** Then two
execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks.
2. **Inline Execution** — batch phases with checkpoints (superpowers:executing-plans).

Milestone 1 = Phases 0–5. Deploy to surge.ryanweiss.net after each green phase per the standing
workflow.
