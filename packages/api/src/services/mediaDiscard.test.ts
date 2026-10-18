import { beforeEach, describe, expect, it, vi, } from 'vitest';

const m = vi.hoisted(() => ({
    query: vi.fn(),
    store: { delete: vi.fn(), deleteThumbnail: vi.fn(), },
    deleteVideoAssets: vi.fn(),
    cache: { invalidateGalleryCache: vi.fn(), invalidateSitemapCache: vi.fn(), invalidateMediaConsumersCache: vi.fn(), },
    logAudit: vi.fn(),
}),);

vi.mock('../db', () => ({ query: m.query, transaction: (fn: (c: unknown,) => unknown,) => fn({ query: m.query, },), }),);
// The shared remover (rows + comments + threads) is tested in gallery/items.test.ts.
vi.mock('./gallery/items', () => ({
    removeGalleryItems: async (client: { query: (s: string, p: unknown[],) => Promise<{ rows: { id: string; }[]; }>; }, sel: { mediaId: string; },) => {
        const r = await client.query(`DELETE FROM gallery_items WHERE media_id = $1 RETURNING id, media_id`, [sel.mediaId,],);
        return { ids: r.rows.map((x,) => x.id), mediaIds: [], rows: [], };
    },
}),);
vi.mock('./storage', () => ({ resolveStorageProvider: () => Promise.resolve(m.store,), isObjectStore: () => true, }),);
vi.mock('./video/manage', () => ({ deleteVideoAssets: m.deleteVideoAssets, }),);
vi.mock('./cache', () => ({ cache: m.cache, }),);
vi.mock('./audit', () => ({ logAudit: m.logAudit, }),);
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), }, }),);

import { discard, remove, } from './media';

const ctx = { userId: 'u1', };

function routeQueries(opts: { gallery?: { id: string; }[] | Error; mime?: string; thumb?: string | null; },) {
    m.query.mockImplementation((sql: string,) => {
        if (sql.includes('DELETE FROM gallery_items')) {
            return opts.gallery instanceof Error ? Promise.reject(opts.gallery,) : Promise.resolve({ rows: opts.gallery ?? [], },);
        }
        if (sql.includes('SELECT mime_type')) return Promise.resolve({ rows: [{ mime_type: opts.mime ?? 'video/mp4', },], },);
        if (sql.includes('DELETE FROM media')) return Promise.resolve({ rows: [{ filename: 'f.mp4', thumbnail_url: opts.thumb ?? null, },], },);
        return Promise.resolve({ rows: [], },);
    },);
}

beforeEach(() => {
    m.query.mockReset();
    m.deleteVideoAssets.mockReset();
    for (const f of [...Object.values(m.store,), ...Object.values(m.cache,),]) f.mockReset();
},);

describe('media.discard (cancel an upload / encode)', () => {
    it('removes gallery items made from it, stops + purges the video, deletes the row', async () => {
        routeQueries({ gallery: [{ id: 'g1', },], },);
        const r = await discard('m1', ctx,);
        expect(r,).toEqual({ discarded: true, galleryItemsRemoved: 1, },);
        expect(m.deleteVideoAssets,).toHaveBeenCalledWith('m1',);
        const sqls = m.query.mock.calls.map((c,) => c[0] as string);
        expect(sqls.some((s,) => s.includes('DELETE FROM media WHERE id',)),).toBe(true,);
        expect(m.cache.invalidateGalleryCache,).toHaveBeenCalled();
        expect(m.store.delete,).toHaveBeenCalledWith('f.mp4',);
    },);

    it('works when the gallery feature was never installed', async () => {
        routeQueries({ gallery: Object.assign(new Error('relation does not exist',), { code: '42P01', },), mime: 'image/png', },);
        const r = await discard('m1', ctx,);
        expect(r.galleryItemsRemoved,).toBe(0,);
        expect(m.deleteVideoAssets,).not.toHaveBeenCalled();
    },);
},);

describe('media.remove', () => {
    it('C1: passes the row thumbnail_url so a rebuilt (v3) thumbnail is deleted', async () => {
        routeQueries({ mime: 'image/png', thumb: 'https://cdn.test/uploads/thumb_v3_f.png', },);
        await remove('m1', ctx,);
        expect(m.store.deleteThumbnail,).toHaveBeenCalledWith('f.mp4', 'https://cdn.test/uploads/thumb_v3_f.png',);
    },);

    it('C2: a storage failure after the row delete still audits + invalidates, and does not throw', async () => {
        routeQueries({ mime: 'image/png', thumb: 'x', },);
        m.store.delete.mockRejectedValue(new Error('R2 down',),);
        m.logAudit.mockReset();
        await expect(remove('m1', ctx,),).resolves.toBeUndefined();
        expect(m.logAudit,).toHaveBeenCalled();
        expect(m.cache.invalidateMediaConsumersCache,).toHaveBeenCalled();
    },);
},);
