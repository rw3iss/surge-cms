import { beforeEach, describe, expect, it, vi, } from 'vitest';

const m = vi.hoisted(() => ({
    query: vi.fn(),
    store: { delete: vi.fn(), deleteThumbnail: vi.fn(), },
    deleteVideoAssets: vi.fn(),
    cache: { invalidateGalleryCache: vi.fn(), invalidateSitemapCache: vi.fn(), invalidateMediaConsumersCache: vi.fn(), },
    logAudit: vi.fn(),
}),);

vi.mock('../db', () => ({ query: m.query, transaction: vi.fn(), }),);
vi.mock('./storage', () => ({ resolveStorageProvider: () => Promise.resolve(m.store,), isObjectStore: () => true, }),);
vi.mock('./video/manage', () => ({ deleteVideoAssets: m.deleteVideoAssets, }),);
vi.mock('./cache', () => ({ cache: m.cache, }),);
vi.mock('./audit', () => ({ logAudit: m.logAudit, }),);
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), }, }),);

import { discard, } from './media';

const ctx = { userId: 'u1', };

function routeQueries(opts: { gallery?: { id: string; }[] | Error; mime?: string; },) {
    m.query.mockImplementation((sql: string,) => {
        if (sql.includes('DELETE FROM gallery_items')) {
            return opts.gallery instanceof Error ? Promise.reject(opts.gallery,) : Promise.resolve({ rows: opts.gallery ?? [], },);
        }
        if (sql.includes('SELECT mime_type')) return Promise.resolve({ rows: [{ mime_type: opts.mime ?? 'video/mp4', },], },);
        if (sql.includes('DELETE FROM media')) return Promise.resolve({ rows: [{ filename: 'f.mp4', thumbnail_url: null, },], },);
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
        expect(sqls.some((s,) => s.includes('comment_threads',)),).toBe(true,);
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
