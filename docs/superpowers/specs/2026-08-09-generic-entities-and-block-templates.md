# Generic Entities & Block Templates — Initial Analysis & Architecture Direction

**Status:** Analysis + architecture direction. **NOT a build plan.** No code is to be
written from this document. A thorough implementation plan will follow, after the
user sends further specifications.

**Date:** 2026-08-09
**Scope:** Understand the current SiteSurge system deeply, then lay out the target
architecture for (1) a **fully generic entity-type system** with **per-type generated
tables**, (2) the **core entities rebuilt on top of it** as protected/extensible
"internal" types, and (3) a **content-block templating layer** bound to entity types
that renders as single blocks or as items inside array-like blocks (carousels/lists),
including mixed entity types.

---

## 0. The vision (from the user's direction)

- **Full generic entities.** A first-class system for defining arbitrary entity types
  (name + field schema) and managing their instances, with real backing storage.
- **Per-type generated tables.** Each entity type gets its own real DB table generated
  at runtime (columns per field), not a shared JSONB bag. (User decision.)
- **Core entities become generic.** `post`, `page`, `user`, `campaign`, `form` (and the
  other existing entities) are **rebuilt as entity types on the generic architecture**
  and serve as the reference examples. Going forward those modules consume the generic
  entity system via the CMS SDK / API surface rather than bespoke stacks.
- **Feature modules scaffold entity types.** When an admin enables a feature module
  (e.g. `users`, `campaigns`, `forms`), that module **invokes the generic entity
  architecture to scaffold its entity type(s)** — creating the type definition, table,
  and schema. Disabling does the inverse. Future modules are authored the same way.
- **Core types are `internal`.** Marked as core/system. Enable/disable **only** via
  feature modules (not from the Entities UI). **Extensible** (admins may add new
  properties/fields), but the **core type + core schema are immutable** (cannot be
  renamed/removed/retyped).
- **Admin "Entities" section.** A new sidebar section to manage **all** entity types and
  their schemas, create **custom** entity types (beyond the core ones), and manage
  instances.
- **Templating assigned to entity types.** A content-block **template** is bound to a
  specific entity type (`post`, `user`, `campaign`, or any custom type).
- **New content-block "template" type.** A block can set its type to a template, then
  choose the **data object** (a specific entity instance) **or a query** to render that
  template with.
- **Templates as array-like items.** Array-like blocks (carousel, and by extension other
  list blocks) can use content-block templates as child items, each pointing to specific
  entities (or a query, or a mix of entity types) to render.

Everything below is grounded in a full read of the current codebase (five subsystem
audits). File paths are given so the eventual plan can act precisely.

---

## 1. Current system — ground truth

### 1.1 Entities are bespoke, hand-written stacks (no generic mechanism today)

There is **no generic / dynamic / EAV / custom-field entity mechanism anywhere** in the
codebase. Every first-class entity is a fully bespoke 7-layer stack:

1. SQL table (+ `-- @feature` tag, `updated_at` trigger) in `packages/api/src/db/schema.sql`
   or a migration.
2. `repositories/<entity>.repo.ts` — hand-written SELECT constant, finders, CRUD.
3. `services/<entity>.ts` — business logic.
4. `routes/<entity>.ts` — an array of `defineRoute(...)` with per-route zod schemas.
5. `packages/shared/src/api/routes/<entity>.ts` — request/response DTOs, bound to zod via
   `satisfies z.ZodType<X>` / `AssertCompatible` (drift = compile error).
6. `packages/cms-client/src/modules/<entity>.ts` — a `ModuleBase` subclass (`cms.<entity>`).
7. Admin editor pages + public renderer.

**Entity inventory** (table · TS type · repo · fetch modes):

| Entity | Table(s) | TS type | Repo finders | By id / slug |
|---|---|---|---|---|
| page | `pages` | `Page` (`shared/src/types/content.ts:5`) | `pages.repo.ts` | id + slug |
| post | `posts` + `post_content_blocks` | `Post`/`PostWithBlocks` (`content.ts:108`) | `posts.repo.ts` | id + slug |
| campaign | `campaigns` + `donations` | `Campaign` (`types/campaign.ts`) | `campaigns.repo.ts` | id + slug |
| form | `forms`/`form_questions`/`form_submissions` | `types/form.ts` | `forms.repo.ts` | id + slug |
| user | `users` (+ sessions/bans/patreon) | `types/user.ts` | `users.repo.ts` | id only |
| media | `media` | `Media` (`content.ts:187`) | (service only) | id only |
| social_post | `social_posts` | `SocialPost` (`content.ts:162`) | (service) | platform/externalId |
| contact_message | `contact_messages` | `ContactMessage` | `messages.repo.ts` | id only |
| shop product/…/order | migrations 039–049,071,072,075,076,081 | `types/shop.ts` | `repositories/shop/*` | slug + id |

**Recurring shape:** `id UUID PK DEFAULT uuid_generate_v4()/gen_random_uuid()`,
`slug VARCHAR(255) UNIQUE` (content entities), `title`, `status <enum>`,
`created_by UUID REFERENCES users(id)`, `created_at/updated_at TIMESTAMPTZ` + `updated_at`
trigger, snake_case throughout, `mapRow`/`mapRows` for snake→camel. Only **posts & pages**
carry `search_vector`.

**The one reusable base:** `repositories/base.repo.ts` — but it is a set of
**table-name-parameterized helper functions**, not a class/interface each entity
implements: `paginatedQuery` (`:43`), `findByIdOrThrow(table,id,name)` (`:70`),
`updateById` (`:86`), `deleteById` (`:113`), `buildSortClause(…, allowedColumns, …)`
(`:26`). Repos *optionally* call these. There is **no shared "Entity" TS interface** —
`Page`/`Post`/`Campaign` merely share fields by coincidence.

**Cost of one entity domain (shop, worked example):** 13 migrations / 14 tables, 4 repos,
8 services, a 32KB route module, DTOs (19KB) + types (10KB), a 16KB SDK module, 12 admin
pages, one `FEATURE_REGISTRY` entry, and a `registerModule(..., { feature })` mount. This
is the cost surface a generic system must collapse.

**Generic primitives that already exist to exploit:** `site_settings` (`key UNIQUE` →
`value JSONB`) is the app's generic KV store; block `settings`/`style`/`data` and
`post_content_blocks.data` prove the codebase is comfortable storing arbitrary field bags
in JSONB and mapping them; `audit_log.entity_type/entity_id` is a polymorphic reference;
the **plugin system** already performs **runtime migrations** via a `plugin_migrations`
ledger + `pg_advisory_xact_lock` — this is the closest existing template for
**dynamic/runtime schema creation**, which per-type generated tables require.

### 1.2 The `{{ }}` template engine is already entity-agnostic

The pure tokenizer → parser → evaluator lives in `@sitesurge/types`
(`packages/shared/src/template/`) and imports no repo/SDK. It manipulates an opaque
`EntityRef`:

```ts
interface EntityRef { __entity: true; kind: string; id?: string;
                      data: Record<string, unknown> | null;
                      options?: Record<string, unknown>; }        // template/types.ts:49
```

- `{{campaign('x').title}}` vs `{{campaign('x')}}` differ **only** by whether the call has
  trailing `.props` (empty props ⇒ "render the whole entity"). Decided in the evaluator,
  not the runtime.
- `getProp` reads `entityRef.data[prop]` off the raw fetched object — **no schema
  validation**; unknown props → `undefined` → warned → `''`.
- **Result: `{{anything('id').field}}` works the instant some runtime returns
  `entityRef('anything', data, id)`. Zero engine changes are needed for new kinds.**

**The coupling is duplication in three runtimes.** Each of cms
(`packages/cms/src/services/template/runtime.ts:101`), SSR
(`packages/api/src/services/ssr/templateRuntime.ts:140`) and mail
(`packages/api/src/services/mail/templateRuntime.ts:91`) re-implements the **same
hardcoded `switch(name)`** mapping `post/campaign/form/page/media/user/posts/…` → a fetch
(SDK on cms, backend services on server) + an `EntityRef`. There is **no registry**.

**Whole-entity rendering is a second hardcoded switch per surface:**
- cms: `TemplateEntity.tsx:19` `<Switch>` maps `kind` → Solid component
  (`form`→`FormRenderer`, `campaign`→`CampaignDetail`, `campaignLink`→`CampaignCard`,
  `post`→inline card, `media`→img/video, `page`→link, `user`→span). `TemplatedContent.tsx`
  flattens the output and Portal-mounts these components into `display:contents`
  placeholders.
- SSR: `entityToHtml()` (`ssr/templateRuntime.ts:96`) — another `switch(kind)` → HTML.
- mail: `entityToMailHtml()` (`mail/templateRuntime.ts:66`) — another `switch(kind)`.

**Reference data** (`packages/cms/src/services/template/reference.ts`) is a
semi-machine-readable field catalog (`ENTITIES: EntityDoc[]`, each `{ kind, fields:
{name,type}[] }`) — but it is **docs-only, cms-local, and not consulted by the engine**.
It could seed a shared entity-type schema but today validates nothing.

**Auto-context:** the root `context` bag is seeded with EntityRefs (cms passes
`{ post, user, site }`; SSR wires `{ post }` / `{ page }` where the context **key is used
as the entity kind**). This is the mechanism a template block will use to bind its entity.

### 1.3 Block data model — two divergent storage models

**Pages** — table `blocks` (`schema.sql:131`): `id`, `page_id`, **`parent_block_id` self-FK
(NULL = top-level) → real nesting**, `type block_type` (enum), `title`, `content TEXT`,
`settings JSONB`, `"order"`, `is_visible`, `style JSONB`, timestamps. `style` holds either
`{ id: <block_styles uuid> }` (template ref) or an inline prop bag. `BlockSettings`
(`content.ts:91`) is a loose grab-bag with `[key:string]: unknown`.

**Posts** — table `post_content_blocks` (`schema.sql:197`): `id`, `post_id`,
`type content_block_type` (a **separate enum**), `sort_order`, **`data JSONB` (whole
payload, not split)**, denormalized index columns, `style JSONB`. **No `parent_block_id`
→ posts cannot nest.** Save path is **delete-all-then-reinsert** (`posts.repo.ts:79`),
versus pages' per-block upsert + `reorderBlocks(pageId, parentBlockId, blockIds)`
(`pages.repo.ts:401`).

**Two enums, drifted:** `block_type` (pages) vs `content_block_type` (posts); enum values
are ADD-only (legacy `social_media`/`social_feed` still present); posts lack
`group`/`group_item`.

**Block-type registry — three layers that must stay in sync:**
1. DB enums (above), extended via `ALTER TYPE … ADD VALUE`.
2. `ALL_BLOCK_TYPES` in `packages/shared/src/utils/blockCatalog.ts:11` (`satisfies readonly
   BlockType[]` + compile-time exhaustiveness guard).
3. Admin registry `packages/cms/src/config/blockTypes.ts` — `BLOCK_TYPES[]` metadata
   (`label`, `category`, `gating`, `defaultData`, `enabled`, `composite`).

⚠️ The **`BlockType` union is defined twice** — `content.ts:47` and
`config/blockTypes.ts:19` — a live drift risk.

**Render registries:** SSR (`services/ssr/blocks/`, `SSR_BLOCK_RENDERERS:
Record<BlockType, fn>`) and mail (`services/mail/blocks/`, `RENDERERS: Record<BlockType,
fn>`) are **data-driven, coverage-tested** (`blocks.test.ts`, `coverage.test.ts` iterate
`ALL_BLOCK_TYPES`). Public/admin render are **hardcoded `<Switch>`es**
(`BlockRenderer.tsx:225`; admin edit `BlockEditController.tsx:397`; admin preview
`ContentBlock.tsx:330` with a `<Match when={true}>` catch-all that delegates to the public
renderer → most types get preview for free).

**Nesting mechanics (pages):** `buildBlockTree(flat)` (`shared/src/utils/blockTree.ts:13`)
assembles the tree on the render side only; `group` holds `group_item` slots (each ≤1
child of any type); `group_item` is auto-managed (never picked from the menu). The FK
allows arbitrary parent/child; the UX constrains it to group→group_item→child.

### 1.4 Existing reusable-"template" precedents

- **`block_styles`** (`005_add_block_styles.sql`) — reusable **presentation props only**
  (columnar: one column per style prop + `breakpoints JSONB`). Referenced from a block's
  `style` as `{ id }`; resolved+inlined server-side by
  `services/blockStyleResolution.ts::populateBlockStyles`. Single-node, **no content, no
  entity binding.** Its lifecycle (save → reference-by-id → resolve/merge → apply CSS) is
  a good precedent for "reference a saved thing by id and inline it at read time."

- **`mail_templates` + `mail_template_blocks`** (migrations 032/033) — **the blueprint for
  content-block templates.** This is a **named, reusable block *subtree* owned by a parent
  entity**, with `parent_block_id` self-ref (nesting!), reusing the `block_type` enum,
  `settings`/`style` JSONB, and `position`. It is assembled/rendered through the **same**
  `buildBlockTree` / `BlockEditor` / `BlockRenderer` / `blockStyleRef` /
  `populateBlockStyles` machinery as pages. `mailTemplateBlocks.repo.ts` does
  `findByTemplate`/`findByTemplateResolved` + `replaceAll` (txn delete+reinsert). Mail
  templates even support the nesting posts lack. **A `content_block_templates` +
  `content_block_template_blocks` pair should be modeled directly on this.**

### 1.5 Array-like / list blocks are ~80% ready

- **One shared post resolver:** `fetchPostList(filters)`
  (`packages/cms/src/services/postsService.ts:105`) → `cms.posts.list` → `GET /posts`,
  cached 30s. Used by **both** the public renderer and the admin preview. No separate
  preview path.
- **`HeroCarousel` is already entity-agnostic:** it renders a generic `HeroItem`
  (header/subheader/`postMeta`{author,dates,excerpt,tags}/action). The "post-ness" lives
  **entirely upstream** in `postToSlide()` / `buildPostMeta()`
  (`ResolvedHeroCarousel.tsx:58`), which map a post → a synthetic `type:'media'` slide.
- **`HeroItem`** (`shared/src/types/hero.ts:6`) is a soft discriminated union on
  `type?: 'media'|'posts'`; a `posts` item holds a `HeroPostsConfig` query that gets
  flattened to N slides. **This pattern generalizes** to `type:'entities'` /
  `type:'template'` holding `{ entityType, ref|query, templateId }`.
- **`PostListRenderer`'s per-item card (`PostListItem`) is inlined** and reads post fields
  directly (not reusable) — but it already renders post *content* via `BlockRenderer` over
  `contentBlocks` (`PostListRenderer.tsx:372`), proving list items can render block
  subtrees.
- **Storage is permissive:** block `settings` is untyped JSONB; only the block-`type` enum
  is validated backend-side. **A mixed-entity list is storable today with no
  migration/DTO work** — the walls are all in the resolve + field-access layers, plus the
  hardcoded `/posts/${slug}` links.

### 1.6 Cross-cutting gaps (must be addressed for full coverage)

- **`templateContext` is dropped when recursing into group children**
  (`BlockRenderer.tsx` GroupBlock → child `BlockRenderer` without `templateContext`). A
  template/entity block nested in a group or carousel would not resolve `{{entity.*}}`.
- **SSR feed is flat** (`ssr/routes.ts` `SELECT … ORDER BY "order"`, no `buildBlockTree`),
  so any child-bearing block (groups today; entity/template blocks tomorrow) is **invisible
  to SEO**. `post_list`/`carousel` are already `notIndexable`.
- **`BlockType` union duplicated** (§1.3) and **public/admin dispatch is a hardcoded
  `<Switch>`** while SSR/mail are data-driven.
- **Entity binding on blocks is ad-hoc** (`settings.postId`/`formId`/`campaignId`) rather
  than a generic entity-ref shape.

**Seam map (the hardcoded sites a generic layer must replace):**

| Concern | Location | Form |
|---|---|---|
| cms entity fetch | `cms/services/template/runtime.ts:33` | `switch(kind)` → `cms.<x>.getById/BySlug` |
| cms resolve dispatch | `runtime.ts:106` (+ `COLLECTION_KIND :81`) | `case 'post'|'campaign'|…` |
| cms whole-entity render | `TemplateEntity.tsx:19` | `<Switch>` kind→component |
| SSR fetch + dispatch + flatten | `ssr/templateRuntime.ts:34,145,96` | 3 switches |
| mail fetch + dispatch + flatten | `mail/templateRuntime.ts:45,91,66` | 3 switches |
| public block dispatch | `BlockRenderer.tsx:225` | `<Switch>/<Match>` |
| admin edit dispatch | `BlockEditController.tsx:397` | `<Switch>` |
| block-type catalog | `blockCatalog.ts:11` + `config/blockTypes.ts:19` (+ `content.ts:47`) | duplicated union |
| entity docs | `reference.ts:85` | hand-written `ENTITIES[]` |

---

## 2. Target architecture

Three layers, each building on the seams above. **Per-type generated tables** is the
chosen storage model.

### 2.1 The Generic Entity System

**2.1.1 Entity Type Definition (the schema).** A stored definition per entity type:

- Identity: `key` (machine name, e.g. `post`), `label`, `labelPlural`, `slug` behavior,
  `icon`.
- **`origin`: `'core' | 'custom'`** and **`internal: boolean`.** Core/internal types are
  system-owned (see 2.1.4).
- **`ownerFeature?`**: which feature module owns/scaffolds this type (e.g. `campaigns`).
- **Field schema**: an ordered list of field definitions. Each field:
  `key`, `label`, `type` (see 2.1.5), `required`, `unique`, `indexed`, `default`,
  validation, `core: boolean` (locked vs admin-added), relation target (for entity refs),
  enum options, etc.
- Behaviors: `hasSlug`, `hasStatus` (draft/published), `searchable` (→ `search_vector`),
  `revisioned`, public route pattern (`/{type}/{slug}`?), timestamps/`created_by`.
- A **`template` binding surface**: which content-block templates target this type.

This definition is the **single source of truth** and drives table generation, the generic
repo/routes/SDK, template resolution, and the admin CRUD UI. It supersedes the hand-written
`reference.ts` (which becomes generated).

**2.1.2 Storage: per-type generated tables.** Each enabled entity type gets a real table
(e.g. `entity_post`, `entity_campaign`, or `ce_<key>` for custom) generated by a
**runtime-migration engine modeled on the plugin system** (`plugin_migrations` ledger +
`pg_advisory_xact_lock`). Standard columns for every entity table: `id UUID PK`,
`slug` (if `hasSlug`), `status` (if `hasStatus`), `created_by`, `created_at`/`updated_at`
(+ trigger), `search_vector` (if searchable). Field definitions map to real columns
(type mapping in 2.1.5). **Schema extensions** (admin adds a field to a core or custom
type) become `ALTER TABLE … ADD COLUMN` migrations recorded in the ledger. This yields
real indexes, constraints, and SQL performance — the reason for choosing generated tables
over a JSONB bag.

**2.1.3 One generic data/API stack.** Because `base.repo.ts` already
table-parameterizes, a **single generic repo** over `(tableName, fieldSchema)` gets
`list`/`get-by-id`/`get-by-slug`/`paginate`/`sort`/`search` largely for free. On top:

- Generic service layer (validation from field schema, slug generation, status gating,
  search-vector upkeep, revisions, cache invalidation).
- Generic routes via `defineRoute` + `registerModule`: e.g. `/entities/:type` CRUD, with
  a **zod schema built at runtime from the field definition** (zod is already constructed
  per route; nothing prevents dynamic construction). DTOs: a generic envelope plus
  optional per-type generated typings.
- One SDK module `cms.entities` (`cms.entities.list('post', …)`,
  `cms.entities.get('campaign', idOrSlug)`), optionally with thin typed facades so
  `cms.posts`/`cms.campaigns` keep working as **adapters over the generic surface** (the
  user's "core modules consume the generic system via the SDK/API" requirement).
- MCP: a generic `describe_entity_types` + generic entity CRUD tools (parallel to the
  existing `describe_block_types`).

**2.1.4 Core entities as `internal` types (protected + extensible).** `post`, `page`,
`user`, `campaign`, `form` (and the rest) are **redefined as core entity types** on this
architecture and used as the reference implementations. Rules:

- `origin: 'core'`, `internal: true`. **Enable/disable only via feature modules**, never
  from the Entities UI.
- **Core fields are locked** (`field.core = true`): cannot be renamed, retyped, or removed.
- **Extensible**: admins may **add** new (non-core) fields to a core type; those become
  `ALTER TABLE ADD COLUMN` on the type's table and are freely editable/removable.
- The existing bespoke modules become **thin adapters** over the generic entity API
  (progressively), so `cms.posts.*` etc. keep their ergonomics while the storage/CRUD flow
  through the generic core. (Adoption/compat strategy is a major open item — see §4.)

**2.1.5 Field type system (to be finalized in the plan).** Candidate types with their
column mappings: `text`/`string`→`VARCHAR/TEXT`, `richtext`→`TEXT` (template-resolved),
`markdown`→`TEXT`, `number`/`integer`→`NUMERIC/INTEGER`, `boolean`→`BOOLEAN`,
`date`/`datetime`→`DATE/TIMESTAMPTZ`, `enum`→`VARCHAR` + check/constraint,
`json`→`JSONB`, `media`→media id FK, `entity`/`relation`→FK to another entity type's
table (or a join table for many-to-many), `slug`, `computed`/virtual (not stored),
`blocks`→owned block subtree (for entities whose body is block-based, like posts/pages).
Each carries required/unique/indexed/default/validation.

**2.1.6 Feature-module ↔ entity-type scaffolding.** `FEATURE_REGISTRY` entries gain the
ability to **declare and scaffold their entity type(s)** on enable (create type definition
+ generate table + seed), and reverse on uninstall (drop/retire). This replaces (or
complements) today's static per-feature migration file lists with entity-type scaffolds.
Enabling `campaigns` ⇒ scaffolds the `campaign` entity type; disabling ⇒ retires it
(semantics for data retention TBD in the plan).

**2.1.7 Admin "Entities" section.** New sidebar area:
- **Entity Types** list: core (locked, badge) vs custom; enabled/disabled (core toggles are
  read-only here — managed from the feature module screens).
- **Type editor**: schema builder (add/edit/remove non-core fields; core fields shown
  locked); behaviors (slug/status/search/public route).
- **Instances**: a **generic, schema-driven CRUD UI** (list with sort/search/pagination +
  a generated form per field type). Precedent: the plugin `configSchema` → host-rendered
  form pattern (`PluginConfig`), and the existing block editor for `blocks`-type fields.

### 2.2 The shared `EntityTypeRegistry` (collapses the 9 seams)

A single registry in `@sitesurge/types`, the runtime face of the stored definitions.
Per kind it provides: **field schema**, **platform-injected fetchers**
(`getById`/`getBySlug`/`list`/`count` — SDK-backed on cms, service-backed on server),
and a **render descriptor** (a default field-schema-driven renderer + an optional bespoke
component). Then:

- The three runtime `switch(name)` blocks → `registry.get(name)?.resolve(args)` with a
  generic collection/count loop.
- `TemplateEntity.tsx`, `entityToHtml`, `entityToMailHtml` → registry-driven render
  (bespoke component if registered, else the generic field renderer — required because
  custom types have no hand-written component).
- The id/slug/UUID-fallback + memo caching (duplicated 3×) → one shared helper.
- `reference.ts` and MCP `describe_entity_types` → **generated from the registry**, moved
  to shared so all surfaces share one field catalog.

**This is the key unlock: a new entity type — core or custom — becomes resolvable in
`{{ }}` across cms + SSR + mail from a single definition, with no per-surface edits.**

### 2.3 Templating on top of entities

**2.3.1 Content-block templates (bound to an entity type).** A saved, named block subtree
**modeled on `mail_templates` / `mail_template_blocks`** — a
`content_block_templates` row (id, name, description, **`entity_type`**, …) owning a
`content_block_template_blocks` subtree (`parent_block_id`, `block_type`, `settings`,
`style`, `position`). The template declares **one abstract entity variable** (e.g.
`entity`); its blocks use `{{entity.field}}`. Authored in the existing block editor;
resolved via `buildBlockTree` + `populateBlockStyles`; rendered by `BlockRenderer`. The
template is **assigned to a specific entity type**, so the editor's variable reference can
offer that type's field schema.

**2.3.2 New content-block "template" type.** A new block type (working name `entity` /
`entity_template`) whose block:
- picks a **content-block template** (which fixes the entity type), and
- picks a **data source**: either a **specific entity instance** (a data object /
  id-or-slug) **or a query** (returning one entity — e.g. "latest post").
At render, the resolved entity is bound into `templateContext` (as
`entities.entity = entityRef(type, data, id)`) and the template subtree renders with
`{{entity.*}}`. Reuses the entity fetch + the `TemplatedContent`/`BlockRenderer` recursion.

**2.3.3 Templates as array-like items (carousels/lists).** Array-like blocks gain an item
variant that is `{ templateId, entityType, ref | query }` (or a **mixed** list of such
items across types). Reuse `HeroCarousel`'s **expand-then-flatten** pattern: a generic
`resolveEntitiesItem` resolves the query/refs and renders each entity through its assigned
template (instead of the fixed post card). Because settings are untyped JSONB, **mixed
entity types in one list need no schema/DTO/migration change** — the lift is the
resolve+render layer. Options: extend `HeroItem.type` with `'template'`/`'entities'`, and/or
introduce a generic `entity_list` block; both reuse the same resolver + template renderer.

**2.3.4 Cross-surface rendering.** Template resolution runs through §2.2's registry, so
template blocks resolve on cms, SSR (once the tree is walked — see §3), and mail alike.

---

## 3. Recommendations — foundational refactors (document-only; do NOT build yet)

These make the new entity/template blocks land on **every** surface (public, admin,
SSR/SEO, mail) without drift. Recorded here as recommendations for the eventual plan; **no
code changes now.**

1. **Collapse the duplicated `BlockType` union** to one shared source (`@sitesurge/types`);
   `config/blockTypes.ts` imports it. Removes a standing drift risk before adding new types.
2. **Make the public `BlockRenderer` data-driven** — a `Record<BlockType, Component>` map
   (parity with SSR/mail), plus registry-driven admin edit/preview. Adding a block type
   becomes a single registration instead of editing multiple `<Switch>`es.
3. **Thread `templateContext` through group/child recursion** so templates nested in groups
   and carousels resolve `{{entity.*}}`. (Required for 2.3.)
4. **Make SSR walk the block tree** (`buildBlockTree` before `renderBlockForSeo`) and render
   entity/template blocks for SEO — otherwise generic content is invisible to crawlers.
   (Also fixes the pre-existing "groups emit nothing in SSR" gap.)
5. **Bridge the pages-vs-posts block-storage divergence** — posts lack `parent_block_id`
   and nest nothing, and use a delete-all-reinsert save on a separate enum. Since posts
   (and other core entities with block bodies) will be generic entities whose bodies/
   templates need nesting, unify onto the pages nesting model (or a shared block store).
6. **Replace ad-hoc entity binding** (`settings.postId/formId/campaignId`) with a generic
   entity-ref shape in block settings (`{ entityType, id|slug|query }`).
7. **Promote `reference.ts` into `@sitesurge/types` and generate it from the registry** so
   cms + SSR + mail share one field catalog.
8. **Reconcile the two block enums** (`block_type` vs `content_block_type`) as part of (5).

---

## 4. Key design decisions & open questions (for the thorough plan)

Deliberately unresolved here — flagged so the follow-up specification can settle them:

- **Runtime table generation:** the migration engine (reuse plugin `pg_advisory_xact_lock` + a `entity_migrations` ledger?), column type mapping, ALTER for extensions, rename/delete
  semantics, index/`search_vector` generation, cross-type relations (FKs / join tables),
  naming (`entity_<key>` vs `ce_<key>` for custom to avoid collisions).
  * answer: the modules should have full control over their entities, and their own tables, using our modified/built-in CMS api or SDK to manage the custom entities. The internal modules and entities can be an example to build that out. They should have full control over their own migrations, etc. Migrations for upgrades (or downgrades) are free to lock the DB to avoid collisions or conflicts. Module DB modifications should surface any errors to system logs and the admin dashboard as alerts/notices.
- **Core-entity adoption strategy (highest-risk):** adopt existing tables in place vs.
  migrate data into generated tables; how "locked core schema + extensible" is enforced;
  how existing bespoke repos/services/routes/DTOs/SDK coexist with or are replaced by the
  generic stack **without breaking the live site** (surge is in production). Likely
  incremental: define core types as thin descriptors over their current tables first, then
  route CRUD through the generic layer.
  * answer: cleanup the existing entities as needed (ie. move to their own managed tables by their modules, using the new generic entity architecture and sdk interface). The existing modules should use the new generic routes if possible, but the core types (pages, posts, users), can keep their existing API interface as a convenience, but it should route to the underlying generic entity service layer and interface. That is just a recommendation, not necessary if it over-complicates things.
- **Feature ↔ entity ownership & uninstall:** enabling `campaigns` scaffolds the `campaign`
  type — does disabling drop the table or retain data? Interaction with the current static
  `FEATURE_REGISTRY.migrations`/`tables` lists.
  * answer: Disabling the feature should just disable it. The "REMOVE" function of features should be the action that drops all of the tables and data (after confirmation).
- **Field type system:** finalize the type set, validation, defaults, uniqueness, relations,
  computed/virtual fields, and the `blocks` body field for block-bodied entities.
  * answer: Try to document all internal entity and custom entity definitions in documentations (ie. docs folder per entity).
- **Template model:** one vs many templates per entity type; default template; versioning;
  preview with a sample entity; how a template block references `(templateId, entityRef |
  query)`; permissioning of template authoring.
  * answer: Each entity type will be able to define any number of templates for itself, and the content blocks in the existing system will then be able to point to a new 'entity template' (or just 'template') type, and will then choose the specific template to use (ie. by name+id).
- **Array-like item model:** extend `HeroItem` union vs a new generic `entity_list` block;
  per-item template override; mixed-type ordering; empty/loading states.
  * answer: You don't need to refactor existing blocks so much, we can take them one by one, but essentially we will start with a new block type called 'template', and when selected, the user will choose which template... then that template will be used for rendering, pointing at a specific entity instance (or array of entities from a query), which we will design. You can modify existing content blocks that cater to this generic entity system if it makes sense to, but don't worry about it, we have to take them one by one.
- **Public routing & SEO:** do custom entities get public `/{type}/{slug}` detail pages and
  sitemap/RSS entries? Which entity types are public.
  * answer: In the custom entity admin UI, yes, we will allow admins to 'toggle' the entity to expose a public route for it, as a details page, and also a similar index page (both as options), which we will work on later, but YES: entity's should optionally get a custom details route for themselves. It would also be nice to be able to customize the route prefix if possible (with collision checks upon saving), but we can start with the actual entity name for now.
- **Cross-cutting:** roles/permissions for entity CRUD + API-key scopes; Redis caching keys
  for generic entities; revisions for custom entities (`RevisionEntityType` currently
  `'post'|'page'`); import/export; MCP tool surface.
  * answer: essentially we can start with public/open entity types (for all read actions), and edit/update/delete would be reserved for admin or other 'editor' roles (with editing permissions) on the backend admin interface. The custom entity definitions can expose the ability to add role-specific access later, so keep that option open. SOME entity read permissions will be confined to specific user roles, ie. some user subscription types might only be able to access some posts (as an example), only if they have a certain subscription level (ie. ROLE). So try to implement that, where an entity (such as a post) can define which roles have access to read it, but that is for a later stage when we do user subscriptions. You can dwesign it or build the basics now to help stub it out, if you want.
- **Naming:** final names for the block types (`entity` / `entity_template` /
  `entity_list`), the tables (`content_block_templates` / `..._blocks`), and the entity
  tables.
  * answer: These are okay... entity for the base entity, content_block_templates for the templates, etc.

---

## 5. Summary of the path

1. **Shared `EntityTypeRegistry`** + generic entity data/API/SDK stack over **per-type
   generated tables** (runtime migrations à la plugins).
2. **Redefine core entities** (`post`/`page`/`user`/`campaign`/`form`/…) as **`internal`
   core types** on that system — locked core schema, admin-extensible — used as the
   reference examples; feature modules scaffold their types on enable.
3. **Admin "Entities" section** for managing all types, schemas, and instances (custom
   types created here; core types managed via feature modules).
4. **Content-block templates** (modeled on `mail_templates`) bound to an entity type, plus
   a **new template block type** (data object or query) and **template-as-carousel-item**
   support (incl. mixed entity types).
5. **Foundational refactors** (§3) done first so the above renders correctly on public,
   admin, SSR/SEO, and mail.

The pure template engine is already entity-agnostic; `mail_templates` already proves a
reusable, entity-owned, nested block subtree; `base.repo`, the plugin runtime-migration
mechanism, and the coverage-tested SSR/mail registries already provide the spine. The work
is to build the generic entity core, collapse the duplicated dispatch into registries, and
add the template/list block layer on top.

**Next:** await the user's fuller specification, then write the detailed implementation
plan (`docs/superpowers/plans/…`).
