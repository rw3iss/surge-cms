# Stylesheet Block Styles + Components (Global Block Templates)

**Goal:** Move every block's style out of inline `style={}` and into a scoped
`<style>` emitted per block, so that styles can be *overridden* by normal cascade
rules — then use that to ship reusable, referenced **block templates** under a new
**Components** admin section.

**Why these are one plan:** the second is impossible without the first. A template's
inner blocks carry inline styles, and an inline style cannot be overridden by any
stylesheet rule. Ship templates on today's inline foundation and every "customise
this instance" request becomes another `!important`.

**Tech stack:** SolidJS (public renderer + admin), Express/PG (SSR + storage),
`@sitesurge/types` for the framework-free emitter shared by both.

---

## Background — the two bugs that motivate this

1. **Carousel breakpoint bug (fixed 2026-09-07, commit `4525b71`).** A carousel's
   default `margin` is inline on the block wrapper, but its per-breakpoint override
   was emitted against a descendant (`.hero-carousel`). The override was powerless —
   not because it lost the cascade, but because it was aimed at a *different element*.
   The fix (`PropTargets` in `utils/blockResponsiveCss.ts`) declares, per CSS
   property, which element that property's default lands on. That map is the seed of
   this plan.

2. **`!important` everywhere.** `blockResponsiveCss` marks every declaration
   `!important` for one reason only: it must beat an inline style. Remove the inline
   style and the hack becomes unnecessary.

### What already exists (do not rebuild)

- `content_block_templates` + `content_block_template_blocks` — a **named, nestable,
  multi-block subtree**, edited with the same `BlockEditor` and the same
  style/breakpoint panel as any page.
- **`content_block_templates.entity_type_key` is already NULLABLE**, and
  `services/contentBlockTemplates.ts` already types it `string | null | undefined`.
  A "global" template needs **no migration**. Only `routes/entities.ts` forces it, by
  injecting `entityTypeKey: params.type` from the URL.
- `utils/blockStyleCss.ts` (`blockStyleLayoutCss`) — the shared style→CSS mapper,
  already used by both the public renderer and the admin preview.
- `utils/blockResponsiveCss.ts` — `@media` emission + the `PropTargets` map.

---

## Architecture

One emitter produces **all** of a block's CSS:

```
blockCss(blockId, style, breakpoints, targets, opts) -> string | null
```

It returns a stylesheet containing the default rules *and* the `@media` rules, both
routed through the same `PropTargets` map. Because one function owns both, a default
and its override cannot target different elements — the carousel bug becomes
unrepresentable rather than merely fixed.

**Selector:** `[data-block-id="<uuid>"]`, plus the target map's descendant suffix.

**Specificity — the migration's one real risk.** `[data-block-id="x"]` is `(0,1,0)`.
The theme's `.layout .btn` is `(0,2,0)` and would **beat** it. Today the inline style
wins, so moving naively to a stylesheet would silently restyle every button, badge and
card on the site. Two ways out:

- **Phase 1 (chosen): keep `!important` on emitted declarations.** This reproduces
  today's effective priority exactly, so the migration is behaviour-preserving and
  reviewable. Override *ordering* still works: among competing `!important`
  declarations, normal specificity-then-source-order applies, so a using-block's rules
  emitted after a template's will win.
- **Phase 6 (later): CSS cascade layers.** `@layer theme, template, block, block-bp;`
  makes layer order beat specificity outright and lets every `!important` go.
  Caveat that decides the effort: **unlayered CSS beats layered CSS**, so this only
  works once the existing theme SCSS is itself wrapped in `@layer theme`. That is
  mechanical but touches every partial — hence its own phase, not a prerequisite.

**Per-block `<style>`, not one per page.** Each block already renders its own
`<style>` inside its wrapper. Keeping that means a block's CSS lives and dies with the
block, which is exactly what a dynamically-inserted template instance needs. Selector
scoping makes position irrelevant. Revisit only if a page with many blocks measures
badly.

---

## Phase 1 — One emitter for default + breakpoint CSS

**Files**
- Modify: `packages/cms/src/utils/blockResponsiveCss.ts` → add `blockCss()`
- Modify: `packages/cms/src/utils/blockResponsiveCss.test.ts`
- Modify: `packages/cms/src/components/blocks/BlockRenderer.tsx`

**Steps**

- [ ] **1.1** Extract the existing per-override serialisation into a private
  `rulesFor(styleBag, targets, opts, mediaCondition?)` returning `string[]`.
  `blockResponsiveCss` keeps its current signature and delegates, so nothing breaks.

- [ ] **1.2** Add `blockCss(blockId, style, breakpoints, targets, opts)`:
  call `rulesFor` once with no media condition for `style` itself (minus the
  `breakpoints` key), then once per breakpoint with its condition. Join with `\n`.

- [ ] **1.3** Tests first. Extend `blockResponsiveCss.test.ts`:
  - default rules are emitted with **no** `@media` wrapper;
  - a carousel's default `margin` lands on the wrapper and its default `height` on
    `.hero-carousel` — i.e. defaults obey `PropTargets` exactly as overrides do;
  - a breakpoint override for the same property targets the **same** selector as its
    default (assert selector equality programmatically — this is the invariant);
  - `blockResponsiveCss` output is unchanged (regression guard).

- [ ] **1.4** In `BlockRenderer`, swap `responsiveCss()` for `blockCss()` and delete
  the corresponding entries from the inline `style={}` object. Keep inline **only**
  for genuinely per-instance runtime values: `slotStyle()` (a group slot's flex, which
  is derived from the *parent's* settings, not this block's style) and the
  background-image/overlay composition.

- [ ] **1.5 — Verification is visual, not unit.** Screenshot the homepage, `/shop`,
  a post and a page at desktop + mobile before and after. Diff them. Any change is a
  specificity regression, not an improvement. Run the existing Playwright probes in
  `/tmp/pv2/` (`carousel.mjs`, `bpfix.mjs`) — the carousel margins must be identical.

**Risk:** medium-high. This touches every block on every page. It is the only phase
that can silently restyle the site; budget the visual diff properly.

---

## Phase 2 — Global (entity-less) block templates

No migration. The column is already nullable.

**Files**
- Modify: `packages/api/src/repositories/contentBlockTemplates.repo.ts`
- Modify: `packages/api/src/services/contentBlockTemplates.ts`
- Modify: `packages/api/src/routes/entities.ts` (or a new `routes/components.ts`)
- Modify: `packages/api/src/services/cache.ts` (`CACHE_KEYS`)
- Modify: `packages/cms-client/src/modules/*`

**Steps**

- [ ] **2.1** `repo.listGlobal()` → `WHERE entity_type_key IS NULL`.
- [ ] **2.2** `service.listGlobal()` with its own cache key. Add
  `contentBlockTemplatesGlobal` to `CACHE_KEYS` (never call `cache.del` directly —
  `services/cache-contract.test.ts` fails the build if you do) and a matching
  `invalidateContentBlockTemplatesGlobalCache()`. Extend the existing `invalidate()`
  helper so a `null` key invalidates the global list instead of no-opping.
- [ ] **2.3** Routes under `/api/v1/components/templates` — full CRUD, `staff` tier
  for writes, `optional` for reads (the public renderer must fetch them anonymously).
  Reuse the existing `:type/templates` handlers; the only difference is not injecting
  `entityTypeKey`.
- [ ] **2.4** SDK: `cms.components.templates.*`. Run
  `npm run check:drift -w packages/cms-client` — it fails on uncovered routes.
- [ ] **2.5** `npm run docs:api` (generated; never hand-edit `docs/API.md`).

**Verification:** create a global template via the SDK, confirm it does **not** appear
in any `/entities/:type/templates` list and vice versa.

---

## Phase 3 — Components admin section

**Files**
- Create: `packages/cms/src/pages/admin/components/ComponentsList.tsx`
- Create: `packages/cms/src/pages/admin/components/ComponentEditor.tsx`
- Modify: `packages/cms/src/App.tsx`, the admin sidebar, `pages/admin/styles/_*.scss`

**Steps**

- [ ] **3.1** Sidebar section **Components** → `/admin/components`. Admin-only.
- [ ] **3.2** List page: name, block count, updated-at, New/Edit/Copy/Delete.
- [ ] **3.3** Editor: reuse `TemplateEditor` wholesale — it is already a full
  `BlockEditor` with the style/breakpoint panel. The only change is which endpoint it
  loads/saves and hiding the entity Binding section when there is no entity type.
  Add `admin-full-bleed` to the root (see CLAUDE.md → Admin styles).
- [ ] **3.4** Forms must use `FormField`; text inputs commit on **blur**, and any
  editable list lives in `createStore` (CLAUDE.md → Admin styles).

---

## Phase 4 — The `template` block type

**Files**
- Modify: `packages/shared/src/utils/blockCatalog.ts` (`ALL_BLOCK_TYPES`)
- Create: `packages/cms/src/components/admin/blocks/types/TemplateBlock.tsx`
- Modify: `packages/cms/src/components/blocks/BlockRenderer.tsx`
- Modify: `packages/api/src/services/ssr/blocks/`, `packages/api/src/services/mail/blocks/`

**Steps**

- [ ] **4.1** Add `'template'` to `ALL_BLOCK_TYPES`. This **will fail to compile**
  until the SSR and mail registries declare an arm — that is the catalog's designed
  behaviour, not an obstacle. Coverage tests: `ssr/blocks/blocks.test.ts`,
  `mail/blocks/coverage.test.ts`.
- [ ] **4.2** Admin panel: a dropdown of global templates → `settings.templateId`.
- [ ] **4.3** Public renderer: fetch the template by id **at render time** (a
  reference, not a copy — editing the template updates every use), assemble its blocks
  with the shared `buildBlockTree(flat)`, and render the subtree.
- [ ] **4.4** SSR arm: walk the subtree and emit its blocks. Note the pre-existing gap
  — `ssr/routes.ts` feeds a *flat* block list, so nested children are already not
  walked for `group`. Do not let `template` silently inherit that; either fix the flat
  feed or mark the arm `notIndexable` with a comment saying why.
- [ ] **4.5** Guard recursion: a template containing a `template` block that
  references itself must not hang the renderer. Track visited ids down the render
  path and stop with a visible editor-only warning.

---

## Phase 5 — The style cascade

**The rule:** the template's own block styles are the base; the *using* block's style
overrides them.

- [ ] **5.1** Emit the template's inner-block CSS first, then the using block's CSS.
  Both are `!important` after Phase 1, so source order decides — which is why the
  using block must be emitted second.
- [ ] **5.2** **Scope the override to the wrapper only.** The using block's style
  applies to the `template` block's own wrapper (margin, width, background, padding).
  Do **not** attempt per-inner-block overrides in this phase.
- [ ] **5.3** Document the limit in the editor UI: one line under the style panel
  saying instance styles affect the block's outer frame, and that inner appearance is
  edited on the component itself. An honest limit beats a half-working override.

**Deferred (own design):** per-inner-block overrides. It needs a stable address for
each inner block (its template-relative id) and a place to store a sparse override map
on the using block. Cheap to add *after* Phase 1, effectively impossible before it.

---

## Phase 6 — SSR parity and dropping `!important`

- [ ] **6.1** SSR currently emits **no** block styles at all, so server-rendered pages
  are unstyled until the SPA mounts. Move the emitter into `@sitesurge/types` — the
  precedent is the template engine (`packages/shared/src/template/`), moved so the
  client and SSR could share one implementation — then have SSR emit the same
  stylesheet. This is a straight win that the inline approach could never deliver.
- [ ] **6.2** Wrap the theme SCSS in `@layer theme`, introduce
  `@layer theme, template, block, block-bp`, and delete every `!important` from the
  emitter. Verify with the same before/after screenshot diff as Phase 1.

**Known gap this does not fix:** the admin's breakpoint *preview* caps a container's
width, which cannot fire viewport `@media`. It will still need the existing inline
simulation (`stores/previewBreakpoint.ts`) unless the emitter also emits a container-
query variant. Out of scope; note it in the UI.

---

## Sequencing

Phase 1 alone is worth shipping — it removes `!important`'s reason to exist and makes
the carousel class of bug unrepresentable. Phases 2–4 are additive and independently
releasable. Phase 5 is small once 1 lands. Phase 6 is cleanup with a real SSR payoff.

Do **not** start Phase 5 before Phase 1. Overriding an inline style is not possible,
and any attempt will reintroduce `!important`.
