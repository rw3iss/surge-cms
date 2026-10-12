/**
 * Gallery (`/api/v1/gallery`) — wire DTOs. Entity shapes live in
 * `types/gallery.ts`; these only name the request/response bodies.
 */
import type {
    GalleryInheritSwitch, GalleryItem, GalleryItemVisibility, GalleryListResult, GalleryPublicConfig, GalleryQuery, GallerySettings,
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
