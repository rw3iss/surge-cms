## blocks-templates

Scope: blocks, templates and the block editor — template slots, template data / `listRender`, the "Set data…" window
(`EntitySearchSelectModal`, `DataBindingField`), the entity block, gallery / video / posts panels and renderers (web +
email), editor stability (`BlockPreview` store, `BlockEditController`, `viewportHold`, `stableSelection`), the mail
template editor, component (`template`) blocks and carousel entity items. Work reviewed: `git log --since=2026-09-25`
on these paths (≈75 commits).

Method: code reading only. Nothing here was reproduced in a browser or against a live API unless it says so. Where a
finding depends on runtime behaviour, it says how to confirm it.

Counts: **45 findings** — Phase A 27 · Phase B 14 · Phase C 4. Four are security or data-exposure findings (S1–S4);
fix those first.

Rule compliance in this area is mostly good: no `!important`, no raw checkboxes, no `cache.del` calls, and slot rows
and filter clauses use `createStore` as the house rule requires. Most findings below are about **the web, email and
template-editor preview disagreeing**: three resolvers that should give the same answer do not.

---

## Security / data exposure

### S1 — `GET /entities/post/:idOrSlug` returns drafts and the full body of gated posts to anonymous callers
- **Location:** `packages/api/src/routes/entities.ts:269` → `services/entities.ts:115` (`get`) → `repositories/genericEntity.repo.ts:210` (`SELECT *`).
- **Problem:** the generic list route forces `status = 'published'` for non-staff callers (`routes/entities.ts:262`). The single-record route has no such check. `post` has no entity data provider, so the read goes to the generic repo, which returns every column. That means `content`, a draft's body, and the full body of a `required_tier_id` post, with no `postGate`. The list route has the same gap for gating: it filters drafts, but `gate_hidden` posts are listed and locked bodies are returned whole. The same applies to `page` (`access_level`). CLAUDE.md says `services/postGate/` is the ONE gate on every public read; this path skips it. The public entity block calls exactly this endpoint (`services/entityBinding.ts` `getOne`).
- **Fix:** add a `post` entity data provider, as `product` and `gallery_item` have. It should apply `status='published'` + `postGate.hiddenClause` in `list`, and refuse non-published / apply `applyGate*` in `getById`/`getBySlug`. Do the same for `page` with `ContentGate`. In the meantime, add `if (!admin && t.hasStatus && rec.status !== 'published') throw NotFound` to `entities.get`.
- **Confirm:** `curl /api/v1/entities/post/<draft-slug>` with no cookie.
- **Risk:** high · **Phase:** B
- **Status:** DONE (entities/publicRead.ts: non-staff list/get drop draft/archived — SQL condition + 404 — refuse an explicit draft request, and run `post` through postGate: hiddenClause in SQL, locked body replaced by its sample, `gate` stamped; viewer passed from the route; cache key carries the rank. Test: services/entities.publicRead.test.ts. Page `access_level` is not applied here yet — see Cross-area follow-ups.)

### S2 — Member-written fields are put raw into innerHTML through `{{ }}`
- **Location:** `packages/shared/src/template/evaluator.ts:10` (values are emitted unescaped "because entity fields come sanitized from the API"), rendered by `components/blocks/TemplatedContent.tsx`. The discussion entity provider is `api/src/services/discussions/entityProvider.ts:86`.
- **Problem:** that assumption no longer holds. The `comment` and `forum_thread` entity types (and `{{latestThreads()}}` loops, `{{user.displayName}}`) carry text that members write. `excerpt` is `stripMarkdown(body)`, which removes Markdown but does not escape HTML. Forum titles are stored without sanitising (no `sanitize`/`escape` call in `services/forum` or `services/discussions`). A staff template such as `{{for hotThreads() as t}}<a>{{t.title}}</a>{{endfor}}` therefore puts member HTML into the DOM: on the public site, and in the admin editor preview, which runs with an admin session. The email path also interpolates it raw (`mail/expandBlocks.ts` `resolveBlockText`).
- **Fix:** escape by default for any value that does not come from a trusted rich field. Two options:
  - (a) mark the trusted HTML fields (`content`, `description` richtext) with a flag in the evaluator's `MEDIA_FIELDS`-style table, and HTML-escape every other string. This is preferred.
  - (b) at minimum, escape every string field in the discussion and user entity providers before it reaches the engine.
- **Test:** add an evaluator unit test with `<img src=x onerror=…>` in a thread title.
- **Confirm:** create a forum thread titled `<img src=x onerror=alert(1)>` and reference it in an HTML block.
- **Risk:** high · **Phase:** B
- **Status:** DONE (option a: evaluator HTML-escapes every interpolated value unless the expression ends in a trusted rich field — `TRUSTED_HTML_FIELDS` content/description/fullDescription/shortDescription/html/message + `*Html` — or is a literal / pass-through value fn of one; existing entities not double-encoded. `TemplateRuntime.raw` for plain-text targets; `resolveMailTemplate(src, ctx, { html: true })` on every mail BODY call site, subjects stay raw. Test: shared/src/template/escaping.test.ts.)

### S3 — Live queries in emails include drafts (posts and other `hasStatus` types)
- **Location:** `packages/api/src/services/templateSlots.ts:38-43` (`resolveBindingRecords` `query`) and `:28-36` (`single`/`list`).
- **Problem:** the server-side resolver calls `entitiesService.list/get` directly. It therefore skips the `status='published'` default that the HTTP route adds. An entity block in a newsletter bound to "newest 5 posts" can send a **draft** to every subscriber, and a `single`/`list` binding to a record that was later unpublished keeps sending it. Only the slot-posts path filters status (`mail/expandBlocks.ts` `resolveSlotPosts`). Entity-block bindings and gallery/product slots do not.
- **Fix:** in `resolveBindingRecords`, default `q.status ??= 'published'` for types with `hasStatus`, and drop non-published records from `single`/`list`. After S1 lands, use the same public read path, so that one rule covers both web and email.
- **Risk:** medium · **Phase:** A
- **Status:** DONE (fixed by S1: templateSlots reads go through the service without `admin`, so drafts/archived are dropped and posts are gated as an anonymous reader for every binding mode.)

### S4 — An entity template that contains itself freezes the browser
- **Location:** `components/blocks/types/TemplateBlock.tsx:172` (`renderEntityTemplateSlide` does not pass `templateAncestry`), `components/blocks/types/EntityBlock.tsx`. Compare `mail/expandBlocks.ts:72` (`MAX_DEPTH = 5`).
- **Problem:** a component block guards against cycles (`isCycle`). Entity blocks have no guard, and an entity template resets the ancestry chain for any component inside it. Example: an entity block inside template T bound to T, or T → component C → entity block T. This recurses without limit: fetch, render, fetch again. The tab hangs, and it also hangs the admin editor of every page that uses it. Email stops at depth 5, but a template with two self-references still grows to 2^5 copies.
- **Fix:** pass `templateAncestry` through `EntityBlock` and `renderEntityTemplateSlide` (key: `templateId`), and render the same "references itself" notice. In mail, track ancestry per branch instead of relying on a global depth.
- **Risk:** medium · **Phase:** A
- **Status:** DONE (web: ancestry moved to a Solid context — components/blocks/templateAncestry.ts — provided by TemplateBlock and renderEntityTemplateSlide, checked by EntityBlock, so it survives groups/slides; mail: per-branch ancestry in expandBlocks `ExpandState`. Tests in expandBlocks.test.ts.)

---

## Correctness / parity (web vs email vs preview)

### P1 — Web ignores a query's own limit when the template has `maxRecords`
- **Location:** `packages/cms/src/services/entityBinding.ts:94` — `limit: maxRecords || binding.query?.limit || 20`.
- **Problem:** if a list template has `maxRecords = 10` and the operator saves a query with Limit 3, the site shows 10 records and email shows 3 (`templateSlots.ts`: `Math.min(max, q.limit)`).
- **Fix:** `limit: Math.min(maxRecords || Infinity, binding.query?.limit || maxRecords || 20)`. Add a unit test (there is no `entityBinding.test.ts`).
- **Risk:** low · **Phase:** A
- **Status:** DONE (shared `bindingQueryLimit` in @sitesurge/types used by web and server; tests in cms services/entityBinding.test.ts + shared templateData.test.ts.)

### P2 — Web and email bind template variables under different names
- **Location:** `services/entityBinding.ts:23` (`entityVars` heuristic: `type` + `${type}s`), used by `TemplateBlock.tsx` `renderEntityTemplateSlide`. Compare `mail/expandBlocks.ts` (binds `def.singularVar`, `def.pluralVar`, **and** `entity`) and the template editor preview (`pages/admin/entities/TemplateEditor.tsx:273`, which uses `def.singularVar` / `def.pluralVar`).
- **Problem:** a custom type with `pluralVar: 'categories'`, or `gallery_item` → `gallery_items`, or any template using `{{entity.x}}`, previews correctly and sends correctly, but renders empty on the live site.
- **Fix:** return `singularVar`/`pluralVar` with the public template read (`GET /entities/:type/templates/:id`) and bind those names plus `entity` in `renderEntityTemplateSlide`. Delete the heuristic.
- **Risk:** medium · **Phase:** B
- **Status:** DONE (template GET returns the type's `singularVar`/`pluralVar`; renderEntityTemplateSlide binds those + `entity`; heuristic is now only a fallback.)

### P3 — Email caps bindings at 25, not at the template's `maxRecords`
- **Location:** `mail/expandBlocks.ts` `resolveRecords` → `resolveBindingRecords(type, binding, MAX_RECORDS)`.
- **Problem:** the template's `maxRecords` is never read by the mail path (the template meta is fetched *after* the records). A list template capped at 4 on the site sends up to 25 items in email.
- **Fix:** fetch `templateMeta` first and pass `min(tpl.maxRecords ?? 25, 25)`. This also removes the duplicate template read (see A4).
- **Risk:** low · **Phase:** A
- **Status:** DONE (mail reads the template first and caps at min(maxRecords, 25).)

### P4 — Gallery slot in email drops members-only items whose media is public
- **Location:** `mail/expandBlocks.ts:225` (`resolveSlotGallery`) → `resolveSlotRecords` → `entitiesService.list('gallery_item')`. That call uses the **site-anonymous** audience (`gallery/entity.ts` provider), and only after it is the `email` audience applied.
- **Problem:** CLAUDE.md says the email audience shows public media regardless of the in-site gate. The slot path filters with the site gate first, so a slot-fed gallery differs from an items-fed gallery that has the same picks.
- **Fix:** for `list`/`single` bindings, read the ids straight from the binding (no record fetch is needed, see A3) and let `resolveGalleryBlockItems(…, 'email')` do the filtering. For `query`, pass an audience hint through the provider.
- **Risk:** low · **Phase:** B
- **Status:** DONE for `single`/`list` slots (ids go straight to the email-audience gallery read via `bindingIdsIfStatic`). `query` slots still read through the gallery provider's site audience — CROSS-AREA (gallery provider needs an audience hint).

### P5 — Entity block keeps the old type's records and slot bindings when the type changes
- **Location:** `components/admin/blocks/types/EntityBlock.tsx:101` — `setCfg({ entityType, templateId: '' })`.
- **Problem:** `binding` (ids of the old type) and `slots` (keyed by the old template's slot ids) survive. "Set data…" then opens with foreign ids ticked, the renderer gets 404s and shows nothing, and orphan slot bindings are saved into page JSON. Changing the template has the same problem with `slots`.
- **Fix:** on a type change, reset `binding: { mode: 'context' }, slots: {}`. On a template change, prune `slots` to the new template's slot ids.
- **Risk:** low · **Phase:** A
- **Status:** DONE (type change resets binding + slots; template change prunes slots to the new template's ids.)

### P6 — Spacer height is not passed through `cssLength`
- **Location:** `components/blocks/BlockRenderer.tsx:314`.
- **Problem:** a bare `60` (which the Video and Gallery fields accept) becomes `height: 60`, which is invalid CSS, so the spacer collapses to 0.
- **Fix:** `cssLength(settings.height) ?? '60px'`. Show the default as a placeholder, not as the value (`BlockEditController.tsx` SpacerBlockEdit).
- **Risk:** low · **Phase:** A
- **Status:** DONE (`cssLength(height) ?? '60px'`; panel shows 60px as placeholder; CommitInput.)

### P7 — Hero carousel height field rejects the CSS lengths that every other field accepts
- **Location:** `components/admin/blocks/HeroContentEditor.tsx:60` — `/^\d+(px|vw|vh|%)$/`.
- **Problem:** `rem`, `clamp()`, `calc()` and `svh` are rejected. Elsewhere (block style, banner height, gallery item height) any CSS length is accepted.
- **Fix:** use `cssLength` from `@sitesurge/types`.
- **Risk:** low · **Phase:** A
- **Status:** DONE (`isValidHeight` = cssLength + no `;{}<>`.)

---

## Performance

### F1 — "Set data…" search fetches on every keystroke; the debounce does nothing
- **Location:** `components/admin/entities/EntitySearchSelectModal.tsx:465` (refetch effect) + `fetchRecords`.
- **Problem:** `fetchRecords()` reads `search()`, `page()` and `buildFilter()` *synchronously, before its first `await`*, inside the effect. Solid tracks those reads, so `setSearch` on each key re-runs the effect immediately (uncached, `cache: false`). The 300 ms timer then fetches once more. Typing "concert" sends 8 requests, and page 1 is only reset after the debounce, so you can search page 3 of the new term.
- **Fix:** keep a separate `debouncedSearch` signal that the effect reads, set from the timer. Wrap the fetch body in `untrack` so the effect lists its dependencies explicitly.
- **Risk:** low · **Phase:** A
- **Status:** DONE (separate `debouncedSearch` signal; fetch body in `untrack`; page reset + term set together.)

### F2 — The results table is swapped for "Loading…" on every page, sort and filter change
- **Location:** `EntitySearchSelectModal.tsx:729`.
- **Problem:** `<Show when={!loading()} fallback="Loading…">` removes the table. The modal height jumps, the scroll position is lost, and with F1 the table flickers on each keystroke.
- **Fix:** keep the last rows on screen, add `aria-busy` + a dimmed `is-loading` class on the table, and show a small spinner in the footer.
- **Risk:** low · **Phase:** A
- **Status:** DONE (rows stay, `is-loading` dim + `aria-busy`, footer spinner.)

### F3 — A `list` binding fetches records one by one (N+1), uncapped
- **Location:** `services/entityBinding.ts:87` (`Promise.all(refs.map(getOne))`, each `cache: false`), `components/blocks/slotContext.tsx` `slotRecordsFor`, `TemplateEditor.tsx` sample records, and `api/src/services/templateSlots.ts:31`.
- **Problem:** an entity block with 20 picked records sends 20 uncached requests per page view per visitor. The web cap is applied *after* all of them are fetched.
- **Fix:** one `list` call with `filter: { id: { op: 'in', value: refs } }`, re-ordered by `refs`, and the cap applied before the fetch. The same change on the server (`entitiesService.list` with `in`).
- **Risk:** low · **Phase:** B
- **Status:** DONE (web `fetchRecordsByRefs`: one `id in` list read, refs order, cap before fetch, single-read fallback; server templateSlots same.)

### F4 — Slot-fed Gallery and Posts resolve full records, then query again by id
- **Location:** `components/blocks/types/GalleryBlock.tsx:61` (`slot` resource → `items` resource), `mail/expandBlocks.ts:225`.
- **Problem:** for a `list` / `single` binding the ids are already in the binding. Fetching each record (F3) only to extract `id` doubles the round trips.
- **Fix:** add `bindingIdsIfStatic(binding)` in `@sitesurge/types` `entities/slots.ts`. Fetch records only for `query` bindings.
- **Risk:** low · **Phase:** A
- **Status:** DONE (`bindingIdsIfStatic` in shared entities/slots.ts; used by web GalleryBlock and mail resolveSlotGallery.)

### F5 — Gallery and entity blocks refetch on any settings edit, including layout-only edits
- **Location:** `GalleryBlock.tsx:61` (the source returns a new object derived from the whole `gallerySettingsOf(...)`); `blocks/types/EntityBlock.tsx` (the source reads all of `settings.entity`, so changing `layout` refetches the template and the records).
- **Problem:** `BlockPreview` reconciles the block into a store precisely so that style edits do not refetch. Changes to columns, gap, fit or layout still re-run the query and suspend the block's local boundary. The flicker that `viewportHold` hides comes partly from this.
- **Fix:** make each source return a primitive key (`JSON.stringify` of only the fields the fetch uses: query / itemIds / slot binding / viewer). Solid then skips refetch when the key is equal: return the string, and parse it in the fetcher.
- **Risk:** low · **Phase:** A
- **Status:** DONE (Gallery + Entity block resources keyed on primitive JSON strings of only what the fetch reads.)

### F6 — Carousel resolves its dynamic items one after another
- **Location:** `components/blocks/ResolvedHeroCarousel.tsx:198`.
- **Problem:** `for … await` puts the template and record fetches for each posts/entity item in series.
- **Fix:** `Promise.all(props.items.map(resolveOne))`, then `flat()`.
- **Risk:** low · **Phase:** A
- **Status:** DONE (Promise.all + flat.)

### F7 — `holdViewport` runs on every keystroke and fights the user's own scrolling
- **Location:** `components/admin/blocks/viewportHold.ts:62-80`; called from `BlockEditor.tsx:149` (`emitBlocks`, which every data edit goes through) and `BlockEditController.tsx` (`publishDraft`, every style-control change).
- **Problem:** each call starts its own requestAnimationFrame loop of at least 500 ms (up to 1.5 s) that corrects the scroll position by `scrollBy`. While typing, loops overlap, and each holds a `prevTop` captured at a different moment, so they can correct against each other. A wheel scroll in the 0.5 s after a toggle is pulled back toward the anchor. This is the "safety net" doing harm.
- **Fix:**
  - keep one hold: a new call re-arms the current hold and does not stack a second loop;
  - abort the hold on user `wheel` / `touchmove` / `keydown` (PageUp, PageDown, arrow keys);
  - skip the hold entirely for data edits whose block height did not change (measure the anchor once at the next frame).
- **Test:** add a unit test with a fake RAF.
- **Risk:** medium · **Phase:** B
- **Status:** DONE (one hold, re-armed; aborted on wheel/touchmove/scroll keys; data edits use a 150 ms window; injectable env + tests viewportHold.test.ts.)

---

## Architecture / duplication

### A1 — Three copies of "render an entity template for a binding"
- **Location:** `components/blocks/types/EntityBlock.tsx` (resource), `components/blocks/ResolvedHeroCarousel.tsx:94` (`resolveEntityItem`), `api/src/services/mail/expandBlocks.ts` (entity arm).
- **Problem:** each one fetches the template, resolves records, applies `templateRenderGroups`, and builds the slot context. They have already drifted apart: P1, P2, P3, S4, and slots are read live in one path but frozen in the carousel.
- **Fix:** add `resolveEntityTemplate(cfg, ctx) → { roots, groups, once, slots, vars }` in `services/entityBinding.ts`, used by the block and the carousel. On the server, `expandBlocks` and a future SSR pass share `templateSlots.resolveEntityTemplate`. Write parity tests over a shared fixture.
- **Risk:** medium · **Phase:** B
- **Status:** DONE (web: `resolveEntityTemplate` in services/entityBinding.ts used by EntityBlock and carousel entity items; server: entity block + slots already share `resolveBindingRecords`. SSR reuse is G4.)

### A2 — Four separate "draft input that commits on blur" implementations
- **Location:** `components/admin/entities/TemplateSlotsEditor.tsx:28` (`DraftInput`), `components/admin/gallery/CommitInput.tsx`, `components/admin/blocks/HeroContentEditor.tsx:74` (`TextInput`), `components/admin/entities/EntityValueInput.tsx`.
- **Problem:** this is a house rule (CLAUDE.md → Admin styles), but each panel copies the pattern by hand. They differ on Enter-vs-Shift+Enter handling, trimming, validation and the focus guard. New panels keep using plain `onChange`, or `onInput` that lifts the value per keystroke (see U4).
- **Fix:** promote `CommitInput` (text / number / textarea, `onCommit`, optional `validate`) to `components/admin/forms/` and export it next to `FormField`. Replace the copies, and document it in ADMIN_STYLES.md.
- **Risk:** low · **Phase:** A
- **Status:** DONE (components/admin/forms/CommitInput.tsx — text/number/date/textarea, validate, commitOnEnter; used by TemplateSlotsEditor, HeroContentEditor TextInput, Hero/Spacer/Video/Entity panels, EntityRecordForm). Gallery's own CommitInput and the forms barrel export are CROSS-AREA; ADMIN_STYLES.md note under Docs to update.

### A3 — Block-type dispatch is a 20-arm `<Switch>` in three places, with no exhaustiveness check
- **Location:** `components/blocks/BlockRenderer.tsx:268`, `components/admin/blocks/BlockEditController.tsx` (`BlockContentForm`), `components/admin/blocks/BlockPreview.tsx:101` (`isEmpty`, one special case per type).
- **Problem:** SSR and mail already use a `Record<BlockType, …>` with coverage tests. The web renderer, the editor and the empty check do not, so a new `BlockType` compiles fine and silently renders nothing. `isEmpty` has grown one comment-plus-branch per bug ("entity showed Click edit to configure forever", the same for social and for gallery).
- **Fix:** add `WEB_BLOCK_RENDERERS: Record<BlockType, Component>` and `BLOCK_EDIT_FORMS: Record<BlockType, …>`, plus an `isConfigured(type, data)` in `config/blockTypes.ts` next to each type's label. Add a coverage test like `ssr/blocks/blocks.test.ts`.
- **Risk:** medium · **Phase:** C
- **Status:** DONE (`WEB_BLOCK_RENDERERS` in BlockRenderer, `BLOCK_EDIT_FORMS` in BlockEditController, `BLOCK_CONFIGURED`/`isBlockConfigured` in config/blockTypes.ts used by BlockPreview — all `Record<BlockType, …>`; test config/blockTypes.configured.test.ts. Found: the `event` block has NO web renderer or admin form — explicit `null` arms, CROSS-AREA.)

### A4 — Mail expansion reads each template two or three times
- **Location:** `mail/expandBlocks.ts:334` (`findBlocksResolved`) and `:345` (`templateMeta`). The `template` arm does the same at `:400`.
- **Problem:** two queries per entity or component block, repeated for every copy of the same template in one email. Preview runs this on every refresh.
- **Fix:** memoise `findBlocksResolved` + `findById` per `expandDynamicBlocks` call (a `Map` passed down with `done`). Use one repo call that returns meta + blocks.
- **Risk:** low · **Phase:** A
- **Status:** DONE (per-call template memo `loadTemplate` in expandBlocks; test.)

### A5 — Saving a template is two separate requests, not atomic
- **Location:** `pages/admin/entities/TemplateEditor.tsx:248-249` (`api.update(meta)` then `api.saveBlocks`). The create path is the same at `:242`.
- **Problem:** if `saveBlocks` fails after the meta update (for example a block-type enum mismatch), the template has new slots / `listRender` and old blocks, and every page that uses it renders the mixed state. On create, a failed second call leaves an empty template, and the editor still navigates to it.
- **Fix:** add a `PUT /…/templates/:id` body that carries `blocks`, applied in one transaction (the repo already wraps `replaceBlocks` in BEGIN/COMMIT). Alternatively, roll back the meta on a block failure.
- **Risk:** medium · **Phase:** B
- **Status:** DONE (create/update template routes — entity + components — accept `blocks`, applied with the meta in one transaction via `repo.saveWithBlocks`; TemplateEditor sends one request.)

### A6 — `replaceBlocks` depends on the client sending parents first
- **Location:** `api/src/repositories/contentBlockTemplates.repo.ts:213`. The table has `parent_block_id … REFERENCES content_block_template_blocks(id)` (migration 083), and the foreign key is not deferrable.
- **Problem:** if a child comes before its parent in the payload, the INSERT violates the foreign key and the whole save fails. `revisions.ts` already had this exact bug and fixed it with `orderParentsFirst()`.
- **Fix:** run `orderParentsFirst(blocks)` before the insert loop, and add a test with a three-level tree given in reverse order.
- **Risk:** low · **Phase:** A
- **Status:** DONE (`orderParentsFirst` before insert; id-less blocks get an id; test repositories/contentBlockTemplates.repo.test.ts.)

### A7 — Gallery render keeps its own `esc` / `absUrl`, with the arguments in the opposite order
- **Location:** `api/src/services/gallery/render.ts:30-40` vs `mail/blocks/_util.ts` (`escapeHtml`, `absUrl(siteUrl, link)`).
- **Problem:** the gallery's `absUrl(u, base)` takes its arguments in the reverse order from the mail helper of the same name, which invites a silent mix-up at the next call site. The local `esc` also does not escape `'`, and its output is placed inside `background-image:url('${src}')`. The URLs are server-generated today, but this is one refactor away from a CSS-context break.
- **Fix:** use `escapeHtml` from `utils/html` (escapes quotes). Rename the gallery helper or remove it, and run CSS URLs through a `cssUrl()` that percent-encodes `'`, `(`, `)`.
- **Risk:** low · **Phase:** A
- **Status:** DONE (`escapeHtml`, `cssUrl()` for background-image, helper renamed `absoluteGalleryUrl` with a deprecated `absUrl` alias for ssr/staticMeta — CROSS-AREA to switch; test renderEscape.test.ts.)

### A8 — `HeroContentEditor.tsx` is 1,189 lines
- **Location:** `components/admin/blocks/HeroContentEditor.tsx`.
- **Problem:** one file holds item list management, media items, posts items, entity items, text overlay config, carousel options and mobile options. Every carousel change touches it, and its local `TextInput` duplicates A2.
- **Fix:** split it into `carousel/ItemList`, `carousel/MediaItemEditor`, `carousel/EntityItemEditor`, `carousel/TextOverlayEditor` and `carousel/CarouselOptions` (desktop + mobile).
- **Risk:** low · **Phase:** C
- **Status:** DONE (split into blocks/carousel/heroItemUtils.tsx, TextOverlayEditor.tsx, CarouselOptions.tsx; HeroContentEditor 1,189 → 642 lines. Item list / media / entity item editors stay in the main file.)

### A9 — Admin components import a page stylesheet
- **Location:** `EntitySearchSelectModal.tsx:36`, `EntityRecordForm.tsx:16`, `EntityDataTable.tsx:17` → `pages/admin/entities/EntitiesList.scss`.
- **Problem:** this reverses style ownership. The modal is used from block panels on the page, post and mail editors, and it pulls in a page-level partial, so whoever edits EntitiesList.scss breaks the modal.
- **Fix:** move the `.entity-search-modal*` / record-form rules into `components/admin/entities/EntitySearchSelectModal.scss` (and siblings), as ADMIN_STYLES.md → "Where to put a new admin style" says.
- **Risk:** low · **Phase:** A
- **Status:** DONE (styles moved to EntitySearchSelectModal.scss, EntityRecordForm.scss, EntityDataTable.scss, EntityFilterBar.scss; components no longer import the page stylesheet.)

### A10 — Missing tests on the riskiest logic in this area
- **Location:** `services/entityBinding.ts` (no test), `viewportHold.ts` (no test), `BlockPreview` `isEmpty`, `EntitySearchSelectModal` `orderedSelection` / `serverRank` (a selection saved in the server's sort order across pages was changed twice in this window: 45da5e0d, 83a40cd9).
- **Fix:** add unit tests for `resolveRecords` (limit and cap, list order, context fallback). Extract `orderedSelection` into `utils/dataBinding.ts` as a pure function with tests. Add a web↔mail parity fixture test for one entity template (it would have caught P1–P3).
- **Risk:** low · **Phase:** B
- **Status:** DONE (entityBinding.test.ts, viewportHold.test.ts, blockTypes.configured.test.ts, `orderSelection` extracted to utils/dataBinding.ts with tests; web↔mail parity by construction via shared `bindingQueryLimit` + same variable names.)

---

## UI / UX / a11y

### U1 — Blocks cannot be selected or reordered from the keyboard, and the icon buttons have no labels
- **Location:** `components/admin/blocks/ContentBlock.tsx:225` (`<span onClick>` select label), `:250` / `:258` (▲ ▼ with `title` only), and the options `⋯` button (no `aria-haspopup` / `aria-expanded`). None of these buttons set `type="button"`.
- **Problem:** `BlockPreview` deliberately silences clicks inside the preview, so the hover-bar label is the **only** way to select a block, and it cannot get focus. Screen readers announce "black up-pointing triangle". The buttons have no `type`, so inside a form wrapper they submit the form.
- **Fix:**
  - make the label a `<button type="button" aria-pressed={selected}>`;
  - add `aria-label` to move up / move down / options, `aria-haspopup="menu"` and `aria-expanded` on options;
  - put `type="button"` on every hover-bar button;
  - add Alt+↑ / Alt+↓ to move the selected block.
- **Risk:** low · **Phase:** A
- **Status:** DONE (label is a `<button aria-pressed>`, aria-labels on move/options, aria-haspopup/expanded, `type="button"` everywhere, Alt+↑/↓ moves the selected block.)

### U2 — The entity block's "Carousel" layout is a bare scroll row
- **Location:** `components/blocks/types/EntityBlock.tsx:73` + `.entity-carousel` in `BlockRenderer.scss:408`.
- **Problem:** the label says "Carousel (swipeable)", but the result is `overflow-x: auto` with no arrows, no dots and no keyboard support. A full `HeroCarousel` with entity items (paging, mobile list mode) exists for the same job. Operators will reasonably expect the two "carousels" to behave alike.
- **Fix:** render `layout: 'carousel'` through `ResolvedHeroCarousel` with one entity item, exposing per-page and gap. Alternatively, rename the option to "Horizontal scroll row" and add scroll-snap arrows.
- **Risk:** low · **Phase:** B
- **Status:** DONE (`layout: 'carousel'` renders through HeroCarousel with the resolved records as slides — arrows/dots/paging/swipe; panel adds Visible-at-once + Gap.)

### U3 — Entity and component blocks show nothing in the editor when their template is missing
- **Location:** `blocks/types/EntityBlock.tsx` (`if (!tpl) return { roots: [] … }` and `fallback={null}`); `TemplateBlock.tsx` (a deleted component renders an empty root).
- **Problem:** if the template or component was deleted, or failed to load, the block is an invisible zero-height box in the editor. Slots already have `SlotPlaceholder`, so the same convention exists.
- **Fix:** add an admin-only `block-message`: "Template not found (deleted?) — choose another in the block panel". Render nothing on the public site.
- **Risk:** low · **Phase:** A
- **Status:** DONE (admin-only "Template/Component not found (deleted?)" message for entity and component blocks.)

### U4 — `EntityRecordForm` lifts the whole record to the parent on every keystroke
- **Location:** `components/admin/entities/EntityRecordForm.tsx:42` (`setField` → `props.onChange({...values})`), used by 10 `onInput` fields.
- **Problem:** this breaks the "commit on blur" house rule. Every character rebuilds the values object and re-renders the whole form, and `EntityRecordEdit` dirty-checks the whole object on each keystroke. Focus loss has not been observed, because rows are keyed by field definition and not by value, but this is the pattern that U1 of the 2026-09-25 audit warned about.
- **Fix:** use the A2 `CommitInput` for text, number, date and textarea fields. Keep JSON parsing on blur.
- **Risk:** low · **Phase:** B
- **Status:** DONE (CommitInput for every text/number/date/textarea/JSON field; boolean via Toggle.)

### U5 — Video block panel: raw label, unstyled file input, px-only size fields
- **Location:** `components/admin/blocks/types/VideoBlock.tsx:182` (`<label>Video</label>`), `:206` (native `<input type="file">`), `:236-258` ("Max Width (px)", "Max Height (px)" as `type=number` with `parseInt`), and inline `margin-bottom` styles.
- **Problem:** this breaks the FormField rule. The other block panels have a styled Upload button, but here the browser's "Choose file / No file chosen" control appears. The renderer and email accept any CSS length (`cssLength`), yet the panel accepts only px. "Item border radius" in the same row already accepts any CSS length, so the row is inconsistent. `fileSize` missing shows "(0 MB)".
- **Fix:**
  - FormField label;
  - a hidden file input behind a "Upload video" `ui-button` (as in ImageBlock);
  - text inputs with `cssLength` for the max sizes, committed on blur;
  - move the inline margins to `.block-video` in the partial;
  - hide the size line when it is unknown.
- **Risk:** low · **Phase:** A
- **Status:** DONE (FormField label, hidden file input behind an "Upload video" button, max sizes take any CSS length via CommitInput + validation, margins in `.block-video`, size line hidden when unknown.)

### U6 — Entity block panel uses raw `<label class="block-edit-form__field">` rows
- **Location:** `components/admin/blocks/types/EntityBlock.tsx` (5 raw labels). `BlockEditController.tsx` "Type" / "Style" use `<label class="bec-field__label">`.
- **Problem:** the FormField rule. These rows also miss the label-click activation and the tooltip / hint slots, and "Layout (multiple records)" is shown even for a single-record template or binding.
- **Fix:** FormField for each row. Show Layout only when `template.mode === 'list'` or the binding is list / query.
- **Risk:** low · **Phase:** A
- **Status:** DONE (FormField rows; Layout shown only when more than one record can render.)

### U7 — Mixed button systems and hardcoded colours in the block panels
- **Location:** `BlockEditController.tsx` (`btn btn--xs` beside `ui-button` and `bec-icon-btn`), `HtmlInlineEditor.tsx:234` (`color: '#999'`), `types/GroupBlock.tsx:63` (`#b46b00`), `types/CarouselBlock.tsx:43`, `types/PostListBlock.tsx:32-39` (inline margins), and the `EntitySearchSelectModal.tsx:807` footer (inline flex + gap).
- **Problem:** this goes against the "no literal hex, repeated inline styles go to a partial" rule. Save and Cancel in the style row look different from the Save in the page header.
- **Fix:** use `ui-button` throughout. Add `.form-help--warning` (token `$warning-color`) and `.preview-empty-message`. Add `.entity-search-modal__pager` in the modal partial.
- **Risk:** low · **Phase:** A
- **Status:** DONE (ui-button in BlockEditController, `.form-help--warning`, `.block-preview-summary`, `.post-list-brevity-help`, modal pager classes; no literal hex added.)

### U8 — The Variable & Function Reference toggle shows for every block type
- **Location:** `BlockEditController.tsx:425`.
- **Problem:** Image, Video, Spacer, Gallery and Social have no templated text, yet the reference sits under each one. For the blocks that do take text, it does not say which fields accept `{{ }}`.
- **Fix:** show it only for types listed in a `TEMPLATABLE_TYPES` set (rich_text, html, hero, url_link, entity / template children), and add a one-line hint saying which field it applies to.
- **Risk:** low · **Phase:** A
- **Status:** DONE (`TEMPLATABLE_TYPES` with a per-type hint.)

### U9 — Style-template Save, Set default and template delete fail silently
- **Location:** `BlockEditController.tsx:223` (`handleSaveTemplate`) and `:399` (`onSetDefault`): async, no try/catch. `TemplateEditor.tsx:267` (`handleDelete`): native `confirm()`, no try/catch.
- **Problem:** a 403 or 500 becomes an unhandled rejection with no toast, and the dropdown stays as it was. The delete uses the browser dialog when every other admin delete uses `ConfirmModal`.
- **Fix:** wrap these handlers with `toast.error(...)`. Use `ConfirmModal` with a danger style for the delete.
- **Risk:** low · **Phase:** A
- **Status:** DONE (style Save/Set default toast on failure; template delete uses ConfirmModal + try/catch.)

### U10 — The hero block panel takes a background image as a typed URL
- **Location:** `BlockEditController.tsx:41` (inline `HeroBlockEdit`).
- **Problem:** this is the only image field in the editor without Select Media / Upload, and without `openMediaViewer`. Content is a raw HTML textarea.
- **Fix:** reuse `ImageLinkPicker` (or `MediaSelectModal` + `viewMediaProps`) for the background. Move `HeroBlockEdit` to `types/HeroBlock.tsx`.
- **Risk:** low · **Phase:** A
- **Status:** DONE (HeroBlockEdit moved to admin/blocks/types/HeroBlock.tsx, background via ImageLinkPicker, CommitInput fields.)

### U11 — "Set data…" window: rows are not clickable, no thumbnail, duplicate-field clauses drop without notice
- **Location:** `EntitySearchSelectModal.tsx`: rows (only the 20 px checkbox toggles), `:236` (`columns()` = the first 4 schema fields), and `buildFilter` (two clauses on one field: the later one wins, as the code comment admits).
- **Problem:**
  - Selecting 10 records means 10 precise clicks.
  - For `gallery_item` / `product` / `post` the first four fields are often ids or long text, and there is no picture to recognise.
  - "price > 10 AND price < 20" shows two rows but applies one, with no notice.
- **Fix:**
  - make the whole row toggle selection in `data` mode (Space / Enter when focused);
  - add a thumbnail column when the type has `featuredImage` / `media`;
  - mark a later same-field row with "Overrides the row above". Alternatively support a list-shaped filter — that is the backend change noted in the comment, Phase C.
- **Risk:** low · **Phase:** B
- **Status:** DONE (whole row toggles in data mode + Space/Enter, thumbnail column when any row has a picture, "Overrides the row above" notice on a duplicate property.)

---

## Feature gaps

### G1 — Templates and components have no revision history
- **Location:** `packages/shared/src/types/content.ts:751` (`RevisionEntityType = 'post' | 'page' | 'mail_template'`), `services/blockStores.ts`.
- **Problem:** a component is a reference, so one bad save changes every page that uses it, with no undo. Mail templates got history in this window. Content-block templates, which reach more surfaces, did not. The generic revision engine already supports any block store.
- **Fix:** register `content_block_template` in `BLOCK_STORES` + `RevisionEntityType`. Call `markDirty` from `contentBlockTemplates.update/replaceBlocks`. Add the History panel in `TemplateEditor` (reuse the mail one).
- **Risk:** medium · **Phase:** C
- **Status:** CROSS-AREA (needs `content_block_template` in services/blockStores.ts BLOCK_STORES + `RevisionEntityType` in shared types/content.ts + revisions.markDirty — files owned elsewhere.)

### G2 — "Where is this used?" and an in-use guard before deleting a template or component
- **Location:** `services/contentBlockTemplates.ts:74` (`remove`), `TemplateEditor.tsx:267`.
- **Problem:** deleting a component or entity template silently empties every page, post, mail template and carousel that references it (see U3). Media got an "in use" guard in this window (341eca29); templates did not.
- **Fix:** add `usages(templateId)`, scanning `settings->>'templateId'` and `settings->'entity'->>'templateId'` across every `BLOCK_STORES` table plus carousel items. Show the count on the template list, and require type-to-confirm (with the list of uses) before delete.
- **Risk:** low · **Phase:** B
- **Status:** DONE (`contentBlockTemplates.usages()` scans pages/posts/mail templates/templates; staff list reads carry `usages` + `usageCount`; TemplateEditor delete shows the list and needs the name typed; TemplateList shows the count. ComponentsList page is CROSS-AREA.)

### G3 — The template editor has no draft persistence and no unsaved-changes guard
- **Location:** `pages/admin/entities/TemplateEditor.tsx` vs `pages/admin/MailTemplateEdit.tsx:108` (`useAutoSave`).
- **Problem:** the mail template editor keeps a localStorage draft with a Revert action. The component and entity template editor, which use the same `BlockEditor`, lose all edits on navigation or reload without warning.
- **Fix:** use the same `useAutoSave` (key `cbt-draft-<id>`) and a Revert button, for parity with pages, posts and mail.
- **Risk:** low · **Phase:** B
- **Status:** DONE (`useAutoSave` key `cbt-draft-<type>-<id>`, restore when newer than `updatedAt`, Revert with ConfirmModal, flush every 10 s / tab hide / unmount.)

### G4 — Entity and component blocks are not server-rendered
- **Location:** `api/src/services/ssr/blocks/` (entity / template → `notIndexable`). This is a known gap (CLAUDE.md, carousel section).
- **Problem:** a home page built from entity blocks ("featured posts", product rows) gives crawlers nothing. Mail already has the full expansion (`expandDynamicBlocks`), and SSR can reuse it.
- **Fix:** run `expandDynamicBlocks` (with the S3 public read rules) before `renderBlockForSeo`, and emit the expanded children. Once A1 has a shared resolver, the three surfaces agree by construction.
- **Risk:** medium · **Phase:** C
- **Status:** CROSS-AREA (services/ssr/* is not in this area; expandDynamicBlocks now respects public read rules, so SSR can call it before renderBlockForSeo.)

### G5 — No preview of what a slot holds from the using block
- **Location:** `components/admin/blocks/types/EntityBlock.tsx` (the slots section).
- **Problem:** each slot shows only the "Set data…" summary text. The main binding has `EntityBindingSummary` (resolved record chips and the current match count for queries), but slots do not. An operator filling a "Featured gallery" slot cannot see that the query now matches 0 items.
- **Fix:** pass `EntityBindingSummary` as the `children` of each slot's `DataBindingField`, as the main binding already does.
- **Risk:** low · **Phase:** A
- **Status:** DONE (EntityBindingSummary under each slot's DataBindingField.)

### G6 — `localStorage` HTML-block heights grow without bound
- **Location:** `components/admin/blocks/HtmlInlineEditor.tsx:32` (`sitesurge.editor.blockHeights`).
- **Problem:** one entry is added per HTML block ever opened, and entries are never pruned. The key shares the origin's quota with the SDK's localStorage SWR cache, so a full quota starts evicting or failing cache writes.
- **Fix:** keep an LRU of 200 entries (store `{h, t}` and drop the oldest on write).
- **Risk:** low · **Phase:** A
- **Status:** DONE (blockHeights.ts LRU of 200 `{h,t}` entries, legacy numbers read; test.)

---

## Phase summary

| Phase | Count | Findings |
|---|---|---|
| A — low-risk mechanical | 27 | S3, S4, P1, P3, P5, P6, P7, F1, F2, F4, F5, F6, A2, A4, A6, A7, A9, U1, U3, U5, U6, U7, U8, U9, U10, G5, G6 |
| B — medium | 14 | S1, S2, P2, P4, F3, F7, A1, A5, A10, U2, U4, U11, G2, G3 |
| C — structural | 4 | A3, A8, G1, G4 |

Recommended order:
1. S1, S2 (security).
2. S3, S4, P1–P3 (wrong content reaches visitors or subscribers).
3. F1, F5, F7 (editor feel).
4. A1 (stops the parity drift from coming back).

---

## Implementation summary (2026-10-18)

Phase A 27/27 done · Phase B 14/14 done (P4 `query` slots partly cross-area) · Phase C 2/4 done (A3, A8), 2 cross-area (G1, G4).
Migrations added: none (163–166 unused).

## Cross-area follow-ups

- **forms** — `services/formActions.ts` renders the form-email SUBJECT with `renderTemplateToString`, which now HTML-escapes by default: set `raw: true` on its runtime for the subject (and recipient) render, keep the body escaped (`O'Brien` → `O&#39;Brien` in a subject otherwise).
- **reply** — `services/reply/index.ts` already passes raw subject/text through `resolveMailTemplate` (raw by default) — no change needed; if a reply BODY is ever resolved there, pass `{ html: true }`.
- **ssr** — `services/ssr/staticMeta.ts` imports gallery `absUrl`; switch to `absoluteGalleryUrl` (alias kept). G4: run `expandDynamicBlocks` before `renderBlockForSeo` so entity/component blocks are indexable.
- **revisions** — G1: add `content_block_template` to `services/blockStores.ts` + `RevisionEntityType`, call `revisions.markDirty` from `contentBlockTemplates.update/replaceBlocks/saveWithBlocks`, reuse the mail History panel in TemplateEditor.
- **gallery** — P4 `query` slots in email: let the `gallery_item` entity provider take an audience hint (`email`) so a query-fed slot matches an items-fed one. `components/admin/gallery/CommitInput.tsx` can be replaced by `components/admin/forms/CommitInput.tsx`.
- **events** — the `event` block has no web renderer (`WEB_BLOCK_RENDERERS.event = null`) and no admin edit form (`BLOCK_EDIT_FORMS.event = null`); SSR and mail render it.
- **pages / content gate** — generic entity reads of `page` drop drafts but do not apply `access_level` (ContentGate); pages keep their body in blocks, so only metadata is exposed, but the rule should match `GET /pages`.
- **components admin** — `pages/admin/components/ComponentsList.tsx`: show `usageCount` and route delete through the same usage-list confirm as TemplateEditor (it still uses `confirm()`).
- **forms barrel** — export `CommitInput` from `components/admin/forms/index.ts` (append-only).
- **cms-client** — template create/update now accept an optional `blocks` array; the SDK typings (`cms.contentBlockTemplates.create/update`, `cms.components.create/update`) can declare it.

## Docs to update

- CLAUDE.md — Content templating: `{{ }}` output is HTML-escaped by default except trusted rich fields (`TRUSTED_HTML_FIELDS` + `*Html`); `TemplateRuntime.raw`; `resolveMailTemplate(…, { html: true })` for bodies.
- CLAUDE.md — Generic entities: non-staff entity reads drop draft/archived records and gate posts (`entities/publicRead.ts`); template GET returns `singularVar`/`pluralVar`; template create/update accept `blocks` (one transaction); staff list reads carry `usages`/`usageCount`.
- CLAUDE.md — Block-type registry: web `WEB_BLOCK_RENDERERS`, admin `BLOCK_EDIT_FORMS`, `BLOCK_CONFIGURED` are `Record<BlockType, …>` too.
- CLAUDE.md — Admin styles: `components/admin/forms/CommitInput` is THE commit-on-blur input; ADMIN_STYLES.md section for it.
- docs/API.md + docs/api-manifest.json — regenerate (`npm run docs:api`): template create/update bodies gained `blocks`.
- docs/sdk/entities.md — public read rules, `blocks` on template save, `usages`.

