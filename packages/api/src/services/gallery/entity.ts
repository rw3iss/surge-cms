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
import { entityQueryToGalleryQuery, } from '@sitesurge/types';
import type { EntityFieldOption, EntityQuery, EntityRecord, GalleryQuery, } from '@sitesurge/types';
import { ForbiddenError, } from '../../core/errors';
import { query as dbQuery, } from '../../db';
import { registerEntityDataProvider, } from '../../entities/dataProviders';
import { registerVirtualFilter, type SqlCondition, } from '../../entities/virtualFilters';
import { get, list, } from './items';


/** EntityQuery → GalleryQuery — the ONE shared mapping (also used by the Gallery block editor). */
export function toGalleryQuery(q: EntityQuery = {},): GalleryQuery {
    return entityQueryToGalleryQuery(q as never, q.limit,);
}

const asRecord = (i: object,): EntityRecord => ({ ...(i as Record<string, unknown>), } as EntityRecord);
const readOnly = async (): Promise<never> => {
    throw new ForbiddenError('Gallery items are managed on the Gallery page.',);
};

registerEntityDataProvider('gallery_item', {
    async list(q: EntityQuery, opts: { admin?: boolean; audience?: 'email'; },) {
        // `email` = public MEDIA only, in-site gate ignored — the same rule an
        // items-fed email gallery uses, so a query-fed slot matches it.
        const audience = opts.admin ? { audience: 'admin' as const, } : opts.audience === 'email' ? { audience: 'email' as const, } : {};
        const r = await list(toGalleryQuery(q,), audience,);
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
    key: 'featured', label: 'Featured', description: 'true = only featured items · false = only items not featured.',
    options: async () => opts([['true', 'Featured',], ['false', 'Not featured',],],),
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
