# Gallery collections + role/tier access — contract

Status: IN PROGRESS (2026-10-16). Feature module: `gallery`. Every agent builds to THIS contract.

## Data (migration `153_gallery_collections.sql`, `-- @feature gallery`, listed in `features/registry.ts` for gallery incl. `tables`)
**DONE** — migration 153 + registry (`tables`, `migrations`).

```sql
CREATE TABLE IF NOT EXISTS gallery_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Untitled',
  description TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  access_enabled BOOLEAN NOT NULL DEFAULT false,
  access_roles TEXT[] NOT NULL DEFAULT '{}',
  access_tier_ids UUID[] NOT NULL DEFAULT '{}',
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS collection_id UUID NULL REFERENCES gallery_collections(id) ON DELETE SET NULL;
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS access_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS access_roles TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS access_tier_ids UUID[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS gallery_items_collection_idx ON gallery_items (collection_id);
```
One level only: collections never nest.

## Access rule (role / subscription-level gate)
**DONE** — `services/gallery/access.ts` (SQL + JS mirror) + `services/access/grants.ts`; unit-tested.

`GalleryAccessRule = { enabled: boolean; roles: string[]; tierIds: string[] }` on collections AND items.

A rule is **active** when `enabled && (roles.length || tierIds.length)`. Enabled with nothing chosen = NOT active (inherits).

Effective gate for an item, first match wins:
1. the item's own rule, when active;
2. else its collection's rule, when active;
3. else today's behaviour (item `visibility` / gallery floor via `services/access/level.ts`).

An active rule REPLACES the floor: the viewer passes when staff, OR has ANY listed role (main `users.role` OR `users.extra_roles`), OR has an active subscription (`subscriptions.status IN entitled statuses`) whose `plan_id` is in `tierIds`. Anonymous never passes an active rule.
A collection itself is visible when its rule is not active, or the viewer passes it. Applied in SQL (counts and pagination stay right), on every public read: listing, item, collection list/page, SSR, sitemap (gated → excluded), lightbox neighbours, `{{gallery()}}` (site audience). The `email` audience ignores in-site gates exactly as today.

## Settings
**DONE** — `appearance.showCollectionsSidebar` (types, defaults, settings cleaner, zod).
`GalleryAppearance.showCollectionsSidebar: boolean` (default false) — Appearance tab.

## Shared types (`packages/shared/src/types/gallery.ts`)
**DONE** — as specified, plus DTOs in `api/routes/gallery.ts`, `isGalleryAccessRuleActive`, `galleryCollectionPath`, `EMPTY_GALLERY_ACCESS_RULE`.
```ts
export interface GalleryAccessRule { enabled: boolean; roles: string[]; tierIds: string[]; }
export interface GalleryCollection {
  id: string; name: string; description: string; sortOrder: number;
  access: GalleryAccessRule;
  itemCount: number;            // items THIS viewer can see (admin: all)
  coverThumbnailUrl: string | null; // first visible item's thumbnail
  url: string;                  // `<baseUrl>/collection/<id>`
  createdAt: string; updatedAt: string;
}
// GalleryItem gains:  collectionId: string | null;  access: GalleryAccessRule;
// GalleryQuery gains: collectionId?: string | 'root';  (absent = all items)
// GalleryItemPatch / publish item input gain: collectionId?: string | null; access?: GalleryAccessRule;
export interface GalleryCollectionInput { name?: string; description?: string; sortOrder?: number; access?: GalleryAccessRule; }
export type GalleryCollectionDeleteMode = 'delete' | 'root' | 'move';
```

## API (`/api/v1/gallery`, feature-gated as today)
**DONE** — all routes live; SSR `<baseUrl>/collection/:id` + sitemap; `npm run docs:api` regenerated.
| Method | Path | Auth / permission | |
|---|---|---|---|
| GET | `/collections` | optional · `gallery:view` | visible collections (sort_order, name) with counts |
| GET | `/collections/:id` | optional | one collection; 404 when missing or the viewer fails its rule |
| GET | `/` | as today | + `collectionId` query (`root` or uuid) |
| GET | `/admin/collections` | staff · `gallery:manage` | all, counts of ALL items |
| POST | `/admin/collections` | staff · `gallery:manage` | create (`name` default "Untitled") → GalleryCollection |
| PATCH | `/admin/collections/:id` | staff · `gallery:manage` | update |
| DELETE | `/admin/collections/:id` | staff · `gallery:manage` | body `{ items: 'delete'|'root'|'move', targetId?, deleteMedia? }`; `delete` removes the items (and their media only with `deleteMedia` + `media:write`), `root` sets collection_id NULL, `move` → `targetId` (must exist, ≠ id) |
| POST | `/admin/items/move` | staff · `gallery:manage` | `{ ids: string[], collectionId: string|null }` |
`PATCH /admin/items/:id` and the publish `PUT /admin/items` accept `collectionId` + `access`. Publish must PRESERVE `collection_id` for items whose input omits it.

## SDK (`@sitesurge/client`, `cms.gallery`)
**DONE** — methods on `cms.gallery`, coverage entries, client rebuilt.
`collections()`, `collection(id)`, `adminCollections()`, `createCollection(body)`, `updateCollection(id, body)`, `deleteCollection(id, body)`, `moveItems({ ids, collectionId })`; `list()` takes `collectionId`. Add coverage entries; rebuild the client.

## Admin UI (`/admin/gallery`)
**DONE** — `pages/admin/gallery/GalleryAdmin.tsx` (folder tiles, `?collection=` view, breadcrumb, drag-to-folder / Back tile), `components/admin/gallery/` `CollectionPanel`, `AccessRuleEditor` (shared by collection + item panels), `DeleteCollectionModal`, item panel move controls; `galleryDraft` carries `collectionId` (sent for NEW rows only — published items move at once via `moveItems`) + `access`.
- Header: **+ New Collection** beside "Add from library" / "Upload new" (hidden inside a collection) → creates "Untitled" at the START of the grid, selects it (right panel).
- Collection tiles render as folders (name + count). Click selects (panel); double-click / "Open" enters. Inside: a single "↑ Back to gallery" virtual folder tile first, then the collection's items. Breadcrumb in the header.
- Drag an item tile onto a collection tile (or the Back tile) → moves it.
- Collection panel: Name, Description, **Restrict access** toggle → Roles multi-select + Subscription levels multi-select (hint: "Nothing chosen = inherits the gallery's access"), Save, Delete (confirm modal: radio Delete items from the gallery / Move items to the gallery root / Move to another collection → dropdown).
- Item panel: the same Restrict access block; inside a collection: **Remove from collection** and **Move to collection ▾**, near Delete.
- Generic `components/ui/MultiSelect.tsx` (options `{value,label,hint?}[]`, `value: string[]`, `onChange`, placeholder, search when > 8 options, chips, keyboard, click-outside) — reusable anywhere.

## Public UI
**DONE** — `GalleryPage` (Collections cards + root items via `useGalleryItems`), `GalleryCollectionPage` (`/gallery/collection/:id` + `/:slug/collection/:id` custom-base route), item page collection back links + collection-scoped prev/next, `GalleryCollections.tsx` (cards + sidebar layout, sticky sidebar / mobile sticky select like /shop), admin Behavior toggle "Show collections sidebar on pages". Public lists hide collections with 0 visible items.
- `/gallery`: when visible collections exist, a **Collections** section on top (cover, name, "N items"), then the ROOT items (collectionId = `root`).
- `/<baseUrl>/collection/:id`: title, description, items with the same open action (modal / page), "← Gallery" link. SPA route + SSR meta (`ssr/staticMeta.ts`, 404 / noindex like items) + sitemap.
- Item page: when the item is in a collection, back links to the collection AND the gallery; lightbox thumb strip uses the current listing.
- `appearance.showCollectionsSidebar`: a sidebar (names + counts, current highlighted, "All items" link) on collection pages and on item pages of collected items — modelled on the `/shop` sidebar (`pages/shop/ShopIndex.tsx` + `shop.scss`: layout, sticky offset `--site-header-offset`, mobile collapse).
