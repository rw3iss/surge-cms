/** Gallery collections: delete modes (one transaction), move, create placement, viewer-shaped SELECT. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const I1 = '33333333-3333-4333-8333-333333333333';
const I2 = '44444444-4444-4444-8444-444444444444';
const M1 = '55555555-5555-4555-8555-555555555555';

const calls: { sql: string; params: unknown[]; tx: boolean; }[] = [];
let existing: string[] = [];
let deletedItems: { id: string; media_id: string | null; }[] = [];
const mediaRemoved: string[] = [];

function answer(sql: string, params: unknown[],) {
    if (sql.includes('FROM gallery_collections WHERE id = ANY',)) {
        return { rows: (params[0] as string[]).filter((x,) => existing.includes(x,),).map((id,) => ({ id, })), };
    }
    if (sql.includes('SELECT id FROM gallery_collections WHERE id = $1 FOR UPDATE',)) {
        return { rows: existing.includes(params[0] as string,) ? [{ id: params[0], },] : [], };
    }
    if (sql.startsWith('DELETE FROM gallery_items WHERE collection_id',)) return { rows: deletedItems, rowCount: deletedItems.length, };
    if (sql.startsWith('UPDATE gallery_items',)) return { rows: [], rowCount: 2, };
    if (sql.startsWith('UPDATE gallery_collections',)) return { rows: [], rowCount: 1, };
    if (sql.includes('INSERT INTO gallery_collections',)) return { rows: [{ id: C1, },], };
    if (sql.startsWith('SELECT gc.*',)) {
        return { rows: [{ id: C1, name: 'Untitled', description: '', sort_order: -1, access_enabled: false, access_roles: [], access_tier_ids: [], created_at: new Date(), updated_at: new Date(), item_count: 0, cover: null, },], };
    }
    return { rows: [], rowCount: 0, };
}

vi.mock('../../db', () => ({
    query: async (sql: string, params: unknown[] = [],) => {
        calls.push({ sql: sql.trim(), params, tx: false, },);
        return answer(sql.trim(), params,);
    },
    transaction: async (fn: (c: unknown,) => Promise<unknown>,) => fn({
        query: async (sql: string, params: unknown[] = [],) => {
            calls.push({ sql: sql.trim(), params, tx: true, },);
            return answer(sql.trim(), params,);
        },
    },),
}),);
vi.mock('../settings', () => ({ get: async () => ({}), set: async () => undefined, }),);
vi.mock('../cache', () => ({
    cache: { get: async () => null, set: async () => undefined, invalidateGalleryCache: async () => undefined, invalidateSitemapCache: async () => undefined, },
    CACHE_KEYS: { galleryList: (h: string,) => `gallery:list:${h}`, galleryCollections: 'gallery:collections', galleryCollectionsListing: 'gallery:collections:listing', },
}),);
vi.mock('../audit', () => ({ logAudit: async () => undefined, }),);
vi.mock('../media.js', () => ({ remove: async (id: string,) => { mediaRemoved.push(id,); }, }),);
let mediaInUse: string[] = [];
vi.mock('../mediaUsage.js', () => ({
    findMediaUsage: async (ids: string[],) => Object.fromEntries(ids.map((id,) => [
        id, mediaInUse.includes(id,) ? [{ kind: 'post', id: 'p1', label: 'Post', adminUrl: null, field: 'Featured image', },] : [],
    ],),),
}),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), }, }),);
vi.mock('../postGate', () => ({ viewerRank: async () => null, tiersById: async () => new Map(), }),);
vi.mock('../subscriptionAccess', () => ({ getPolicy: async () => ({ required: false, }), }),);
vi.mock('../permissions', () => ({ ENTITLED_STATUSES: ['active',], extraRoles: async () => ['ambassador',], }),);

const col = await import('./collections');
const CTX = { userId: undefined as never, ipAddress: '', userAgent: '', };

beforeEach(() => {
    calls.length = 0;
    existing = [C1, C2,];
    deletedItems = [];
    mediaRemoved.length = 0;
    mediaInUse = [];
},);

const txSql = () => calls.filter((c,) => c.tx,).map((c,) => c.sql,);

describe('deleteCollection', () => {
    it('delete: removes the items + their threads, then the collection, in one transaction; media only when asked', async () => {
        deletedItems = [{ id: I1, media_id: M1, }, { id: I2, media_id: null, },];
        const r = await col.deleteCollection(C1, { items: 'delete', deleteMedia: true, }, CTX,);
        const tx = txSql();
        expect(tx.some((s,) => s.startsWith('DELETE FROM gallery_items WHERE collection_id',),),).toBe(true,);
        expect(tx.some((s,) => s.includes('DELETE FROM comment_threads',),),).toBe(true,);
        expect(tx[tx.length - 1],).toContain('DELETE FROM gallery_collections',);
        expect(r,).toEqual({ deleted: true, items: 2, mediaDeleted: 1, mediaKept: 0, },);
        expect(mediaRemoved,).toEqual([M1,],);
    },);

    it('delete + deleteMedia keeps media still used elsewhere, unless forceMedia', async () => {
        deletedItems = [{ id: I1, media_id: M1, },];
        mediaInUse = [M1,];
        const kept = await col.deleteCollection(C1, { items: 'delete', deleteMedia: true, }, CTX,);
        expect(kept,).toMatchObject({ mediaDeleted: 0, mediaKept: 1, },);
        expect(mediaRemoved,).toEqual([],);
        existing = [C1, C2,];
        const forced = await col.deleteCollection(C1, { items: 'delete', deleteMedia: true, forceMedia: true, }, CTX,);
        expect(forced,).toMatchObject({ mediaDeleted: 1, mediaKept: 0, },);
        expect(mediaRemoved,).toEqual([M1,],);
    },);

    it('delete without deleteMedia keeps the media', async () => {
        deletedItems = [{ id: I1, media_id: M1, },];
        const r = await col.deleteCollection(C1, { items: 'delete', }, CTX,);
        expect(r.mediaDeleted,).toBe(0,);
        expect(mediaRemoved,).toEqual([],);
    },);

    it('root: items move to the gallery root', async () => {
        const r = await col.deleteCollection(C1, { items: 'root', }, CTX,);
        expect(txSql().some((s,) => s.includes('SET collection_id = NULL',),),).toBe(true,);
        expect(txSql().some((s,) => s.startsWith('DELETE FROM gallery_items',),),).toBe(false,);
        expect(r.items,).toBe(2,);
    },);

    it('move: into the target', async () => {
        await col.deleteCollection(C1, { items: 'move', targetId: C2, }, CTX,);
        const u = calls.find((c,) => c.sql.startsWith('UPDATE gallery_items SET collection_id = $2',),)!;
        expect(u.params,).toEqual([C1, C2,],);
    },);

    it('move: refuses a missing target, the same collection, or no target', async () => {
        await expect(col.deleteCollection(C1, { items: 'move', targetId: C1, }, CTX,),).rejects.toThrow(/different collection/,);
        await expect(col.deleteCollection(C1, { items: 'move', }, CTX,),).rejects.toThrow(/Choose the collection/,);
        existing = [C1,];
        await expect(col.deleteCollection(C1, { items: 'move', targetId: C2, }, CTX,),).rejects.toThrow(/no longer exists/,);
        expect(calls.some((c,) => c.sql.startsWith('DELETE FROM gallery_collections',),),).toBe(false,);
    },);

    it('404 when the collection is missing', async () => {
        existing = [];
        await expect(col.deleteCollection(C1, { items: 'root', }, CTX,),).rejects.toThrow(/not found/i,);
    },);
},);

describe('moveItems', () => {
    it('moves into a collection, skipping items already there', async () => {
        const r = await col.moveItems({ ids: [I1, I2, 'nope',], collectionId: C1, }, CTX,);
        const u = calls.find((c,) => c.sql.startsWith('UPDATE gallery_items',),)!;
        expect(u.sql,).toContain('IS DISTINCT FROM',);
        expect(u.params,).toEqual([[I1, I2,], C1,],);
        expect(r.moved,).toBe(2,);
    },);

    it('null = the root (no collection check)', async () => {
        existing = [];
        await col.moveItems({ ids: [I1,], collectionId: null, }, CTX,);
        expect(calls.find((c,) => c.sql.startsWith('UPDATE gallery_items',),)!.params,).toEqual([[I1,], null,],);
    },);

    it('refuses an unknown collection', async () => {
        existing = [];
        await expect(col.moveItems({ ids: [I1,], collectionId: C1, }, CTX,),).rejects.toThrow(/no longer exists/,);
    },);
},);

describe('createCollection', () => {
    it('defaults to "Untitled", placed before every other collection', async () => {
        await col.createCollection({}, CTX,);
        const ins = calls.find((c,) => c.sql.includes('INSERT INTO gallery_collections',),)!;
        expect(ins.params[0],).toBe('Untitled',);
        expect(ins.sql,).toContain('MIN(sort_order), 0) - 1',);
        expect((await col.adminCollections())[0].url,).toBe(`/gallery/collection/${C1}`,);
    },);
},);

describe('listCollections (site)', () => {
    it('gates collections + counts by the viewer, binding their roles', async () => {
        await col.listCollections({ id: I1, role: 'member', },);
        const sel = calls.find((c,) => c.sql.startsWith('SELECT gc.*',),)!;
        expect(sel.sql,).toContain('NOT (gc.access_enabled',);
        expect(sel.sql,).toContain('gi.collection_id = gc.id',);
        expect(sel.sql,).toContain('CASE WHEN (gi.access_enabled',);
        expect(sel.params,).toContainEqual(['member', 'ambassador',],);
    },);

    it('listing (gallery pages) leaves out hidden collections; the default list and one collection keep them', async () => {
        const sel = () => calls.find((c,) => c.sql.startsWith('SELECT gc.*',),)!.sql;
        await col.listCollections(null, undefined, { listing: true, },);
        expect(sel(),).toContain('gc.hidden_in_gallery = false',);
        calls.length = 0;
        await col.listCollections(null,);
        expect(sel(),).not.toContain('gc.hidden_in_gallery',);
        calls.length = 0;
        await col.getCollection(C1, null,);
        expect(sel(),).not.toContain('gc.hidden_in_gallery',);
        // Counts / covers follow the collection page's grid (no hidden items).
        expect(sel(),).toContain('gi.hidden_in_gallery = false',);
    },);

    it('update sets hiddenInGallery only when given', async () => {
        await col.updateCollection(C1, { hiddenInGallery: true, }, CTX,);
        const up = calls.find((c,) => c.sql.startsWith('UPDATE gallery_collections',),)!;
        expect(up.sql,).toContain('hidden_in_gallery = $2',);
        expect(up.params,).toEqual([C1, true,],);
        calls.length = 0;
        await col.updateCollection(C1, { name: 'x', }, CTX,);
        expect(calls.find((c,) => c.sql.startsWith('UPDATE gallery_collections',),)!.sql,).not.toContain('hidden_in_gallery',);
    },);

    it('admin: no gates', async () => {
        await col.adminCollections();
        const sel = calls.find((c,) => c.sql.startsWith('SELECT gc.*',),)!;
        expect(sel.sql,).not.toContain('access_enabled',);
    },);
},);
