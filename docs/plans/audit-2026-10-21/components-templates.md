# Audit 2026-10-21 — Area B: Components / templates / template engine / help

Scope: commits since `3770169f` — component collections (70146775), slots as `{{ }}`
variables (38079fe8), component props (3e485aae), Component block slot filling
(0fb0c459), `{{ template() }}` / `{{ component() }}` (0a56e57b), `form(…, submitLabel=)`
(ab8dfdfd / a73c9ac2 / 724c1d43), blocks fill templates (b26306ec), help registry +
Components guide (1f255f51, 6335e5fc, f7c0d65c).

Risk: low / med / high. Status: **fixed** / **planned** / **ok** (checked, no change).

## Findings

### 1. Component Copy came out empty — fixed (med)
- `packages/cms/src/pages/admin/components/ComponentsList.tsx` `handleCopy`
- Problem: copied by `create()` then `saveBlocks()` with the SOURCE block ids.
  `content_block_template_blocks.id` is a table-wide primary key, so the second call
  collided (409) and left an empty "X copy". It also dropped `slots`, `listRender` and
  the script, so a copy that reads `{{ events }}` rendered nothing.
- Fix: one `create` carrying the whole tree (one transaction); block ids re-minted
  with the parent links remapped; slots / listRender / script / scriptEnabled copied.

### 2. `{{ props.description }}` (any trusted field name) was printed unescaped — fixed (med)
- `packages/shared/src/template/evaluator.ts` `isTrustedExpr`
- Problem: the trusted-HTML rule looks only at the LAST path part, so a prop named
  `description` / `content` / `*Html` skipped escaping. Props can carry member text:
  `{{ component('X', description=user.bio) }}`.
- Fix: a path whose head is `props` is never trusted. Test in `escaping.test.ts`.

### 3. `default(props.x, '…')` printed "props.x" — fixed (low)
- `packages/shared/src/template/evaluator.ts` (`call` arm)
- Problem: the unquoted-slug leniency turned ANY unresolved path argument into its
  literal text, including dotted paths. The Components help told authors to avoid
  `default()` for props because of it.
- Fix: only a bare identifier (`post(some-slug)`) falls back to its literal; a dotted
  path stays undefined. Help note updated (`services/help/sdkReference.ts`). Tests in
  `escaping.test.ts`.

### 4. Slot-variable detection duplicated on web and email — fixed (low)
- `components/blocks/slotContext.tsx` `useSlotVariables`, `api/src/services/mail/expandBlocks.ts` `slotVariables`
- Problem: the same regex rule ("which slot ids / is `props` named in this text")
  was written twice, with small differences (`[^\w-]` vs `[^\w]`, `\bprops\b` matched
  `item.props`).
- Fix: one helper `slotVariableUse(slots, text)` in `@sitesurge/types`
  (`template/templateFunctions.ts`), used by both. Tests in `templateFunctions.test.ts`.

### 5. `{{ props.x }}` in the component editor fired an entity lookup — fixed (low)
- `components/blocks/slotContext.tsx`
- Problem: `props` was bound only when the using block had props. In the component
  editor (no using block) `props` fell through to `rt.resolve('props')` →
  `GET /entities/props` 404.
- Fix (web): `props` is bound as `{}` whenever the text names it. Email keeps binding
  only when props are set (binding forces the early text pass — see planned item P2).

### 6. Inline `{{ template('X', list) }}` rendered only the first record on the web — fixed (med)
- `components/blocks/InlineTemplate.tsx`, `services/template/runtime.ts`
- Problem: SSR/email wrap the call as an entity block and render one copy per record
  (`templateRenderGroups`); the web rendered `record` (the first) only. Web also
  ignored the template's `maxRecords` cap.
- Fix: web uses `templateRenderGroups` (each / once) and applies `maxRecords`.

### 7. Script source returned to anonymous readers — fixed (low)
- `api/src/routes/components.ts` (`GET /templates`, `/templates/:id`, `/lookup`)
- Problem: the optional-auth reads returned `script` (including a DISABLED one) and
  `sampleRecordIds` to anyone. The site only needs blocks; the enabled script is
  served by `client.js`.
- Fix: `forViewer()` strips both for non-staff and adds `hasScript` (new optional
  field on `ContentBlockTemplate`) so the site can skip `client.js` (see X1).

### 8. Component block: switching component kept stale slot bindings; deleted component was silent — fixed (low)
- `components/admin/blocks/types/TemplateBlock.tsx`
- Fix: on change, bindings for slot ids the new component does not declare are
  dropped (props kept). A block pointing at a deleted component shows a notice.

### 9. Prop names were not validated — fixed (low)
- `components/admin/blocks/types/TemplateBlock.tsx`
- Problem: a key like `my key` saved fine but can never be read as `{{ props.… }}`.
- Fix: `CommitInput validate` — letters, digits, `-`, `_`, starting with a letter.

### 10. Help prose: an unmatched backtick turned the rest of the line into code — fixed (low)
- `components/admin/help/inlineCode.tsx`
- Problem: the comment said an odd backtick stays prose; the code rendered the tail
  as `<code>` (and dropped an unmatched `**`).
- Fix: pure `splitInline()` (delimiters kept when unmatched) + `inlineCode.test.ts`.

### 11. `?collection=none` on "+ New component" — fixed (low)
- `pages/admin/entities/TemplateEditor.tsx`
- Problem: a hand-typed `?collection=none` became `collectionId: 'none'` → 400 on save.
- Fix: ignored.

### 12. `form(…, submitLabel=)` — three identical commits — ok
- ab8dfdfd / a73c9ac2 / 724c1d43: one real change (`TemplateEntity.tsx` passes
  `submitLabel` to `FormRenderer`) + two wording edits of the same reference line. No
  leftovers or duplication in the final tree. SSR/email flatten a form to a link, so no
  button text to carry there.

### 13. Reference text for `template()` with a list — fixed (low)
- `services/template/reference.ts` — now says a list renders once per record and the
  record cap applies.

## Planned (not done here)

### P1. Collection delete with `components=delete` is not one transaction (med)
- `api/src/services/componentCollections.ts` `remove`; migration 182 comment claims
  "in one transaction".
- Each component is deleted through `contentBlockTemplates.remove` (own queries,
  revisions, caches); a failure mid-way leaves some deleted and the collection
  intact (retryable, nothing orphaned). Fix needs a client-aware
  `contentBlockTemplates.remove(id, { client })` + revision cancel after commit.

### P2. Email/SSR resolve template text EARLY against the template's bag only (med–high, structural)
- `api/src/services/mail/expandBlocks.ts` `cloneBlocks` / `resolveBlockText`
- An entity template's text (and a component's when it reads slots / props) is
  resolved with `{ record, slot vars, props }` only. Outer variables — the
  recipient's `{{ user.* }}`, `{{ unsubscribeUrl }}`, the page's `{{ post.* }}` —
  are empty there, while the web resolves everything in one runtime. Fix: pass the
  outer context into `expandDynamicBlocks` (or resolve only the names the bag
  defines and leave the rest for the final pass).

### P3. Copy / editor save flatten block-style template refs (med)
- `findBlocksResolved` → `populateBlockStyles` replaces `style: { id }` with the
  style's values; any save of those blocks (Copy, TemplateEditor) stores the inline
  copy, so later edits to the style template no longer reach the component. Fix: a
  server-side `POST /components/templates/:id/copy` on `cloneBlockTree`
  (`services/blockStores.ts`), and an unresolved read for the editor.

### P4. `findForRender` is uncached on the server (low, perf)
- `api/src/services/contentBlockTemplates.ts` — every server `{{ template() }}` /
  `{{ component() }}` = 2 queries (+ entityManager). A `{{ for }}` over 20 products
  repeats it 20×. Memoise per render (the expand state already memoises
  `loadTemplate`) or cache by id/name with the template-list invalidation.

### P5. `collectionId` accepted on entity-bound templates (low)
- `PUT /components/templates/:id` takes `collectionId` for any row. Harmless (counts
  and the page filter by `entity_type_key IS NULL`); reject or ignore for non-components.

## Cross-area (files owned elsewhere)

- **X1** `packages/cms/src/components/blocks/types/TemplateBlock.tsx` (public): skip the
  `client.js` import when `tpl().hasScript === false` (non-staff reads now carry it;
  staff reads carry `script` / `scriptEnabled`). Saves one request per component
  use on every public page.
- **X2** `packages/cms-client` — none needed (response shape only gained an optional
  field).

## Verification

- `packages/shared`: vitest 232/232, `npm run build` OK.
- `packages/cms`: `tsc --noEmit` — only the pre-existing SocialBlock / CampaignDonations
  / FormSubmissions errors; vitest 486/486.
- `packages/api`: `tsc --noEmit` clean; vitest 1908/1908.

## Lead follow-up (2026-10-21)
- **P1 — DONE.** `componentCollections.remove(…, 'delete')` deletes the components (blocks cascade) and the collection in ONE transaction, then cancels their pending revisions (`contentBlockTemplates.cancelPendingRevision`) and clears the cache.
- **P5 — DONE.** The repo never stores a `collection_id` on an entity-bound template (insert: NULL when `entityTypeKey`; update: `CASE WHEN entity_type_key IS NULL`).
- **X1 — DONE.** Public `TemplateBlock` skips the `client.js` import when the component has no runnable script (`hasScript === false`, or for staff reads a disabled / empty `script`).
- P2, P3, P4 stay planned (structural / perf).
