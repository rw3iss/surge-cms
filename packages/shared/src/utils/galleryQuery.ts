/**
 * The ONE mapping between the Set data… modal's EntityQuery (entity type
 * `gallery_item`) and a GalleryQuery — used by the server's gallery entity
 * provider (what the modal previews) AND the Gallery block editor (what the
 * block saves), so the preview and the saved live query can never disagree.
 * (Before, each side had its own copy and the block's dropped `featured`,
 * `collection` and the sort direction.)
 *
 * Filters (virtual or field): `type` image|video · `tag` (comma = any of) ·
 * `collection` (an id, or `root`) · `featured` / `isFeatured` (true|false) ·
 * `sort` order|newest|oldest|title|random. The modal's own sort (`sortBy` +
 * `sortOrder`) maps too: createdAt / publishedAt / updatedAt → newest|oldest,
 * title / sortOrder → title|order with `dir`.
 */
import type { GalleryQuery, } from '../types/gallery';

export interface GalleryEntityQueryLike {
    search?: string;
    filter?: Record<string, unknown>;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
    page?: number;
}

/** A filter's value whether given bare or as a `{ op, value }` clause; arrays → comma list. */
export function galleryFilterValue(f: Record<string, unknown> | undefined, key: string,): string | undefined {
    const raw = f?.[key];
    const v = raw !== null && typeof raw === 'object' && !Array.isArray(raw,) && 'value' in (raw as object)
        ? (raw as { value: unknown; }).value
        : raw;
    if (v === undefined || v === null) return undefined;
    const s = Array.isArray(v,) ? v.map(String,).join(',',) : String(v,);
    return s.trim() || undefined;
}

const SORTS = ['order', 'newest', 'oldest', 'title', 'random',] as const;

function boolOf(v: string | undefined,): boolean | undefined {
    const s = (v ?? '').toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return undefined;
}

/** Set data… EntityQuery → GalleryQuery (`limit` overrides the query's own). */
export function entityQueryToGalleryQuery(q: GalleryEntityQueryLike | null | undefined, limit?: number,): GalleryQuery {
    const f = q?.filter;
    const desc = q?.sortOrder === 'desc';
    const by = q?.sortBy || (q?.sortOrder ? 'createdAt' : '');
    const sortFromBy: GalleryQuery['sort'] | undefined = by === 'createdAt' || by === 'publishedAt' || by === 'updatedAt'
        ? (desc ? 'newest' : 'oldest')
        : by === 'title' ? 'title'
        : by === 'sortOrder' ? 'order'
        : undefined;
    const sortVal = galleryFilterValue(f, 'sort',);
    const sort = (SORTS as readonly string[]).includes(sortVal ?? '',) ? sortVal as GalleryQuery['sort'] : sortFromBy;
    const type = galleryFilterValue(f, 'type',);
    const out: GalleryQuery = { type: type === 'image' || type === 'video' ? type : 'all', sort: sort ?? 'order', };
    // A direction applies to title / gallery order (newest / oldest carry their own).
    if ((out.sort === 'title' || out.sort === 'order') && (sortFromBy === 'title' || sortFromBy === 'order')) out.dir = desc ? 'desc' : 'asc';
    const tag = galleryFilterValue(f, 'tag',);
    if (tag) out.tag = tag;
    const collection = galleryFilterValue(f, 'collection',) ?? galleryFilterValue(f, 'collectionId',);
    if (collection) out.collectionId = collection;
    const featured = boolOf(galleryFilterValue(f, 'featured',) ?? galleryFilterValue(f, 'isFeatured',),);
    if (featured !== undefined) out.featured = featured;
    if (q?.search?.trim()) out.search = q.search.trim();
    const lim = limit ?? q?.limit;
    if (lim && lim > 0) out.limit = Math.min(200, Math.round(lim,),);
    if (q?.page && q.page > 1) out.page = q.page;
    return out;
}

/** GalleryQuery → the EntityQuery the Set data… modal re-opens with (every filter it can express). */
export function galleryQueryToEntityQuery(q: GalleryQuery | undefined,): GalleryEntityQueryLike {
    const filter: Record<string, unknown> = {};
    if (q?.type && q.type !== 'all') filter.type = q.type;
    if (q?.tag) filter.tag = q.tag;
    if (q?.collectionId) filter.collection = q.collectionId;
    if (q?.featured !== undefined) filter.featured = q.featured;
    if (q?.sort && q.sort !== 'order') filter.sort = q.sort;
    const out: GalleryEntityQueryLike = { filter: Object.keys(filter,).length ? filter : undefined, limit: q?.limit, };
    if (q?.search) out.search = q.search;
    if (q?.dir === 'desc' && (q.sort === 'title' || q.sort === 'order' || !q.sort)) {
        out.sortBy = q.sort === 'title' ? 'title' : 'sortOrder';
        out.sortOrder = 'desc';
    }
    return out;
}
