# Improvement Audit — 2026-09-07

## 1. Summary

- **Project:** SiteSurge CMS (`@sitesurge/*` monorepo)
- **Working directory:** `/home/rw3iss/Sites/rw/rw-cms`
- **Scope:** the 19 commits shipped today — cascade-layer block styles, Components
  (global block templates + `template` block + component JS), Save as Component,
  shop `storeEnabled` gating, the route-scoped layout store, and the generated
  SDK help reference.
- **Total findings: 8** (UI: 3, styling: 1, architecture: 4)

Everything below is a defect or duplication **introduced today**, found by
re-reading the new code rather than from memory. One is a genuine rendering bug.

---

## 2. UI & UX improvements

### U1 — `.template-block__root` is an unstyled block box *(correctness, not polish)*

- **Location:** `packages/cms/src/components/blocks/BlockRenderer.tsx:1169`
- **Problem:** the `template` block wraps its rendered subtree in a plain `<div>`
  so the component script has something to mount against. Measured on production:
  `display: block` — an extra layout box between `.block__inner` and the
  template's own blocks.
- **Why it matters:** it silently breaks two documented mechanisms. The carousel
  entity-slide height chain runs `block → .block__inner → .html-block`, all
  `height: 100%`; an unstyled div in the middle terminates it. A `template` block
  placed in a group slot makes *the wrapper* the flex item rather than the blocks.
  Neither fails loudly — the layout is just wrong.
- **Fix:** `display: contents` on the wrapper. It keeps the element as a mount
  target and a `querySelector` root while removing it from layout.
- **Risk:** low. Verified the component still renders and the script still mounts.

### U2 — No `:focus-visible` on controls added today

- **Location:** `.sdk-modules__toggle` (`Help.scss`),
  `.template-script-section` toggle (`_block-editor.scss`),
  `.shop-product-editor__media-remove` (`_shop.scss`)
- **Problem:** all three are `<button>`s with custom backgrounds and no focus ring.
- **Why it matters:** keyboard users get no indication of position. The media
  remove button is worse than the others — it only becomes visible on hover, so
  focus is invisible *and* the control is invisible.
- **Fix:** a visible `:focus-visible` outline on each, using existing tokens.
- **Risk:** low — additive, mouse users see no change.

### U3 — `shop-store__loading` duplicated 8×

- **Location:** the seven `/shop/*` pages plus `ShopStoreGuard`
- **Problem:** `<div class="shop-store__loading">Loading…</div>` written out at
  each call site.
- **Fix:** folded into the guard as part of A2 below; the remaining in-page uses
  are for data loading, which is a different state and correctly stays.
- **Risk:** low.

---

## 3. Styling & design system

### S1 — Component styles for today's features are in the right partials, but one is orphaned

- **Location:** `packages/cms/src/pages/admin/Help.scss`
- **Problem:** `.sdk-modules` uses `color.adjust(...)` and relies on the Vite
  `additionalData` prelude for `@use 'sass:color'`. That works, but I initially
  added a duplicate `@use` and the build failed with a confusing
  "already a module with namespace color". Nothing is broken now; the note is
  recorded so the next person doesn't repeat it.
- **Fix:** none needed. Documented in the audit only.
- **Risk:** n/a.

---

## 4. Architecture & code quality

### A1 — `JsEditor` is a near-verbatim copy of `CssEditor`

- **Location:** `packages/cms/src/components/admin/common/JsEditor.tsx` (81 lines)
  vs `CssEditor.tsx` (80 lines)
- **Problem:** I created it today with `sed`. A structural diff shows the files
  differ only in the CodeMirror language extension and the wrapper class name —
  every behaviour (blur sync, Ctrl/Cmd+S flush ordering, external-value guard) is
  duplicated. Two copies of the "flush before the global save shortcut fires"
  subtlety is exactly the kind of thing that drifts.
- **Fix:** extract `CodeEditor` taking a `language: 'css' | 'javascript'` prop.
  Keep `CssEditor`/`JsEditor` as thin named wrappers so no call site changes.
- **Risk:** low-medium — one shared component, two callers, both verified.

### A2 — `ShopIndex` re-implements the guard it is already inside

- **Location:** `packages/cms/src/pages/shop/ShopIndex.tsx:457-470`,
  `ShopStoreGuard.tsx:27-40`
- **Problem:** both create a `ready` resource around `loadShopSettings()`, both
  render their own `Loading…` fallback, and both lazily import `NotFound`.
  `ShopIndex` renders *inside* `ShopStoreGuard`, so this is the same gate twice.
- **Fix:** let `requireStoreEnabled` accept `boolean | (() => boolean)`, evaluated
  after settings resolve. `ShopIndex` then passes
  `requireStoreEnabled={() => !usesOwnPage()}` and keeps only the page-vs-grid
  switch — the readiness gate, the 404 and the loading state all live in one place.
- **Risk:** medium — touches storefront gating shipped hours ago. Covered by the
  existing 4-case matrix test plus a re-run of the browser matrix.

### A3 — `Header` calls `loadShopSettings()` during render

- **Location:** `packages/cms/src/components/layout/Header.tsx:571`
- **Problem:** `void loadShopSettings();` sits in the component body, so a network
  fetch is kicked off as a side effect of rendering.
- **Why it matters:** it happens to be safe (the store dedupes and the call is
  idempotent), but a side effect in a render body is a pattern that stops being
  safe the moment someone adds a second one.
- **Fix:** move into `onMount`.
- **Risk:** low.

### A4 — `BlockRenderer.tsx` is 1,332 lines; `TemplateBlock` added 111 today

- **Location:** `packages/cms/src/components/blocks/BlockRenderer.tsx`
- **Problem:** the file holds the wrapper, the style emitter wiring, and every
  block-type renderer. `TemplateBlock` (fetch, cycle guard, script mount,
  teardown) is a self-contained unit that does not need to live there.
- **Fix:** **applied.** All 16 renderers moved to `components/blocks/types/*`;
  `BlockRenderer.tsx` keeps the shared wrapper and the dispatch.
  **1,332 → 341 lines**, plus 15 focused files (18–209 lines each) and a small
  `types/shared.ts` for `color()` / `TplCtx`.
- **Risk:** high (blast radius, not complexity) — mitigated by a before/after
  computed-style diff and a targeted recursive-render check, both below.

---

## 5. Recommended execution plan

- **Phase A (low risk, applied automatically):** U1, U2, A3
- **Phase B (medium risk, applied — user pre-approved "all recommended phases"):**
  A1, A2 (+U3, which A2 subsumes)
- **Phase C (applied — user asked for it explicitly):** A4 — split `BlockRenderer.tsx` per block type

---

## 6. Verification

### Phase A — applied
- **U1** `display: contents` on `.template-block__root`. Re-checked in the
  browser: component renders, script still mounts, wrapper no longer a box.
- **U2** `:focus-visible` on the three controls. The media remove button also
  gets `opacity: 1` on focus — it was possible to focus a control you could not
  see.
- **U3** subsumed by A2.
- **A3** `loadShopSettings()` moved into `onMount`.

### Phase B — applied
- **A1** `CodeEditor` extracted **verbatim** from `CssEditor` (diffed to confirm
  only the language line differs), with `CssEditor`/`JsEditor` reduced to
  one-line wrappers. 161 duplicated lines → 103 shared + 30 wrapper.
  My first attempt was written from memory and drifted in three ways
  (`lineWrapping` dropped, blur moved to `updateListener`, a flush added on
  cleanup); it was rewritten as a mechanical extraction instead.
- **A2** `ShopStoreGuard.requireStoreEnabled` now accepts
  `boolean | (() => boolean)`. `ShopIndex` dropped its duplicate readiness
  resource, loading fallback and `NotFound` import — ~30 lines to 12.

### Build / tests
- `npm run build` — all 8 packages pass.
- `vitest` (cms) — 56 passing.
- Storefront gating matrix re-run in a browser, all four combinations matching
  pre-refactor behaviour:

  | store | mode | `/shop` | `/shop/cart` | `/shop/checkout` |
  |---|---|---|---|---|
  | on | builtin | grid | cart | checkout |
  | **off** | **builtin** | **404** | **404** | **404** |
  | off | **page** | CMS page | 404 | 404 |
  | on | page | CMS page | cart | checkout |

**Harness note:** the matrix appeared to fail twice for reasons that were not
the code — once because the test script's auth cookie had expired and the
settings PUT was silently 401ing, and once because I used bash word-splitting
(`set -- $combo`) in zsh, which does not split unquoted parameters. The script
now re-auths per call and asserts the setting actually applied before testing.

### Phase C — applied
- **A4** `BlockRenderer.tsx` split per block type.
  - **The one real hazard was the import cycle.** Five renderers (group,
    group_item, template, entity, carousel) render arbitrary child blocks, so
    they import the dispatcher back. That is safe *because* the binding is read
    when a component renders, never during module evaluation — but a TDZ error
    there would be invisible to `tsc`, so it was verified at runtime rather than
    assumed.
  - Two artifacts of the mechanical split, caught by typecheck: the
    `PublicImageItem` interface landed in `RichTextBlock` (it sat between the two
    declarations in the original) and `EntityBlock` lost two imports. Both fixed.
  - **Verification — computed-style diff, 8 blocks × 2 viewports: 0 differences**
    (geometry, margin, padding, background, display, and the length of each
    block's emitted `<style>`).
  - **Verification — recursive render**, the part the diff could not reach:

    | path | result |
    |---|---|
    | group → group_item → child block | renders |
    | template → component blocks | renders |
    | template → component script `mount()` | mounts |
    | carousel | renders |
    | page errors | none |

### Docs
No user-facing surface changed (no API, CLI, config-key or visible-copy change),
so per step 9 no documentation update was required. `CLAUDE.md` already
documents the components/gating behaviour from today's feature commits.
