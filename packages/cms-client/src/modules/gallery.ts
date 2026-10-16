import type {
    GalleryCollection, GalleryCollectionDeleteBody, GalleryCollectionDeleteResponse, GalleryCollectionInput, GalleryMoveItemsBody,
    GalleryMoveItemsResponse,
    GalleryAdminItemsResponse, GalleryItem, GalleryItemUpdateBody, GalleryListResult, GalleryPublicConfig, GalleryQuery,
    GalleryRemoveResponse, GallerySettings, GallerySettingsBody, GallerySyncBody, GallerySyncResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /gallery — published media (feature `gallery`; 404s when it is off).
 *
 * Public reads are gated per viewer: the gallery's access rule and each
 * item's own visibility. `list()` takes the shared GalleryQuery (type, tag,
 * search, ids, sort, limit, page) — the same query `{{gallery(...)}}` and the
 * Gallery content block use.
 */
export class GalleryModule extends ModuleBase {
    protected readonly module = 'gallery';

    /** GET /gallery/config — title, route, appearance, and whether THIS viewer may open the gallery. */
    config(): Promise<GalleryPublicConfig> {
        return this.get('/gallery/config', { options: { cache: false, }, },);
    }

    /** GET /gallery — items visible to the viewer. `ids` keeps the given order; `collectionId` = a collection or `root`. */
    list(query: GalleryQuery = {},): Promise<GalleryListResult> {
        const { ids, ...rest } = query;
        return this.get('/gallery', { query: { ...rest, ids: ids?.length ? ids.join(',',) : undefined, }, options: { cache: false, }, },);
    }

    /** GET /gallery/items/:id — one item (404 when hidden from the viewer or its media is gone). */
    item(id: string,): Promise<GalleryItem> {
        return this.get('/gallery/items/:id', { params: { id, }, options: { cache: false, }, },);
    }

    /** GET /gallery/collections — collections visible to the viewer; `itemCount` = items THIS viewer can see. */
    collections(): Promise<GalleryCollection[]> {
        return this.get('/gallery/collections', { options: { cache: false, }, },);
    }

    /** GET /gallery/collections/:id — one collection (404 when missing or the viewer fails its access rule). */
    collection(id: string,): Promise<GalleryCollection> {
        return this.get('/gallery/collections/:id', { params: { id, }, options: { cache: false, }, },);
    }

    /** GET /gallery/admin/collections (staff) — every collection, counts of ALL items. */
    adminCollections(): Promise<GalleryCollection[]> {
        return this.get('/gallery/admin/collections', { options: { cache: false, }, },);
    }

    /** POST /gallery/admin/collections (staff) — `name` defaults to "Untitled"; placed first unless `sortOrder` is given. */
    createCollection(body: GalleryCollectionInput = {},): Promise<GalleryCollection> {
        return this.mutate('POST', '/gallery/admin/collections', { body, invalidates: ['gallery',], },);
    }

    /** PATCH /gallery/admin/collections/:id (staff). */
    updateCollection(id: string, body: GalleryCollectionInput,): Promise<GalleryCollection> {
        return this.mutate('PATCH', '/gallery/admin/collections/:id', { params: { id, }, body, invalidates: ['gallery',], },);
    }

    /**
     * DELETE /gallery/admin/collections/:id (staff) — `items`: `delete` (media too with `deleteMedia`, needs `media:write`),
     * `root` (move to the gallery root) or `move` (into `targetId`).
     */
    deleteCollection(id: string, body: GalleryCollectionDeleteBody,): Promise<GalleryCollectionDeleteResponse> {
        return this.mutate('DELETE', '/gallery/admin/collections/:id', { params: { id, }, body, invalidates: ['gallery',], },);
    }

    /** POST /gallery/admin/items/move (staff) — into a collection; `collectionId: null` = the gallery root. */
    moveItems(body: GalleryMoveItemsBody,): Promise<GalleryMoveItemsResponse> {
        return this.mutate('POST', '/gallery/admin/items/move', { body, invalidates: ['gallery',], },);
    }

    /** Staff (`gallery:manage`). */
    readonly admin = {
        /** Every item in gallery order, incl. ones whose media was deleted (`media: null`). */
        items: (): Promise<GalleryAdminItemsResponse> => this.get('/gallery/admin/items', { options: { cache: false, }, },),
        /** Publish the draft: ordered items to keep (existing `id` / new `mediaId`) + removals (`deleteMedia` also deletes the media). */
        publish: (body: GallerySyncBody,): Promise<GallerySyncResponse> =>
            this.mutate('PUT', '/gallery/admin/items', { body, invalidates: ['gallery',], },),
        update: (id: string, body: GalleryItemUpdateBody,): Promise<GalleryItem> =>
            this.mutate('PATCH', '/gallery/admin/items/:id', { params: { id, }, body, invalidates: ['gallery',], },),
        /** Remove an item; `deleteMedia: true` also deletes its media from the library. */
        remove: (id: string, opts: { deleteMedia?: boolean; } = {},): Promise<GalleryRemoveResponse> =>
            this.mutate('DELETE', '/gallery/admin/items/:id', {
                params: { id, }, query: opts.deleteMedia ? { deleteMedia: 'true', } : undefined, invalidates: ['gallery',],
            },),
        /** Which of these media are already in the gallery: media id → item id. */
        mediaLinks: (mediaIds: string[],): Promise<Record<string, string>> =>
            mediaIds.length
                ? this.get('/gallery/admin/media-links', { query: { ids: mediaIds.join(',',), }, options: { cache: false, }, },)
                : Promise.resolve({},),
    };

    /** GET /gallery/settings (staff). */
    settings(): Promise<GallerySettings> {
        return this.get('/gallery/settings', { options: { cache: false, }, },);
    }

    /** PUT /gallery/settings (admin, `gallery.settings:manage`). */
    updateSettings(body: GallerySettingsBody,): Promise<GallerySettings> {
        return this.mutate('PUT', '/gallery/settings', { body, invalidates: ['gallery',], },);
    }
}
