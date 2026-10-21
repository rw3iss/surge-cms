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

/** A filter's operator (`eq` for a bare value). */
export function galleryFilterOp(f: Record<string, unknown> | undefined, key: string,): string {
    const raw = f?.[key];
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw,) && 'op' in (raw as object)
        ? String((raw as { op: unknown; }).op,)
        : 'eq';
}

const SORTS = ['order', 'newest', 'oldest', 'title', 'random',] as const;

/** `true`/`1`/`yes` → true, `false`/`0`/`no` → false, else undefined. */
export function galleryBoolOf(v: unknown,): boolean | undefined {
    if (v === true || v === false) return v;
    return boolOf(v === undefined || v === null ? undefined : String(v,),);
}

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
    // `type != video` = images (the only other type); `featured != true` = not featured.
    // A negated tag / collection cannot be expressed, so it is dropped (wider, never the opposite).
    const neg = (key: string,) => galleryFilterOp(f, key,) === 'ne';
    const rawType = galleryFilterValue(f, 'type',);
    const type = rawType === 'image' || rawType === 'video' ? (neg('type',) ? (rawType === 'image' ? 'video' : 'image') : rawType) : undefined;
    const out: GalleryQuery = { type: type ?? 'all', sort: sort ?? 'order', };
    // A direction applies to title / gallery order (newest / oldest carry their own).
    if ((out.sort === 'title' || out.sort === 'order') && (sortFromBy === 'title' || sortFromBy === 'order')) out.dir = desc ? 'desc' : 'asc';
    const tag = neg('tag',) ? undefined : galleryFilterValue(f, 'tag',);
    if (tag) out.tag = tag;
    const collKey = galleryFilterValue(f, 'collection',) !== undefined ? 'collection' : 'collectionId';
    const collection = neg(collKey,) ? undefined : galleryFilterValue(f, collKey,);
    if (collection) out.collectionId = collection;
    const featKey = galleryFilterValue(f, 'featured',) !== undefined ? 'featured' : 'isFeatured';
    const featured = boolOf(galleryFilterValue(f, featKey,),);
    if (featured !== undefined) out.featured = neg(featKey,) ? !featured : featured;
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
