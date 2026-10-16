# Gallery

Opt-in feature `gallery` (Settings → Features → Gallery). Publishes media from
the library to a public gallery page, with comments, a **Gallery** content
block and the `{{gallery(...)}}` template function. In-admin guide:
`/admin/help/gallery` (`GALLERY_DOC` in `packages/cms/src/services/help/sdkReference.ts`).

## Data model

`gallery_items` (migration `140_gallery.sql`, `-- @feature gallery`):

| Column | Meaning |
|---|---|
| `media_id` | The media this item publishes. **1:1** (partial unique index). `ON DELETE SET NULL`. |
| `title`, `caption` | Overrides; empty → the media's title / description (`caption`). |
| `tags` | `TEXT[]` (GIN index), lower-cased. Query with `tag`. |
| `sort_order` | Gallery order (rewritten on every Publish). |
| `visibility` | `inherit` \| `public` \| `members` \| `tier` (+ `min_tier_id`). |
| `comments`, `anonymous_comments` | `inherit` \| `on` \| `off` (inherit → gallery settings). |
| `collection_id` | The collection the item is in; NULL = the gallery root (migration 153). `ON DELETE SET NULL`. |
| `access_enabled`, `access_roles`, `access_tier_ids` | The item's own role / subscription-level rule (see Access model). |
| `hidden_in_gallery` | **Hide from gallery** (migration 154): left out of the gallery listings only (see below). |

`gallery_collections` (migration `153_gallery_collections.sql`): `name`
(default "Untitled"), `description`, `sort_order`, the same three `access_*`
columns, `hidden_in_gallery` (migration 154), `created_by`. **One level only — collections never nest.** A
collection is a folder of items; its public page is
`<baseUrl>/collection/<id>` (`galleryCollectionPath`). A new collection is
placed FIRST (sort order = current minimum − 1) unless `sortOrder` is given.
Deleting a collection (`DELETE /admin/collections/:id`, one transaction)
decides what happens to its items: `delete` removes them from the gallery
(+ their comment threads; their media only with `deleteMedia` + `media:write`,
after the commit), `root` moves them to the gallery root, `move` moves them
into `targetId` (must exist, must differ). Publish (`PUT /admin/items`)
**preserves** `collection_id` / `access_*` / `hidden_in_gallery` for items whose input omits them;
a new item may carry `collectionId` + `access` + `hiddenInGallery`.

### Hide from gallery (`hiddenInGallery`, items + collections)

A switch in the admin item panel (draft → Publish) and the collection panel
(Save); admin tiles / folders show a **Hidden** badge. A hidden item or
collection still EXISTS for everything else — it is only left out of the
public gallery **listings**:

| Read | Hidden item | Item in a hidden collection | Hidden collection |
|---|---|---|---|
| `/gallery` grid, load-more totals, lightbox strip (`listing=true`) | left out | left out | not in the collections section |
| Collection page grid (`listing=true` + that `collectionId`) | left out | **listed** (it is its own page) | — |
| Collections sidebar / cards (`GET /collections?listing=true`) | — | — | left out |
| Item page prev / next (`listing=true`) | none (not in the list) | within the collection | — |
| Its own page (`<baseUrl>/<id>`, `<baseUrl>/collection/<id>`) | works | works | works |
| Gallery block, `{{gallery()}}`, email, `gallery_item` entity, admin | returned | returned | returned (`GET /collections` without `listing`) |
| Sitemap + SSR index / collection bodies | left out | left out | left out |

`GalleryQuery.listing` is applied in SQL (`listingConditions` in
`services/gallery/items.ts`) with the access gate, so totals and pagination
agree; absent = include everything, so blocks / templates / email / entity
reads are unchanged. Anonymous cache keys include it (the list key hashes the
query; collections use `gallery:collections:listing`). A collection's site
`itemCount` + cover never count hidden items (they follow its page's grid).
The sitemap leaves hidden items / collections out — they are not meant to be
browsed.

- **Deleting an item never deletes the media** — unless the caller asks
  (`deleteMedia`, needs `media:write`). Deleting the media of a video that is
  still encoding stops the encode first (the same path as Cancel below).
- **Upload titles + Cancel.** Upload new (`MediaStageModal`) shows a title
  input per file, prefilled with the file name without its extension; the
  staged tile keeps it editable until its upload finishes on Publish (the
  latest value is sent). The title goes on the MEDIA item; the gallery item
  inherits it (an override equal to it is dropped). While a staged file
  uploads, its tile shows **× Cancel** (aborts the upload, drops the row);
  a published video still encoding shows **× Cancel** too — confirmed, it
  calls `POST /media/:id/discard`, which stops the encode, deletes the files,
  the media row and the gallery item.
- **Deleting the media** leaves the item with `media_id = NULL`: listed in the
  admin (`media: null`), hidden from every public read (404).
- Settings: `gallery_settings` keyed row (`GallerySettings` in
  `@sitesurge/types` `types/gallery.ts`) — title, description, `baseUrl`
  (default `/gallery`), `access` + `minTierId`, `allowVideos`, comment
  defaults, `appearance` (layout, thumbnail size, gap, aspect, fit, radius,
  gutter / padding / max width (site or custom), titles, captions,
  `showPublishedDate`, hover zoom, per page, video badge, and the **Behavior**
  pair `open` + `thumbStrip`).
- **Behavior** (Appearance tab, right column): *Open item action* = `open`
  `lightbox` ("Modal", default) | `page` ("Go to page" — every tile is a real
  `<a href="<baseUrl>/<id>">`, so middle-click / new tab works; no modal).
  The legacy `none` still works but is only offered when already set. With
  Modal, *Show thumbnail carousel* (`thumbStrip`, default off) adds a strip of
  every LISTED item's thumbnail (`media.thumbnailUrl`, lazy) along the bottom
  of the modal, in listing order, the open item highlighted and centred; ‹ ›
  page it on desktop, touch scrolls it natively (scroll-snap) on mobile;
  clicking a thumbnail opens that item. The modal is full screen at every size.
  The Gallery block has the same switch (`GalleryBlockSettings.thumbStrip`) and
  `{{gallery(thumbs=true)}}`.
- **Published date:** `GalleryItem.publishedAt` = the row's `created_at` — a
  row is only ever INSERTed by the admin Publish and `created_at` is never
  updated, so it is the first-publish date and republishing never moves it
  (removing the item and adding the media again is a new item, a new date).
  *Show date published* (`appearance.showPublishedDate`, default off) prints it
  on the item DETAIL page only, under the title and caption ("October 14,
  2026", muted, centred like the title) — never on the listing or in the modal.

## Access model

One rule shared with the forum: `services/access/level.ts`.

```
level(viewer):  anonymous -1 · signed in (no paid tier) 0 · subscriber = tier rank · staff ∞
floor(rule):    public -1 · members 0 · tier = that tier's rank (higher tiers pass)
visible when    level >= floor
```

- Gallery page: `floor(settings.access)`. Item: its own visibility, or the
  gallery's for `inherit` — computed in SQL (`FLOOR_SQL` in
  `services/gallery/items.ts`), so pagination totals stay right.
- An item's own rule **replaces** the default: a public item in a members-only
  gallery can appear in a block on a public page.
- Subscription-required mode: a member without a paid tier is level -1.
- `gallery:view` (everyone by default) is checked first by the public routes.

### Role / subscription-level rules (collections + items)

`GalleryAccessRule = { enabled, roles[], tierIds[] }` on collections and
items (`services/gallery/access.ts`). A rule is **active** when `enabled` AND
at least one role or tier is chosen — enabled with nothing chosen inherits.

| Item rule | Collection rule | Effective gate |
|---|---|---|
| active | any | the item's rule |
| inactive | active | the collection's rule |
| inactive | inactive / no collection | the level floor above (item visibility / gallery access) |

An active rule **replaces** the floor: the viewer passes when staff, OR holds
any listed role (main `users.role` or `users.extra_roles`), OR has an entitled
subscription (`ENTITLED_STATUSES`) to a listed tier. A signed-in member with
no paid subscription holds the Free tier (not in subscription-required mode).
Anonymous never passes an active rule. What the viewer holds is built once per
request (`services/access/grants.ts` `viewerGrants`) and bound into the SQL
predicate (`itemGateSql`), so counts and pagination stay right.

A **collection** is listed / openable only when its rule is inactive or the
viewer passes it (`collectionGateSql`); its `itemCount` + cover use the same
item gate, so the count matches the collection page. An item with its OWN
active rule follows that rule even inside a collection the viewer cannot open
(first match wins). The `email` audience ignores all in-site rules, as above.

### Audiences (`services/gallery/items.ts` `list(query, { audience })`)

| Audience | Who | Rule |
|---|---|---|
| `site` (default) | a viewer (null = anonymous) | media present + ready, videos only when allowed, `level >= floor` |
| `email` | mail templates, newsletters | media present + ready + **`media.access_level = 'public'`** — the in-site gate is ignored |
| `admin` | the Gallery admin page | everything, incl. orphaned items |

The `email` audience is deliberate: the gallery's gates are for the SITE. An
inbox may show a members-only item whenever its media is public, using the
media's own CDN URL; private media (private videos) never reach an email.

Anonymous `site` lists are cached 60 s (`CACHE_KEYS.galleryList`, except
`sort=random`); `cache.invalidateGalleryCache()` runs on every gallery write
and settings change and from `invalidateMediaConsumersCache()` (media edits
and deletes). Gallery writes also drop the sitemap cache.

## API (`/api/v1/gallery`, feature-gated → 404 when off)

| Route | Auth | |
|---|---|---|
| `GET /config` | optional | Title, route, appearance, `canView` + `reason` for THIS viewer |
| `GET /` | optional | Query: `collectionId` (`root` or a uuid; absent = all items), `type`, `tag`, `search`, `ids` (comma list, kept in order), `sort`, `limit`, `page`, `listing` (gallery pages: leave out hidden items) |
| `GET /collections` | optional | Collections visible to the viewer (sort order, name), `itemCount` = items the viewer can see, cover; `listing=true` leaves out hidden collections |
| `GET /collections/:id` | optional | One collection; 404 when missing, 403 `SIGN_IN_REQUIRED` / `SUBSCRIPTION_REQUIRED` when the viewer fails its rule (the page forwards to `/login?redirect=…&reason=…`) |
| `GET /items/:id` | optional | One item; 404 when missing / media gone, 403 `SIGN_IN_REQUIRED` / `SUBSCRIPTION_REQUIRED` when gated (the page forwards to `/login?redirect=…&reason=…`) |
| `GET /admin/items` | staff, `gallery:manage` | Every item in order |
| `PUT /admin/items` | staff, `gallery:manage` | **Publish** the draft: ordered `items` (existing `id` / new `mediaId` + options) and `remove` (`deleteMedia`) in one transaction; media deletes run after commit — media still used elsewhere is KEPT (`mediaKept`) unless `forceMedia: true` |
| `PATCH /admin/items/:id` | staff | Edit one item (incl. `collectionId`, `access`, `hiddenInGallery`) |
| `POST /admin/items/move` | staff, `gallery:manage` | `{ ids, collectionId }` (null = root) |
| `GET /admin/collections` | staff, `gallery:manage` | Every collection, counts of ALL items |
| `POST /admin/collections` · `PATCH /admin/collections/:id` | staff, `gallery:manage` | Create (name default "Untitled") / update (name, description, sortOrder, access, hiddenInGallery) |
| `DELETE /admin/collections/:id` | staff, `gallery:manage` (+ `media:write` for `deleteMedia`) | Body `{ items: 'delete'\|'root'\|'move', targetId?, deleteMedia?, forceMedia? }` — in-use media kept unless `forceMedia` |
| `DELETE /admin/items/:id?deleteMedia=true[&forceMedia=true]` | staff | Remove one item (in-use media kept unless `forceMedia`) |
| `GET /admin/media-links?ids=` | staff | media id → item id |
| `GET /settings` · `PUT /settings` | staff · admin + `gallery.settings:manage` | Settings |

SDK: `cms.gallery.config / list / item / collections / collection / adminCollections / createCollection / updateCollection / deleteCollection / moveItems / admin.{items,publish,update,remove,mediaLinks} / settings / updateSettings`.

Settings: `appearance.showCollectionsSidebar` (default off) — a collections
sidebar on collection pages and on item pages of collected items.

## Comments

Target type `gallery_item` (`services/gallery/targets.ts`), registered under
the **Comments** feature (guests need `comments:anonymous`, which lives there)
and refused while Gallery is off. Reading follows the item's visibility;
commenting follows the item's switch, else the gallery default; approval
follows Comments → Settings. Signed-in users need `gallery:comment`.
The item's effective switches reach the public `CommentsSection` through
`GET /comments/threads/gallery_item/:id`, which asks the target's
`resolveThread()` (a generic `CommentTarget` hook) instead of returning the raw
`comment_threads` row — for a gallery item that row only holds the count and lock.

## Entity type

`gallery_item` is a read-only core entity type (`coreDescriptors.ts` →
provider `services/gallery/entity.ts`), so the shared
`EntitySearchSelectModal` picks items / builds queries for the Gallery block,
and entity blocks / carousel entity items can render items through a
template (`{{gallery_item.media.url}}`). Virtual filters: `type`, `tag`, `sort`, `collection` (id or `root`).
`{{gallery(collection='<id>')}}` (or `'root'`) maps to `GalleryQuery.collectionId`.

## `{{gallery(...)}}`

One mapping for every runtime: `galleryCallFor` + `galleryDisplayFrom` in
`packages/shared/src/template/galleryFunctions.ts`. A call returns
`entityRef('galleryList', items)` (iterable in `{{for}}`) or
`entityRef('galleryItem', item, id)`; named args ride on the ref's `options`.

```
{{gallery('<id>')}}  {{gallery('<id>').media.url}}  {{gallery(8)}}  {{gallery('video', 4)}}
{{gallery(type='image', tag='featured', sort='newest', limit=12, layout='grid', columns=4, mobileColumns=2)}}
{{gallery(layout='carousel', itemsPerPage=3, autoplay=true, interval=4)}}
{{for gallery(tag='events', limit=6) as g}}<img src="{{g.media.thumbnailUrl}}">{{endfor}}
```

| Runtime | Audience | Whole render |
|---|---|---|
| Site (`packages/cms/src/services/template/runtime.ts`) | the signed-in viewer | the shared gallery view component |
| SSR (`services/ssr/templateRuntime.ts`) | anonymous `site` | `<figure>` list (`services/gallery/render.ts` `galleryFiguresHtml`) |
| Email (`services/mail/templateRuntime.ts`) | `email` (public media) | table grid (`galleryEmailHtml`, same layout rules as the block below; 3 across unless `columns=`; one item = full width) |

The audience is passed to the shared backend runtime as
`buildBackendRuntime({ galleryAudience })`; resolution is in
`services/gallery/serverRender.ts`.

## Gallery content block (`type: 'gallery'`)

Settings = `GalleryBlockSettings`: `source` `items` (`itemIds`) | `query`
(`GalleryQuery`), `desktop` / `mobile` layout options (`layout` grid | row |
column | carousel | stage, `columns`, `itemsPerPage`, `scrollBy`, `gap`,
`itemWidth`, `itemHeight`, `aspect`, `fit`, `rows`; mobile falls back per
key), `autoplay` + `autoplayInterval`, `pauseOnHover`, `loop`, arrows, dots,
titles, captions, `open`, `thumbStrip`, `itemRadius` (the legacy `radius` key is still read). The block type name reuses the retired
legacy `gallery` enum value (its rows were deleted by migration 027).

Server emitters are synchronous, so a **pre-pass** resolves each block's
items and stashes them on `settings.__galleryItems`
(`preResolveGalleryBlocks` / `resolveGalleryBlockItems`):

- SSR: `ssr/routes.ts` (page, home and post block loaders) → `ssr/blocks/gallery.ts` emits figures.
- Email: `mail/expandBlocks.ts` (`email` audience) → `mail/blocks/gallery.ts`
  emits tables (`galleryEmailPlan` + `galleryEmailHtml` in
  `services/gallery/render.ts`; only the DESKTOP options apply):

  | Layout | Email |
  |---|---|
  | `grid` | grid of `columns` (≤6; a px `itemWidth` fits as many as the width allows; default 3), last row padded, left-aligned |
  | `column` | one item per row, full width |
  | `row` / `carousel` / `stage` | wrapped grid: thumbnails flow left-to-right, each row centred; columns = `itemsPerPage` (row) / `columns` else `itemsPerPage` (carousel, stage), or a px `itemWidth` vs the body width |

  Width = the 600px body minus the block's px padding. Each item is a fixed
  box — `itemHeight` (px), else the `aspect` (`original` = the picture at its
  natural height) — drawn as a background-image cell of exactly that size
  (`background-size` = the Fit setting; a VML rect for Outlook), so the crop
  matches the site. Every item **always links to its gallery item page**
  (the block's On-click option is ignored — an inbox has no lightbox); a video
  keeps the "▶ Watch" bar (`mail/blocks/watchOverlay.ts`). Gap → half the gap
  as padding around each item.

### Alignment + size (block style)

The Gallery block takes the block's full inner width; alignment is applied
inside it. Order: **Horizontal Alignment** → else **Text Align** → else centre.
It shows when items are narrower than the block — a fixed **Item width**
(column tiles, grid tracks, unpaged row, stage picture) or a block
width / max-width. Titles and captions follow **Text Align**. Web: CSS var
`--gv-justify` (`GalleryView.scss`), `gridTemplateColumns()` in
`galleryLayout.ts`. Email: block width / max-width minus the cell padding is
the gallery width; a fixed Item width shrinks each slot to the item; each row
table gets `align` + margin from `galleryEmailAlign()` (`gallery/render.ts`);
background, radius, padding stay on the block cell.

### Item border radius

`itemRadius` (admin: **Item border radius**; any CSS length, a bare number =
px). The Video block has the same setting.

| Value | Site + admin preview | Email |
|---|---|---|
| empty | the site's Appearance → Border Radius (`--site-radius`), else 8px (video 6px) | the same site value (read into the mail render context), else 8px (video: the block's Border Radius first, then 6px) |
| `0` | square | square |
| `12px` / `12` | 12px | 12px |

On the web it sets `--item-radius` on the gallery view (tiles, the stage
picture and video; not the lightbox) or the video block (`.vp`,
`.media-video__stage`, the embed wrapper). In email it is inline
`border-radius` on each item cell / image and the Watch bar's bottom corners.

## SSR pages + sitemap

`services/ssr/staticMeta.ts` resolves `<baseUrl>`, `<baseUrl>/<id>` and `<baseUrl>/collection/<id>`
authoritatively while the feature is on: a public gallery gets meta, a
`CollectionPage` schema and a figure body; an item gets its title, caption and
`og:image` (the media URL when the media is public). An unknown item or one
whose media is gone is a real 404. A gated gallery or item (exists, but not
for an anonymous crawler) answers `noindex` with no body — the SPA shows the
sign-in / subscribe prompt (the forum's rule). A collection follows the same
rule: unknown → 404, behind a rule an anonymous crawler fails → `noindex`.
The sitemap lists the index, the anonymously visible collections and items
only when the gallery is publicly readable, from the anonymous `listing`
lists — so items / collections hidden from the gallery are not in it.

## Configurable route

`services/access/publicPath.ts` `validatePublicBasePath` (shared with the
events calendar): one `[a-z0-9-]` segment, not a built-in route
(`RESERVED_PUBLIC_PATHS` in `@sitesurge/types`, except the feature's own
default) and not an existing page slug.
