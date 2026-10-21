# Audit 2026-10-21 — Area C: Gallery + shared query modal

Scope: commits a8b2a920 (Is featured), c95f9c00 (Set data… ↔ GalleryQuery),
f3d99127 (Fit cover/contain/hug + title position/alignment), 56c2c6c4
(masonry drops empty columns), ad5b0088 (query modal rows on one line).

Risk: L = low, M = medium, H = high. Status: **fixed** / **planned**.

| # | Title | Location | Problem | Fix | Risk | Status |
|---|---|---|---|---|---|---|
| 1 | Settings save refused Fit = Hug | `api/src/routes/gallery.ts:102` | The appearance zod schema allowed only `cover`/`contain`, so saving the /gallery page with **Hug** (offered by the UI since f3d99127) was a 400. | `fit: z.enum(['cover','contain','hug'])`. | L | fixed |
| 2 | `!=` ignored by the Set data… → GalleryQuery mapping | `shared/src/utils/galleryQuery.ts` | `galleryFilterValue` read the value and dropped the operator: `featured != true` became `featured = true` (the opposite), likewise `type != video`. | `galleryFilterOp`; `!=` inverts `featured` and `type`; a negated `tag`/`collection` is dropped (wider, never inverted). Tests added. | L | fixed |
| 3 | Query-modal suggestion APPENDED for single-value operators | `cms/.../entities/EntityValueInput.tsx`, `EntitySearchSelectModal.tsx` | Picking "true" then "false" for `featured =` produced `true, false`, which matches nothing. | `multiple` prop (default true); the modal passes `multiple={op === 'in'}` → a pick replaces; search term = whole draft. | L | fixed |
| 4 | /gallery page had no title position / alignment | `shared/types/gallery.ts`, `api/services/gallery/settings.ts`, `routes/gallery.ts`, `GallerySettings.tsx`, `galleryLayout.appearanceToView` | The block got title placement; the gallery page appearance did not (and the zod schema would have stripped it). | `appearance.titlePosition` (default below) + `titleAlign` (`''` clears — the save merges); validated in `cleanAppearance` (exported + tested) and the route; UI in Settings → Appearance → Tiles; passed to GalleryView. | M | fixed |
| 5 | Web masonry ignored title/caption height | `cms/components/gallery/GalleryView.tsx`, `api/services/gallery/render.ts` | Email estimated media + text lines; web used `1/aspect` only, so the two surfaces could place items in different columns (docs say "same placement"). | Shared `galleryMasonryItemHeight` (`@sitesurge/types`) used by both (web at a nominal 240px column). Tests added. | L | fixed |
| 6 | Stage: contain behaved like hug | `GalleryView.tsx` stage, `GalleryView.scss` | `fit !== 'cover'` applied the hug styling, so Fit = contain resized the stage per item. | Stage hug class only for `hug`; contain keeps the full-width box with `object-fit: contain`. | L | fixed |
| 7 | Stage title alignment did nothing; `above` ignored | `GalleryView.tsx` | The meta row is a flex row, so `text-align` had no effect; position `above` still rendered below. | `justify-content` from the alignment; `--above` modifier (`order: -1`). Overlay positions read as below on the stage (tooltip says so). | L | fixed |
| 8 | `{{gallery()}}` lengths used a weak regex | `shared/template/galleryFunctions.ts` | `gap`/`itemWidth`/`itemHeight` only refused `;{}<>"` — `url(`, comments, escapes passed. | Shared `isSafeCssValue` + 64-char cap. Test added. Email `safeCss` (text colour) also moved to the shared rule. | L | fixed |
| 9 | `{{gallery()}}` could not reverse a sort | `galleryFunctions.ts` | `GalleryQuery.dir` existed (the block's query uses it) but the template function had no way to set it. | `dir='desc'|'asc'`. Test + GALLERY.md. | L | fixed |
| 10 | Duplicate boolean parsing | `galleryFunctions.ts`, `galleryQuery.ts` | `featured=` parsed twice with different rules. | Shared `galleryBoolOf`. | L | fixed |
| 11 | Admin: featured not visible / not bulk-editable | `GalleryAdmin.tsx`, `galleryBulk.ts`, `GalleryAdmin.scss` | No badge, no filter, no bulk action for the new flag. | "★ Featured" tile badge, **Featured** type filter, bulk **Featured…** (mark / unmark). Tests added. | L | fixed |
| 12 | Stale "contain hugs" comments | `GalleryTile.tsx`, `galleryLayout.ts` (TileFrame, tileFrame), `GalleryView.scss`, `render.ts` (`galleryContainSize`), `entity.ts` header (no `featured`), `settings.ts` orphan doc comment | Comments described the pre-f3d99127 meaning. | Rewritten. | L | fixed |
| 13 | Email contain: string-replace hack | `render.ts` `plain()` | The centred picture was made by `.replace('margin:…', 'margin:0 auto;')` on generated HTML. | `plain()` takes a `margin` parameter. | L | fixed |
| 14 | Query modal: dead conflicting rule + a11y + warning | `EntitySearchSelectModal.scss/.tsx` | An old `&__query { display: grid }` rule survived beside the new flex rule; selects/value had no accessible names; "Overrides the row above" showed on an empty row; a phone-width modal overflowed. | Rule removed; `aria-label` Property / Operator / Value; warning needs a value; wraps ≤560px; placeholder per operator. | L | fixed |
| 15 | GalleryBlockEdit indentation | `GalleryBlockEdit.tsx` masonry `<Show>` | Children not indented. | Reindented. | L | fixed |
| 16 | Suggestions menu has no keyboard navigation | `EntityValueInput.tsx` | Arrow keys do not move through the suggestions (mouse only; Enter commits the typed text). | Add active-index state, ↑/↓/Enter, `aria-activedescendant`, `role="listbox"`. | M | planned |
| 17 | Contain + overlay on a tall picture | web + email | With Fit = contain the overlay spans the box's bottom edge, which may be letterbox space beside a tall picture. Readable (the gradient gives contrast) but not ON the picture. | Option: under contain, put the overlay inside a wrapper sized by `galleryContainSize` (web needs the media size; unknown size → below). | M | planned |
| 18 | SSR ignores title position / Fit | `render.ts` `galleryFiguresHtml` | By design (crawler HTML; the SPA replaces it). | None. | — | by design |
| 19 | Featured filter and cache keys | `items.ts` | Checked: `featured` is part of the normalised query hashed into `CACHE_KEYS.galleryList`; Publish carries `is_featured` in both bulk statements. | None. | — | ok |
| 20 | Block query summary says "in a collection" | `GalleryBlockEdit.tsx` `querySummary` | The collection's name is not shown. | Loads the chosen collection's name (`cms.gallery.collections`) → "in <name>". | L | fixed |

## Tests added

- `shared/src/utils/galleryQuery.test.ts` — `!=` on featured / type, dropped negated tag / collection.
- `shared/src/template/galleryFunctions.test.ts` — `dir=`, unsafe lengths refused, `galleryMasonryItemHeight` + placement.
- `api/src/services/gallery/settingsCss.test.ts` — `cleanAppearance` keeps hug / title position / alignment, `''` clears.
- `cms/src/components/admin/gallery/galleryBulk.test.ts` — featured filter + bulk featured.

## Lead follow-up (2026-10-21)
- `dir='desc'` added to the `{{gallery()}}` help reference (`services/template/reference.ts`); `npm run docs:api` regenerated for the settings route change.
