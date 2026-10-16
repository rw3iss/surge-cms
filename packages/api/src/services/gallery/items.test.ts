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
let collections: string[] = [];
const C1 = '33333333-3333-4333-8333-333333333333';
const I1 = '44444444-4444-4444-8444-444444444444';

vi.mock('../../db', () => ({
    query: async (sql: string, params: unknown[] = [],) => {
        calls.push({ sql, params, },);
        if (sql.includes('FROM media WHERE id = ANY',)) return { rows: mediaRows, };
        if (sql.includes('FROM gallery_collections WHERE id = ANY',)) return { rows: (params[0] as string[]).filter((x,) => collections.includes(x,),).map((id,) => ({ id, })), };
        if (sql.includes('COUNT(*)',)) return { rows: [{ n: 0, },], };
        return { rows: [], rowCount: 0, };
    },
    transaction: async (fn: (c: unknown,) => Promise<unknown>,) => fn({
        query: async (sql: string, params: unknown[] = [],) => {
            calls.push({ sql, params, },);
            return { rows: [], rowCount: 1, };
        },
    },),
}),);
vi.mock('../settings', () => ({ get: async () => settings, set: async () => undefined, }),);
vi.mock('../cache', () => ({ cache: { get: async () => null, set: async () => undefined, invalidateGalleryCache: async () => undefined, invalidateSitemapCache: async () => undefined, }, CACHE_KEYS: { galleryList: (h: string,) => `gallery:list:${h}`, }, }),);
vi.mock('../audit', () => ({ logAudit: async () => undefined, }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), }, }),);
vi.mock('../postGate', () => ({ viewerRank: async () => null, tiersById: async () => new Map(), }),);
vi.mock('../permissions', () => ({ ENTITLED_STATUSES: ['active',], extraRoles: async () => [], }),);
vi.mock('../subscriptionAccess', () => ({ getPolicy: async () => ({ required: false, }), }),);

const items = await import('./items');
const CTX = { userId: undefined as never, ipAddress: '', userAgent: '', };

beforeEach(() => {
    calls.length = 0;
    mediaRows = [];
    settings = {};
    collections = [C1,];
},);

describe('normalizeQuery', () => {
    it('parses comma ids, clamps limit/page, defaults sort/type', () => {
        const q = items.normalizeQuery({ ids: `${ID}, nope`, limit: 999, page: 0, sort: 'bogus' as never, },);
        expect(q,).toMatchObject({ ids: [ID,], limit: 200, page: 1, sort: 'order', type: 'all', },);
    },);
},);

describe('every bound parameter is referenced (Postgres rejects unused ones)', () => {
    const check = () => {
        for (const c of calls.filter((x,) => x.sql.includes('FROM gallery_items gi',),)) {
            for (let i = 1; i <= c.params.length; i++) expect(c.sql,).toMatch(new RegExp(`\\$${i}(?!\\d)`,),);
        }
    };
    it('staff viewer (regression: /gallery was empty for signed-in staff)', async () => {
        await items.list({ collectionId: 'root', }, { viewer: { id: 'u1', role: 'admin', }, grants: { signedIn: true, staff: true, roles: ['admin',], tierIds: [], }, },);
        check();
    },);
    it('anonymous and member viewers', async () => {
        await items.list({ collectionId: 'root', }, { viewer: null, },);
        await items.list({}, { viewer: { id: 'u2', role: 'member', }, grants: { signedIn: true, staff: false, roles: ['member',], tierIds: [], }, },);
        check();
    },);
},);

describe('list WHERE by audience', () => {
    const listSql = () => calls.find((c,) => c.sql.includes('FROM gallery_items gi',) && !c.sql.includes('COUNT',),)!.sql;

    it('site: ready media + the level gate', async () => {
        await items.list({}, { viewer: null, },);
        expect(listSql(),).toContain(`m.status = 'ready'`,);
        expect(listSql(),).toMatch(/CASE gi.visibility .* <= \$\d/s,);
        // Role / tier gate: item rule → collection rule → floor.
        expect(listSql(),).toContain('LEFT JOIN gallery_collections gc ON gc.id = gi.collection_id',);
        expect(listSql(),).toMatch(/CASE WHEN \(gi\.access_enabled.*WHEN gc\.id IS NOT NULL AND \(gc\.access_enabled.*ELSE \(CASE gi\.visibility/s,);
        expect(listSql(),).not.toContain(`m.access_level = 'public'`,);
    },);

    it('email: public media only, no level gate', async () => {
        await items.list({}, { audience: 'email', },);
        expect(listSql(),).toContain(`m.access_level = 'public'`,);
        expect(listSql(),).not.toContain('CASE gi.visibility',);
        expect(listSql(),).not.toContain('access_enabled',);
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

    it('collectionId: root = no collection, uuid = that collection, absent = all', async () => {
        await items.list({ collectionId: 'root', }, { audience: 'admin', },);
        expect(listSql(),).toContain('gi.collection_id IS NULL',);
        calls.length = 0;
        await items.list({ collectionId: C1, }, { audience: 'admin', },);
        expect(listSql(),).toMatch(/gi\.collection_id = \$\d/,);
        calls.length = 0;
        await items.list({}, { audience: 'admin', },);
        expect(listSql(),).not.toMatch(/gi\.collection_id (IS NULL|= \$)/,);
    },);

    it('ids keep their given order', async () => {
        await items.list({ ids: [ID,], }, { audience: 'admin', },);
        expect(listSql(),).toContain('array_position(',);
    },);
},);

describe('listing (gallery pages) vs default', () => {
    const listSql = () => calls.find((c,) => c.sql.includes('LIMIT',),)!.sql;

    it('default (blocks, templates, email): hidden items + hidden collections are included', async () => {
        await items.list({}, {},);
        expect(listSql(),).not.toContain('hidden_in_gallery',);
        calls.length = 0;
        await items.list({}, { audience: 'email', },);
        expect(listSql(),).not.toContain('hidden_in_gallery',);
    },);

    it('listing: leaves out hidden items and items in hidden collections, in SQL (count too)', async () => {
        await items.list({ listing: true, }, {},);
        expect(listSql(),).toContain('gi.hidden_in_gallery = false',);
        expect(listSql(),).toContain('COALESCE(gc.hidden_in_gallery, false) = false',);
        const count = calls.find((c,) => c.sql.includes('COUNT(*)',),)!.sql;
        expect(count,).toContain('gi.hidden_in_gallery = false',);
        expect(count,).toContain('LEFT JOIN gallery_collections gc',);
    },);

    it("listing a collection's own page keeps its non-hidden items even when the collection is hidden", async () => {
        await items.list({ listing: true, collectionId: C1, }, {},);
        expect(listSql(),).toContain('gi.hidden_in_gallery = false',);
        expect(listSql(),).not.toContain('gc.hidden_in_gallery',);
    },);

    it("accepts the query string's 'true'", () => {
        expect(items.normalizeQuery({ listing: 'true' as never, },).listing,).toBe(true,);
        expect(items.normalizeQuery({},).listing,).toBeUndefined();
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

describe('sync preserves collection + access', () => {
    const updateOf = () => calls.find((c,) => c.sql.startsWith('UPDATE gallery_items SET sort_order',),)!;

    it('an existing item whose input omits collectionId/access keeps them', async () => {
        await items.sync({ items: [{ id: I1, titleOverride: 'x', },], }, CTX,);
        expect(updateOf().sql,).not.toContain('collection_id',);
        expect(updateOf().sql,).not.toContain('access_enabled',);
    },);

    it('sets them when given (null = root)', async () => {
        await items.sync({ items: [{ id: I1, collectionId: null, access: { enabled: true, roles: ['vip',], tierIds: [], }, },], }, CTX,);
        expect(updateOf().sql,).toContain('collection_id = $',);
        expect(updateOf().sql,).toContain('access_roles = $',);
        expect(updateOf().params,).toContain(null,);
    },);

    it('a new item lands in its collection', async () => {
        mediaRows = [{ id: M1, mime_type: 'image/png', },];
        await items.sync({ items: [{ mediaId: M1, collectionId: C1, },], }, CTX,);
        const ins = calls.find((c,) => c.sql.includes('INSERT INTO gallery_items',),)!;
        expect(ins.sql,).toContain('collection_id',);
        expect(ins.params,).toContain(C1,);
    },);

    it('hiddenInGallery: omitted = unchanged, given = set (update + insert)', async () => {
        await items.sync({ items: [{ id: I1, titleOverride: 'x', },], }, CTX,);
        expect(updateOf().sql,).not.toContain('hidden_in_gallery',);
        calls.length = 0;
        await items.sync({ items: [{ id: I1, hiddenInGallery: true, },], }, CTX,);
        expect(updateOf().sql,).toContain('hidden_in_gallery = $',);
        expect(updateOf().params,).toContain(true,);
        calls.length = 0;
        mediaRows = [{ id: M1, mime_type: 'image/png', },];
        await items.sync({ items: [{ mediaId: M1, hiddenInGallery: true, },], }, CTX,);
        const ins = calls.find((c,) => c.sql.includes('INSERT INTO gallery_items',),)!;
        expect(ins.sql,).toContain('hidden_in_gallery',);
        expect(ins.params.at(-1,),).toBe(true,);
    },);

    it('refuses an unknown collection', async () => {
        collections = [];
        await expect(items.sync({ items: [{ id: I1, collectionId: C1, },], }, CTX,),).rejects.toThrow(/collection no longer exists/,);
    },);
},);
