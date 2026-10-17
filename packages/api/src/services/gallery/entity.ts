/**
 * `gallery_item` as a read-only ENTITY TYPE, so the generic entity tooling
 * works on it: the Gallery block's item picker / query builder (the same
 * EntitySearchSelectModal as entity blocks), entity blocks + carousel entity
 * items with a template (`{{gallery_item.media.url}}`), and the Entities Data
 * tab. Records are GalleryItem objects (anonymous view on public reads).
 *
 * Query knobs are virtual filters resolved here: `type` (image | video),
 * `tag`, `collection` (a collection id, or `root` = items in no collection), `sort` (order | newest | oldest | title | random).
 */
import type { EntityFieldOption, EntityQuery, EntityRecord, GalleryQuery, } from '@sitesurge/types';
import { ForbiddenError, } from '../../core/errors';
import { query as dbQuery, } from '../../db';
import { registerEntityDataProvider, } from '../../entities/dataProviders';
import { registerVirtualFilter, type SqlCondition, } from '../../entities/virtualFilters';
import { get, list, } from './items';

function filterValue(f: EntityQuery['filter'], key: string,): string | undefined {
    const raw = f?.[key] as unknown;
    const v = raw !== null && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value: unknown; }).value : raw;
    if (v === undefined || v === null) return undefined;
    const s = Array.isArray(v,) ? v.map(String,).join(',',) : String(v,);
    return s.trim() || undefined;
}

/** EntityQuery → GalleryQuery. */
export function toGalleryQuery(q: EntityQuery = {},): GalleryQuery {
    // The shared select modal sends `sortBy` + `sortOrder` (or `sortOrder` alone,
    // meaning "by date"). Every field it offers maps here WITH its direction —
    // only createdAt used to, so the direction toggle looked dead for gallery items.
    const desc = q.sortOrder === 'desc';
    const by = q.sortBy || (q.sortOrder ? 'createdAt' : '');
    const sortBy: GalleryQuery['sort'] | undefined = by === 'createdAt' || by === 'publishedAt' || by === 'updatedAt'
        ? (desc ? 'newest' : 'oldest')
        : by === 'title' ? 'title'
        : by === 'sortOrder' ? 'order'
        : undefined;
    return {
        type: (filterValue(q.filter, 'type',) as GalleryQuery['type']) ?? 'all',
        tag: filterValue(q.filter, 'tag',),
        collectionId: filterValue(q.filter, 'collection',),
        sort: (filterValue(q.filter, 'sort',) as GalleryQuery['sort']) ?? sortBy ?? 'order',
        search: q.search,
        ...(sortBy === 'title' || sortBy === 'order' ? { dir: desc ? 'desc' as const : 'asc' as const, } : {}),
        page: q.page,
        limit: q.limit,
    };
}

const asRecord = (i: object,): EntityRecord => ({ ...(i as Record<string, unknown>), } as EntityRecord);
const readOnly = async (): Promise<never> => {
    throw new ForbiddenError('Gallery items are managed on the Gallery page.',);
};

registerEntityDataProvider('gallery_item', {
    async list(q: EntityQuery, opts: { admin?: boolean; },) {
        const r = await list(toGalleryQuery(q,), opts.admin ? { audience: 'admin', } : {},);
        return { items: r.items.map(asRecord,), total: r.total, };
    },
    async getById(id: string,) {
        const i = await get(id,);
        return i ? asRecord(i,) : null;
    },
    async getBySlug() {
        return null;
    },
    create: readOnly,
    update: readOnly,
    remove: readOnly,
},);

const handledByProvider = async (): Promise<SqlCondition> => () => 'TRUE';
const opts = (values: [string, string,][],): EntityFieldOption[] => values.map(([value, label,],) => ({ value, label, }));

registerVirtualFilter('gallery_item', {
    key: 'type', label: 'Media type', description: 'image or video.',
    options: async () => opts([['image', 'Image',], ['video', 'Video',],],),
    resolve: handledByProvider,
},);
registerVirtualFilter('gallery_item', {
    key: 'tag', label: 'Tag', description: 'Items carrying this tag (comma list = any of).',
    options: async () => {
        const r = await dbQuery<{ t: string; }>(`SELECT DISTINCT unnest(tags) AS t FROM gallery_items ORDER BY 1 LIMIT 200`,).catch(() => ({ rows: [], }));
        return r.rows.map((x,) => ({ value: x.t, label: x.t, }));
    },
    resolve: handledByProvider,
},);
registerVirtualFilter('gallery_item', {
    key: 'sort', label: 'Sort', description: 'order = gallery order · newest · oldest · title · random.',
    options: async () => opts([['order', 'Gallery order',], ['newest', 'Newest',], ['oldest', 'Oldest',], ['title', 'Title',], ['random', 'Random',],],),
    resolve: handledByProvider,
},);
registerVirtualFilter('gallery_item', {
    key: 'collection', label: 'Collection', description: 'Items in this collection (root = items in no collection).',
    options: async () => {
        const r = await dbQuery<{ id: string; name: string; }>(`SELECT id, name FROM gallery_collections ORDER BY sort_order, lower(name) LIMIT 200`,)
            .catch(() => ({ rows: [], }));
        return [{ value: 'root', label: 'Gallery root (no collection)', }, ...r.rows.map((x,) => ({ value: x.id, label: x.name, })),];
    },
    resolve: handledByProvider,
},);
