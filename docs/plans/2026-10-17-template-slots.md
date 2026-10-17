# Entity-template slots — contract

Status: IN PROGRESS (2026-10-17). Every agent builds to THIS contract.

A content-block **template** (entity template or global component) may declare **slots**: named data inputs of a given entity type, single or array. The template's own blocks (first: **Gallery**, **Posts**) can take their data from a slot instead of their own query. The **using** `entity` block (in a page, post, mail template…) fills each slot with a binding — specific records or a live query — so whoever places the template chooses the data, not the template author.

## Data — DONE
- Migration `155_template_slots.sql` (core, no feature tag): `ALTER TABLE content_block_templates ADD COLUMN IF NOT EXISTS slots JSONB NOT NULL DEFAULT '[]'::jsonb;`
- Shared types (`packages/shared/src/entities/templates.ts` + `entityBlock.ts`):
```ts
/** A data input a template exposes; filled by the block that uses the template. */
export interface TemplateSlot {
  id: string;          // identifier, /^[a-z][a-z0-9_]{0,39}$/i, unique within the template
  label?: string;      // optional display name (falls back to id)
  entityType: string;  // an entity type key (post, gallery_item, product, event, campaign, page, form, comment, forum_thread, contact, custom types…)
  array: boolean;      // true = a list of records
}
// ContentBlockTemplate gains: slots?: TemplateSlot[]   (create/update DTOs accept it)

/** How a using block fills one slot — the same shape as an entity binding minus context/none. */
export type SlotBinding =
  | { mode: 'single'; ref: string; }
  | { mode: 'list'; refs: string[]; }
  | { mode: 'query'; query: EntityQuery; };
// EntityBlockSettings gains: slots?: Record<string /* slot id */, SlotBinding>
```
- Validation (server): slot ids unique + format; `entityType` must be a registered entity type; a non-array slot's binding resolves to at most 1 record (`list` capped at 1; `query` limit 1).

## Blocks that read a slot — DONE
- **Chosen field names:** Gallery `GalleryBlockSettings.source: 'slot'` + `slotId`. Posts (`post_list`) `source?: 'default' | 'slot'` + `slotId` (`PostListSlotSettings` in `entities/entityBlock.ts`; absent `source` = the existing pinned + query behaviour). On the web a slot Posts block renders its slot posts as pinned posts in slot order (query branch off, no empty message).
- Pure helpers (`@sitesurge/types` `entities/slots.ts`): `slotFor`, `capSlotBinding`, `isSlotBindingFilled`, `autoSlotBinding`, `previewSlotBindings`, `slotPlaceholderText`, `normalizeTemplateSlots`, `TemplateSlotContext`.
- **Gallery** (`GalleryBlockSettings.source`): add `'slot'` + `slotId?: string`. Data = the slot's records (entity type `gallery_item` — the `gallery_item` entity type maps 1:1 to gallery items). Layout/settings as usual.
- **Posts** (`post_list` block settings): add a source/mode `'slot'` + `slotId` (read the current PostListBlock settings to pick the field name that fits — e.g. `source: 'query' | 'manual' | 'slot'`). Data = the slot's `post` records, same display.
- A block whose slot is missing, unfilled, or of an incompatible type renders nothing on the site/email and an explanatory placeholder in the admin preview ("Slot `x` is not filled by the block using this template").

## Resolution (one rule, every surface) — DONE
- Web: `components/blocks/slotContext.tsx` (`SlotContext` provided by `EntityBlock`, `TemplateBlock`, and carousel entity slides via `renderEntityTemplateSlide({ slots })`; `useSlotContext()` falls back to `templatePreviewSlotContext()` from `stores/templatePreviewContext.ts`, derived from `stores/templateSlots.ts` — the TemplateEditor only has to publish its slots there). `slotRecordsFor` uses `services/entityBinding.resolveRecords`.
- Server: `services/templateSlots.ts` (`resolveBindingRecords` — also now the entity block's own resolver in mail — and `resolveSlotRecords`). Mail `expandBlocks` stamps `__slotContext` on slot-reading blocks it clones and resolves them in the next pass; `resolveGalleryBlockItems` returns [] for a bare `source:'slot'` (never the stale query).
- SSR: entity/template blocks are still not SSR-rendered (known gap, unchanged).
When an `entity` (or `template`) block renders a template, it passes `slotBindings = settings.slots ?? {}` + the template's `slots` definitions down the render context. A slot-reading block resolves its binding through the SAME resolver the entity block already uses for its own binding (`services/entityBinding.ts` on the web / `entities` service on the server) → records → for Gallery: gallery item ids → the normal gallery item list (`ids`, keeping order); for Posts: post records/ids → the normal post list render.
Surfaces: admin template editor preview (uses the template's own **sample** slot values: when editing a template, each slot can have a preview binding stored as `previewBinding?: SlotBinding` on the TemplateSlot, else auto — first N records of the type), admin page/post/mail editors (via BlockPreview → BlockRenderer templateContext), public site, SSR (where the entity block is SSR'd — today it is not; keep the gap, note it), and EMAIL (`services/mail` expandDynamicBlocks / entity-template expansion — gallery + post_list email renderers must honour slot data).

## Admin UI — DONE (2026-10-17)
Built: `components/admin/entities/EntityTypeSelect.tsx`, `TemplateSlotsEditor.tsx` (Slots section in `TemplateEditor`, saved as `slots`; save refuses a bad/duplicate id or a missing type), `stores/templateSlots.ts`, pure helpers `utils/templateSlots.ts` (+ test), slot rows in `EntityBlock.tsx` (`settings.entity.slots[id]`), Slot source in `GalleryBlockEdit.tsx` (`source:'slot'`, `slotId`) and `PostListBlock.tsx` (`source:'slot'`, `slotId`). Every slot binding / preview binding is set with the shared **Set data…** (`DataBindingField` → `EntitySearchSelectModal mode="data"`): tick records for a selection, tick none for a live query. Note: `gallerySettingsOf` still normalises `source` to items|query; the edit panel reads `slot` from the raw settings, but the renderer must keep `'slot'`.
- **`EntityTypeSelect`** (new, generic, `components/admin/entities/EntityTypeSelect.tsx`): a searchable single-select dropdown over ALL entity types (`cms.entityTypes.list()` — core + feature + custom), filter-as-you-type on label + key, shows label + key + origin hint; keyboard; click-outside. Reusable anywhere an entity type is chosen.
- **Template editor** (`pages/admin/entities/TemplateEditor.tsx`): a **Slots** section ABOVE the Template Blocks area: header + "+ Add slot". Each row: ID (text, commit on blur), Label (optional), Data type (`EntityTypeSelect`), Array (Toggle), remove (×), and a "Preview data…" button (opens `EntitySearchSelectModal` for that type → `previewBinding`). Rows in `createStore`. Saved with the template.
- **Entity block panel** (`components/admin/blocks/types/EntityBlock.tsx`): when the chosen template has slots, a **Slots** list: one row per slot — label/id, `entityType` + `[]` when array, a summary of the current binding ("3 selected", "Live: newest 6", "Not set"), and **Configure…** → the shared `EntitySearchSelectModal` (single / multiple / query modes; single only when `array` is false) → writes `settings.slots[id]`. Clear button.
- **Gallery block panel** (`GalleryBlockEdit.tsx`): Source gains **Slot**; when chosen, a dropdown of the template's slots shown as `id (gallery_item[])` — incompatible types listed disabled. Only offered when the block is inside a template that has slots (the editor knows it is editing a template: TemplateEditor publishes the current slots via a small store, e.g. `stores/templateSlots.ts`).
- **Posts block panel**: same Slot source option + dropdown (type `post`).

## API / SDK — DONE
- Both template routes accept `slots` (`api/templateSlotInput.ts`, structural zod) and the service validates/normalises it (400 on a bad id, duplicate, unknown entity type, > 20 slots). `ContentBlockTemplateCreateBody.slots`. Content-block templates have no copy/revision path today, so nothing else needed the column.
- Template create/update (`/api/v1/entities/:type/templates`, `/api/v1/components/templates`) accept/return `slots`. SDK types follow (no new methods needed beyond the DTO change). Regenerate docs (`npm run docs:api`, `cd packages/cms && npm run docs:sdk`).
- Revisions/cloning copy the column by name already (check `blockStores` / template copy include it).

## List render + template data — DONE (2026-10-17)
- Migration `156_template_list_render.sql`: `content_block_templates.list_render TEXT NOT NULL DEFAULT 'each'` (CHECK each|once). `ContentBlockTemplate.listRender?: 'each' | 'once'` (list mode only; absent = `each`); both template routes accept it.
- `each` = one render per record (unchanged). `once` = ONE render: singular var = first record, plural var = all records.
- **Template data** = the record(s) of the current render: `TemplateSlotContext.templateData = { entityType, records }` (`templateDataOf`). Pure helpers in `@sitesurge/types` `entities/templateData.ts`: `templateRenderGroups`, `rendersOnce`, `templateListRenderOf`, `templateDataOf`, `templateDataFor(ctx, expectedType)` (→ ok | `none` | `incompatible`), `templateDataIds`, `templateDataPlaceholderText`. Id-less stub records (`none`/`context` bindings with no entity) count as no data. A component (`template` block) carries none.
- Web: `renderEntityTemplateSlide({ records })` provides it via `withTemplateData` (slotContext.tsx); `EntityBlock` + `ResolvedHeroCarousel` group records with `templateRenderGroups`. Template editor preview: `templatePreviewData` (sample — all for `once`, else the first). Email: `expandBlocks` stamps it (with the slot context, `__slotContext`) on blocks with `source: 'template'`.
- **Gallery** `source: 'template'`: the `gallery_item` template data ids, in order → the normal gallery list. Admin: Source "Template data" only when the open template binds `gallery_item` (`stores/templateSlots` `templateInfo`; `utils/templateSlots.templateDataSourceState`); a mismatched block keeps the option disabled-selected with "Warning: 'gallery' expects 'gallery_item' template data."; a list template in `each` mode gets a hint to switch Render to "Once, with all records".
- Posts: not wired; reuse `templateDataFor(ctx, 'post')` the same way.
