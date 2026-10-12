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

- **Deleting an item never deletes the media** — unless the caller asks
  (`deleteMedia`, needs `media:write`).
- **Deleting the media** leaves the item with `media_id = NULL`: listed in the
  admin (`media: null`), hidden from every public read (404).
- Settings: `gallery_settings` keyed row (`GallerySettings` in
  `@sitesurge/types` `types/gallery.ts`) — title, description, `baseUrl`
  (default `/gallery`), `access` + `minTierId`, `allowVideos`, comment
  defaults, `appearance` (layout, click mode, thumbnail size, gap, aspect, fit,
  radius, gutter / padding / max width (site or custom), titles, captions,
  hover zoom, per page, video badge).

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
| `GET /` | optional | Query: `type`, `tag`, `search`, `ids` (comma list, kept in order), `sort`, `limit`, `page` |
| `GET /items/:id` | optional | One item, 404 when gated / missing / media gone |
| `GET /admin/items` | staff, `gallery:manage` | Every item in order |
| `PUT /admin/items` | staff, `gallery:manage` | **Publish** the draft: ordered `items` (existing `id` / new `mediaId` + options) and `remove` (`deleteMedia`) in one transaction; media deletes run after commit |
| `PATCH /admin/items/:id` | staff | Edit one item |
| `DELETE /admin/items/:id?deleteMedia=true` | staff | Remove one item |
| `GET /admin/media-links?ids=` | staff | media id → item id |
| `GET /settings` · `PUT /settings` | staff · admin + `gallery.settings:manage` | Settings |

SDK: `cms.gallery.config / list / item / admin.{items,publish,update,remove,mediaLinks} / settings / updateSettings`.

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
template (`{{gallery_item.media.url}}`). Virtual filters: `type`, `tag`, `sort`.

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
| Email (`services/mail/templateRuntime.ts`) | `email` (public media) | table grid (`galleryEmailHtml`, 3 across unless `columns=`) |

The audience is passed to the shared backend runtime as
`buildBackendRuntime({ galleryAudience })`; resolution is in
`services/gallery/serverRender.ts`.

## Gallery content block (`type: 'gallery'`)

Settings = `GalleryBlockSettings`: `source` `items` (`itemIds`) | `query`
(`GalleryQuery`), `desktop` / `mobile` layout options (`layout` grid | row |
column | carousel | stage, `columns`, `itemsPerPage`, `scrollBy`, `gap`,
`itemWidth`, `itemHeight`, `aspect`, `fit`, `rows`; mobile falls back per
key), `autoplay` + `autoplayInterval`, `pauseOnHover`, `loop`, arrows, dots,
titles, captions, `open`, `radius`. The block type name reuses the retired
legacy `gallery` enum value (its rows were deleted by migration 027).

Server emitters are synchronous, so a **pre-pass** resolves each block's
items and stashes them on `settings.__galleryItems`
(`preResolveGalleryBlocks` / `resolveGalleryBlockItems`):

- SSR: `ssr/routes.ts` (page, home and post block loaders) → `ssr/blocks/gallery.ts` emits figures.
- Email: `mail/expandBlocks.ts` (`email` audience) → `mail/blocks/gallery.ts`
  emits a table grid: `grid` uses its columns, `row` / `carousel` their items
  per page, `column` / `stage` one per row (capped at 4).

## SSR pages + sitemap

`services/ssr/staticMeta.ts` resolves `<baseUrl>` and `<baseUrl>/<id>`
authoritatively while the feature is on: a public gallery gets meta, a
`CollectionPage` schema and a figure body; an item gets its title, caption and
`og:image` (the media URL when the media is public). An unknown item or one
whose media is gone is a real 404. A gated gallery or item (exists, but not
for an anonymous crawler) answers `noindex` with no body — the SPA shows the
sign-in / subscribe prompt (the forum's rule). The sitemap lists the index and
items only when the gallery is publicly readable, from the anonymous list.

## Configurable route

`services/access/publicPath.ts` `validatePublicBasePath` (shared with the
events calendar): one `[a-z0-9-]` segment, not a built-in route
(`RESERVED_PUBLIC_PATHS` in `@sitesurge/types`, except the feature's own
default) and not an existing page slug.
