/**
 * Gallery items: query normalisation, the per-audience WHERE (site gate /
 * email = public media only / admin = everything), and publish validation.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const M1 = '11111111-1111-4111-8111-111111111111';
const calls: { sql: string; params: unknown[]; }[] = [];
let mediaRows: { id: string; mime_type: string; }[] = [];
let settings: Record<string, unknown> = {};

vi.mock('../../db', () => ({
    query: async (sql: string, params: unknown[] = [],) => {
        calls.push({ sql, params, },);
        if (sql.includes('FROM media WHERE id = ANY',)) return { rows: mediaRows, };
        if (sql.includes('COUNT(*)',)) return { rows: [{ n: 0, },], };
        return { rows: [], rowCount: 0, };
    },
    transaction: async (fn: (c: unknown,) => Promise<unknown>,) => fn({ query: async () => ({ rows: [], rowCount: 0, }), },),
}),);
vi.mock('../settings', () => ({ get: async () => settings, set: async () => undefined, }),);
vi.mock('../cache', () => ({ cache: { get: async () => null, set: async () => undefined, invalidateGalleryCache: async () => undefined, }, CACHE_KEYS: { galleryList: (h: string,) => `gallery:list:${h}`, }, }),);
vi.mock('../audit', () => ({ logAudit: async () => undefined, }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), }, }),);
vi.mock('../postGate', () => ({ viewerRank: async () => null, tiersById: async () => new Map(), }),);
vi.mock('../subscriptionAccess', () => ({ getPolicy: async () => ({ required: false, }), }),);

const items = await import('./items');
const CTX = { userId: undefined as never, ipAddress: '', userAgent: '', };

beforeEach(() => {
    calls.length = 0;
    mediaRows = [];
    settings = {};
},);

describe('normalizeQuery', () => {
    it('parses comma ids, clamps limit/page, defaults sort/type', () => {
        const q = items.normalizeQuery({ ids: `${ID}, nope`, limit: 999, page: 0, sort: 'bogus' as never, },);
        expect(q,).toMatchObject({ ids: [ID,], limit: 200, page: 1, sort: 'order', type: 'all', },);
    },);
},);

describe('list WHERE by audience', () => {
    const listSql = () => calls.find((c,) => c.sql.includes('FROM gallery_items gi',) && !c.sql.includes('COUNT',),)!.sql;

    it('site: ready media + the level gate', async () => {
        await items.list({}, { viewer: null, },);
        expect(listSql(),).toContain(`m.status = 'ready'`,);
        expect(listSql(),).toMatch(/CASE gi.visibility .* <= \$\d/s,);
        expect(listSql(),).not.toContain(`m.access_level = 'public'`,);
    },);

    it('email: public media only, no level gate', async () => {
        await items.list({}, { audience: 'email', },);
        expect(listSql(),).toContain(`m.access_level = 'public'`,);
        expect(listSql(),).not.toContain('CASE gi.visibility',);
    },);

    it('admin: everything, incl. missing media', async () => {
        await items.list({}, { audience: 'admin', },);
        expect(listSql(),).not.toContain(`m.status = 'ready'`,);
    },);

    it('videos off: excluded from public reads', async () => {
        settings = { allowVideos: false, };
        await items.list({}, {},);
        expect(listSql(),).toContain(`m.mime_type NOT LIKE 'video/%'`,);
    },);

    it('ids keep their given order', async () => {
        await items.list({ ids: [ID,], }, { audience: 'admin', },);
        expect(listSql(),).toContain('array_position(',);
    },);
},);

describe('sync validation', () => {
    it('refuses unknown media and duplicates', async () => {
        await expect(items.sync({ items: [{ mediaId: M1, }, { mediaId: M1, },], }, CTX,),).rejects.toThrow(/listed twice/,);
        mediaRows = [];
        await expect(items.sync({ items: [{ mediaId: M1, },], }, CTX,),).rejects.toThrow(/no longer exists/,);
    },);

    it('refuses a video while videos are off', async () => {
        settings = { allowVideos: false, };
        mediaRows = [{ id: M1, mime_type: 'video/mp4', },];
        await expect(items.sync({ items: [{ mediaId: M1, },], }, CTX,),).rejects.toThrow(/Videos are turned off/,);
    },);

    it('refuses a tier visibility without a tier', async () => {
        mediaRows = [{ id: M1, mime_type: 'image/png', },];
        await expect(items.sync({ items: [{ mediaId: M1, visibility: 'tier', minTierId: null, },], }, CTX,),).rejects.toThrow(/Choose a tier/,);
    },);
},);
