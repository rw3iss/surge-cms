/**
 * Gallery (`/api/v1/gallery`) — wire DTOs. Entity shapes live in
 * `types/gallery.ts`; these only name the request/response bodies.
 */
import type {
    GalleryAccessRule, GalleryCollection, GalleryCollectionDeleteMode, GalleryCollectionInput, GalleryInheritSwitch, GalleryItem, GalleryItemVisibility, GalleryListResult, GalleryPublicConfig, GalleryQuery, GallerySettings,
} from '../../types/gallery';

/** GET /gallery — viewer-gated list. Query = GalleryQuery with `ids`/`tag` as comma lists. */
export interface GalleryListQuery extends Omit<GalleryQuery, 'ids'> {
    ids?: string;
}
export type GalleryListResponse = GalleryListResult;
export type GalleryItemResponse = GalleryItem;
export type GalleryConfigResponse = GalleryPublicConfig;

/** Editable fields of one item. */
export interface GalleryItemPatch {
    titleOverride?: string | null;
    captionOverride?: string | null;
    tags?: string[];
    visibility?: GalleryItemVisibility;
    minTierId?: string | null;
    comments?: GalleryInheritSwitch;
    anonymousComments?: GalleryInheritSwitch;
    /** Move into a collection (null = the gallery root). Omitted = unchanged (publish too). */
    collectionId?: string | null;
    /** The item's own role / tier gate. Omitted = unchanged. */
    access?: GalleryAccessRule;
    /** Leave out of the gallery listings. Omitted = unchanged (publish too). */
    hiddenInGallery?: boolean;
}
export type GalleryItemUpdateBody = GalleryItemPatch;

/**
 * PUT /gallery/admin/items — PUBLISH the admin's draft in one transaction:
 * the full ordered list of items to keep (existing by `id`, new by `mediaId`)
 * with their settings, plus removals. A removal with `deleteMedia` also
 * deletes the media item from the library.
 */
export interface GallerySyncItem extends GalleryItemPatch {
    /** Existing item; omit for a new one. */
    id?: string;
    /** Required for a new item (the media to publish). */
    mediaId?: string;
}
export interface GallerySyncBody {
    items: GallerySyncItem[];
    remove?: { id: string; deleteMedia?: boolean; }[];
}
export interface GallerySyncResponse {
    items: GalleryItem[];
    added: number;
    updated: number;
    removed: number;
    mediaDeleted: number;
}

/** GET /gallery/admin/items — every item incl. ones whose media is gone. */
export type GalleryAdminItemsResponse = GalleryItem[];

export type GallerySettingsResponse = GallerySettings;
export type GallerySettingsBody = Partial<GallerySettings>;

/** DELETE /gallery/admin/items/:id?deleteMedia=true */
export interface GalleryRemoveResponse {
    removed: true;
    mediaDeleted: boolean;
}

// ─── Collections ──────────────────────────────────────────────────────────

/** GET /gallery/collections — collections visible to the viewer (counts = visible items). */
export interface GalleryCollectionsQuery {
    /** Gallery-page listing: leave out collections hidden from the gallery. */
    listing?: boolean;
}
export type GalleryCollectionsResponse = GalleryCollection[];
/** GET /gallery/collections/:id — 404 when missing or the viewer fails its rule. */
export type GalleryCollectionResponse = GalleryCollection;
/** GET /gallery/admin/collections — every collection, counts of ALL items. */
export type GalleryAdminCollectionsResponse = GalleryCollection[];
/** POST /gallery/admin/collections (name defaults to "Untitled"). */
export type GalleryCollectionCreateBody = GalleryCollectionInput;
/** PATCH /gallery/admin/collections/:id */
export type GalleryCollectionUpdateBody = GalleryCollectionInput;

/**
 * DELETE /gallery/admin/collections/:id — what happens to its items:
 * `delete` removes them from the gallery (their media too only with
 * `deleteMedia`, which needs `media:write`), `root` moves them to the gallery
 * root, `move` moves them into `targetId` (must exist, ≠ the deleted one).
 */
export interface GalleryCollectionDeleteBody {
    items: GalleryCollectionDeleteMode;
    targetId?: string;
    deleteMedia?: boolean;
}
export interface GalleryCollectionDeleteResponse {
    deleted: true;
    /** Items removed (`delete`) or moved (`root` / `move`). */
    items: number;
    mediaDeleted: number;
}

/** POST /gallery/admin/items/move — into a collection, or null = the root. */
export interface GalleryMoveItemsBody {
    ids: string[];
    collectionId: string | null;
}
export interface GalleryMoveItemsResponse {
    moved: number;
}
