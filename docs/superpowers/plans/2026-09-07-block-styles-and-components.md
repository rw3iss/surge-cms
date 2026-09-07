# Stylesheet Block Styles + Components (Global Block Templates)

**Goal:** Move every block's style out of inline `style={}` and into a scoped
`<style>`, ordered by **CSS cascade layers** so precedence is declared rather than
fought — then use that foundation to ship reusable, referenced **block templates**
under a new **Components** admin section.

**Why these are one plan:** the second is impossible without the first. A template's
inner blocks carry inline styles, and an inline style cannot be overridden by any
stylesheet rule. Ship templates on today's foundation and every "customise this
instance" request becomes another `!important`.

**No `!important` anywhere.** That is a hard requirement of this plan, not an
aspiration. See *Cascade design* for how it is met in the first pass.

**Tech stack:** SolidJS (public renderer + admin), PostCSS (build-time layer wrap),
Express/PG (SSR + storage), `@sitesurge/types` for the framework-free emitter shared
by client and server.

---

## Background — the two bugs that motivate this

1. **Carousel breakpoint bug** (fixed 2026-09-07, commit `4525b71`). A carousel's
   default `margin` is inline on the block wrapper, but its per-breakpoint override
   was emitted against a descendant (`.hero-carousel`). The override was powerless —
   not because it lost the cascade, but because it was aimed at a *different element*.
   The fix (`PropTargets` in `utils/blockResponsiveCss.ts`) declares, per CSS
   property, which element that property's default lands on. That map is the seed of
   this plan.

2. **`!important` everywhere.** `blockResponsiveCss` marks every declaration
   `!important` for exactly one reason: it must beat an inline style. Remove the
   inline style and the hack loses its purpose.

### What already exists (do not rebuild)

- `content_block_templates` + `content_block_template_blocks` — a **named, nestable,
  multi-block subtree**, edited with the same `BlockEditor` and style/breakpoint panel
  as any page.
- **`content_block_templates.entity_type_key` is already NULLABLE**, and
  `services/contentBlockTemplates.ts` already types it `string | null | undefined`.
  A "global" template needs **no migration**. Only `routes/entities.ts` forces one, by
  injecting `entityTypeKey: params.type` from the URL.
- `utils/blockStyleCss.ts` (`blockStyleLayoutCss`) — the shared style→CSS mapper, used
  by both the public renderer and the admin preview.
- `utils/blockResponsiveCss.ts` — `@media` emission + the `PropTargets` map.

### Measured facts this plan relies on

- **107 SCSS files, all imported directly from components.** There is no single import
  chain, so wrapping the theme by hand means touching all 107. A PostCSS plugin does
  it in one place instead.
- **The theme contains no ID selectors**; its specificity ceiling is roughly three
  classes. (Not that it ends up mattering — see below.)
- **CSP already permits inline `<style>`** — `style-src` includes `'unsafe-inline'`.
- **SSR currently emits no block styles at all**, so server-rendered pages are
  unstyled until the SPA mounts.

---

## Cascade design

Precedence is expressed with `@layer`, declared once, globally:

```css
@layer theme, tpl, block, block-bp;
```

| Layer      | Contents                                        | Emitted by                          |
|------------|-------------------------------------------------|-------------------------------------|
| `theme`    | all build-time CSS (107 SCSS files + `plyr.css`)| PostCSS wrap plugin                 |
| `tpl`      | a block template's inner-block styles           | template render path                |
| `block`    | a block's own default style                     | `blockCss()`                        |
| `block-bp` | a block's per-breakpoint overrides              | `blockCss()`, inside `@media`       |

**Layer order beats specificity outright**, so no selector arithmetic and no
`!important` is needed at any level. `[data-block-id="x"]` — specificity `(0,1,0)` —
wins against a theme rule of any complexity purely by sitting in a later layer.

**Verified, not assumed.** A browser check confirmed the underlying rule: a `(0,1,0)`
declaration outside the `theme` layer beat a `(0,5,0)` declaration inside it. The same
mechanism gives `block` priority over `theme`.

Two consequences worth stating plainly:

- **This reproduces today's semantics exactly.** Block styles are inline today, so
  they already beat every theme rule. Putting them in a later layer preserves that,
  which is what makes the migration behaviour-preserving rather than a restyle.
- **Ordering becomes position-independent.** A template's `<style>` is nested *inside*
  the instance's wrapper, so the instance's rules appear *earlier* in document order
  and would lose a source-order contest. Layers make document position irrelevant, so
  Phase 5's "instance overrides template" rule holds structurally.

### The one real risk: escaping the wrap

Anything that reaches the page **unlayered** beats every layer, including `block`.
That is the failure mode to guard:

- CSS injected at runtime by a **plugin** (`client.js` may add its own `<style>`).
- A `<style>` written literally into a component's JSX.
- Any CSS loaded from a CDN `<link>` rather than through the build.
- A **Custom HTML block's** `<style>` (author-controlled — arguably correct that it
  wins, but it must be a decision, not an accident).

Mitigation is a test, not vigilance: see step 1.6.

---

## Phase 1 — Layered stylesheet block styles

**Files**
- Create: `config/cms/postcss.config.mjs`
- Modify: `packages/cms/index.html` (layer-order declaration)
- Modify: `packages/cms/src/utils/blockResponsiveCss.ts` → add `blockCss()`
- Modify: `packages/cms/src/utils/blockResponsiveCss.test.ts`
- Create: `packages/cms/src/utils/cascadeLayers.test.ts`
- Modify: `packages/cms/src/components/blocks/BlockRenderer.tsx`
- Modify: `packages/cms/src/components/admin/blocks/ContentBlock.tsx`

**Steps**

- [ ] **1.1 — Declare the layer order first.** Add a literal
  `<style>@layer theme, tpl, block, block-bp;</style>` as the **first** element in
  `<head>` in `packages/cms/index.html`. The first `@layer` statement to name a layer
  fixes its position; later mentions cannot reorder it. Putting this in a runtime-
  injected stylesheet instead would race the bundled CSS and silently invert the
  order — hence static HTML, before anything else loads.

- [ ] **1.2 — Wrap the theme.** Add `config/cms/postcss.config.mjs` with a plugin that
  wraps each processed stylesheet's root nodes in `@layer theme { … }`, skipping files
  that already declare a layer and skipping `@charset`/`@import` (which must stay at
  the top). Point Vite at it. This catches all 107 SCSS files plus `plyr.css` in one
  place; do **not** edit the SCSS files individually.

- [ ] **1.3 — Extract the shared serialiser.** In `blockResponsiveCss.ts`, pull the
  existing per-override work into a private
  `rulesFor(styleBag, targets, opts, mediaCondition?): string[]`. Give it a `layer`
  argument that wraps its output in `@layer <name> { … }`. `blockResponsiveCss` keeps
  its signature and delegates, so nothing else moves yet.

- [ ] **1.4 — Add `blockCss()`.**
  `blockCss(blockId, style, breakpoints, targets, opts, { defaultLayer = 'block' })`:
  call `rulesFor` once for `style` itself (minus its `breakpoints` key) into
  `defaultLayer`, then once per breakpoint into `block-bp` with that breakpoint's
  media condition. `defaultLayer` is what lets the template path emit into `tpl`
  instead, with no second code path.

- [ ] **1.5 — Tests before the swap.** Extend `blockResponsiveCss.test.ts`:
  - default rules are emitted with **no** `@media` wrapper, inside `@layer block`;
  - breakpoint rules land in `@layer block-bp`;
  - **no output contains `!important`** (assert this directly — it is the requirement);
  - a carousel's default `margin` targets the wrapper while its default `height`
    targets `.hero-carousel` — i.e. defaults obey `PropTargets` exactly as overrides do;
  - for every property, the selector used for a breakpoint override is **identical**
    to the selector used for its default (assert programmatically — this invariant is
    what makes the carousel bug unrepresentable);
  - `blockResponsiveCss`'s existing output is unchanged (regression guard).

- [ ] **1.6 — Guard the wrap.** Add `cascadeLayers.test.ts`: build the CSS, then assert
  every top-level rule in the emitted bundle sits inside an `@layer`. Fail with the
  offending file and selector. Without this, one stray unlayered stylesheet silently
  outranks every block style and the cause is near-impossible to spot by eye.

- [ ] **1.7 — Swap the renderer.** In `BlockRenderer`, replace `responsiveCss()` with
  `blockCss()` and delete the corresponding entries from the inline `style={}` object.
  Keep inline **only** for genuinely per-instance runtime values: `slotStyle()` (a
  group slot's flex, derived from the *parent's* settings rather than this block's
  style) and the background-image/overlay composition. Mirror the change in
  `ContentBlock.tsx` so the admin preview uses the same emitter — that shared-emitter
  requirement is why `blockStyleCss.ts` exists at all.

- [ ] **1.8 — Verify visually, not just by unit test.** Screenshot the homepage,
  `/shop`, a post and a page at desktop and mobile, before and after. Diff them. Any
  visual change is a cascade regression, not an improvement. Re-run the Playwright
  probes in `/tmp/pv2/` (`carousel.mjs`, `bpfix.mjs`); carousel margins must be
  byte-identical to today's values.

**Risk:** medium. It touches every block on every page, but the layer design means the
expected diff is *empty*. A non-empty diff is a bug, which makes verification easy to
judge.

---

## Phase 2 — Global (entity-less) block templates

No migration. The column is already nullable.

**Files**
- Modify: `packages/api/src/repositories/contentBlockTemplates.repo.ts`
- Modify: `packages/api/src/services/contentBlockTemplates.ts`
- Create: `packages/api/src/routes/components.ts`
- Modify: `packages/api/src/services/cache.ts` (`CACHE_KEYS`)
- Modify: `packages/cms-client/src/modules/`

**Steps**

- [ ] **2.1** `repo.listGlobal()` → `WHERE entity_type_key IS NULL`.
- [ ] **2.2** `service.listGlobal()` with its own cache key. Add
  `contentBlockTemplatesGlobal` to `CACHE_KEYS` and a matching
  `invalidateContentBlockTemplatesGlobalCache()`. Never call `cache.del`/`delPattern`
  from a service — `services/cache-contract.test.ts` fails the build if you do. Extend
  the existing `invalidate()` helper so a `null` key invalidates the global list
  rather than no-opping (it already accepts `null`).
- [ ] **2.3** Routes at `/api/v1/components/templates` — full CRUD, `staff` for
  writes, `optional` for reads (the public renderer fetches them anonymously). Reuse
  the existing `:type/templates` handlers; the only difference is not injecting
  `entityTypeKey`.
- [ ] **2.4** SDK `cms.components.templates.*`. Run
  `npm run check:drift -w packages/cms-client`; it fails on uncovered routes.
- [ ] **2.5** `npm run docs:api` (generated — never hand-edit `docs/API.md`).

**Verification:** create a global template via the SDK; confirm it does **not** appear
in any `/entities/:type/templates` list, and vice versa.

---

## Phase 3 — Components admin section

**Files**
- Create: `packages/cms/src/pages/admin/components/ComponentsList.tsx`
- Create: `packages/cms/src/pages/admin/components/ComponentEditor.tsx`
- Modify: `packages/cms/src/App.tsx`, the admin sidebar, `pages/admin/styles/_*.scss`

**Steps**

- [ ] **3.1** Sidebar section **Components** → `/admin/components`, admin-only.
- [ ] **3.2** List page: name, block count, updated-at, New/Edit/Copy/Delete.
- [ ] **3.3** Editor: reuse `TemplateEditor` wholesale — it is already a full
  `BlockEditor` with the style/breakpoint panel. The only changes are which endpoint
  it loads and saves, and hiding the entity Binding section when there is no entity
  type. Add `admin-full-bleed` to the root (CLAUDE.md → Admin styles).
- [ ] **3.4** Follow the admin conventions: `FormField` for every field; text inputs
  commit on **blur**; any editable list lives in `createStore`, never
  `createSignal<T[]>`.

---

## Phase 4 — The `template` block type

**Files**
- Modify: `packages/shared/src/utils/blockCatalog.ts` (`ALL_BLOCK_TYPES`)
- Create: `packages/cms/src/components/admin/blocks/types/TemplateBlock.tsx`
- Modify: `packages/cms/src/components/blocks/BlockRenderer.tsx`
- Modify: `packages/api/src/services/ssr/blocks/`, `packages/api/src/services/mail/blocks/`

**Steps**

- [ ] **4.1** Add `'template'` to `ALL_BLOCK_TYPES`. This **will fail to compile**
  until the SSR and mail registries each declare an arm — that is the catalog's
  designed behaviour, not an obstacle. Coverage tests: `ssr/blocks/blocks.test.ts`,
  `mail/blocks/coverage.test.ts`.
- [ ] **4.2** Admin panel: a dropdown of global templates → `settings.templateId`.
- [ ] **4.3** Public renderer: fetch the template by id **at render time** (a
  reference, not a copy — editing the template updates every use), assemble its blocks
  with the shared `buildBlockTree(flat)`, and render the subtree with
  `defaultLayer: 'tpl'`.
- [ ] **4.4** SSR arm: walk the subtree and emit its blocks. Note the pre-existing gap
  — `ssr/routes.ts` feeds a *flat* block list, so nested children are already not
  walked for `group`. Do not let `template` silently inherit it: either fix the flat
  feed or mark the arm `notIndexable` with a comment saying why.
- [ ] **4.5** Guard recursion. A template containing a `template` block that references
  itself must not hang the renderer. Track visited ids down the render path and stop
  with an editor-only warning.

---

## Phase 5 — The instance override cascade

With layers in place this is nearly free: the template's inner blocks emit into `tpl`,
the using block emits into `block`, and `block` is declared after `tpl`.

- [ ] **5.1** Render the template subtree with `defaultLayer: 'tpl'` (Phase 4.3
  already does this). No ordering logic and no specificity arithmetic is required —
  and critically, no dependence on document order, which would otherwise favour the
  template because its `<style>` is nested *inside* the instance's wrapper.
- [ ] **5.2** **Scope the instance override to the wrapper only** — margin, width,
  background, padding on the `template` block's own frame. Do not attempt
  per-inner-block overrides in this phase.
- [ ] **5.3** Say so in the editor: one line under the style panel explaining that
  instance styles affect the block's outer frame and inner appearance is edited on the
  component itself. An honest limit beats a half-working override.

**Deferred (own design):** per-inner-block overrides. Needs a stable address for each
inner block (its template-relative id) plus a sparse override map on the using block.
Cheap after Phase 1; effectively impossible before it.

---

## Phase 6 — SSR parity

- [ ] **6.1** Move the emitter into `@sitesurge/types`. The precedent is the template
  engine (`packages/shared/src/template/`), moved so the client and SSR could share
  one implementation.
- [ ] **6.2** Have SSR emit the layer-order statement and the same block CSS. Server-
  rendered pages are currently unstyled until the SPA mounts, so this is a straight
  win the inline approach could never deliver.

**Known gap this does not close:** the admin's breakpoint *preview* caps a container's
width, which cannot fire viewport `@media`. It still needs the existing inline
simulation (`stores/previewBreakpoint.ts`) unless the emitter also produces a
container-query variant. Out of scope; note it in the UI.

---

## Sequencing

Phase 1 is worth shipping alone: it deletes every `!important` from block styling and
makes the carousel class of bug unrepresentable. Phases 2–4 are additive and
independently releasable. Phase 5 is nearly free once 1 and 4 land. Phase 6 is cleanup
with a real SSR payoff.

Do **not** start Phase 5 before Phase 1. Overriding an inline style is not possible,
and any attempt will reintroduce `!important`.
