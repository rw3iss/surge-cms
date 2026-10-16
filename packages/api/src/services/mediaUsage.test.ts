import { beforeEach, describe, expect, it, vi, } from 'vitest';

const query = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => query(...a,), }),);
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), }, }),);
vi.mock('../entities/entityManager.js', () => ({
    ready: async () => {},
    all: () => [
        {
            key: 'recipe', label: 'Recipe', origin: 'custom', tableName: 'ce_recipe',
            fields: [
                { key: 'name', label: 'Name', type: 'text', },
                { key: 'heroImage', label: 'Hero image', type: 'media', },
                { key: 'servings', label: 'Servings', type: 'integer', },
            ],
        },
        { key: 'post', label: 'Post', origin: 'core', tableName: 'posts', fields: [{ key: 'title', label: 'Title', type: 'text', },], },
    ],
}),);

const {
    buildPatterns, collectUsage, fileNeedle, findMediaUsage, likeEscape, mediaNeedles, MediaInUseError, assertNotInUse, SOURCES,
} = await import('./mediaUsage');

const ID = '8f12dfc7-724c-457c-a50e-698289d8db18';
const MEDIA = { id: ID, url: 'https://cdn.example.com/uploads/pMIJ_pYRthILy.jpeg', thumbnail_url: '/uploads/thumb_pMIJ_pYRthILy.jpeg', };

/** A LIKE pattern (as built by buildPatterns) → does `text` match it? */
function likeMatches(pat: string, text: string,): boolean {
    let re = '';
    for (let i = 0; i < pat.length; i++) {
        const c = pat[i];
        if (c === '\\') re += pat[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&',);
        else if (c === '%') re += '.*';
        else if (c === '_') re += '.';
        else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&',);
    }
    return new RegExp(`^${re}$`, 's',).test(text,);
}
const matchesAny = (text: string,) => buildPatterns([MEDIA,],).pats.some((p,) => likeMatches(p, text,),);

beforeEach(() => {
    query.mockReset();
},);

describe('needles', () => {
    it('uses the id and the file names of the file and its thumbnail', () => {
        expect(mediaNeedles(MEDIA,),).toEqual([ID, '/pMIJ_pYRthILy.jpeg', '/thumb_pMIJ_pYRthILy.jpeg',],);
    });

    it('skips names too generic to match safely (a video file endpoint)', () => {
        expect(fileNeedle(`/api/v1/video/${ID}/file`,),).toBeNull();
        expect(fileNeedle('https://x/a.jpg',),).toBeNull();
        expect(fileNeedle('/uploads/abcdef.png?v=2#x',),).toBe('/abcdef.png',);
        expect(mediaNeedles({ id: ID, url: `/api/v1/video/${ID}/file`, },),).toEqual([ID,],);
    });

    it('escapes LIKE wildcards (nanoid names contain _)', () => {
        expect(likeEscape('a_b%c\\d',),).toBe('a\\_b\\%c\\\\d',);
    });
});

describe('URL and id forms all match', () => {
    it.each([
        ['absolute CDN URL', '{"url":"https://cdn.example.com/uploads/pMIJ_pYRthILy.jpeg"}',],
        ['another host (storage endpoint)', 'https://bucket.r2.dev/uploads/pMIJ_pYRthILy.jpeg',],
        ['host-relative path', '<img src="/uploads/pMIJ_pYRthILy.jpeg">',],
        ['thumbnail', 'https://cdn.example.com/uploads/thumb_pMIJ_pYRthILy.jpeg',],
        ['background in block style', '{"backgroundImage":"url(/uploads/pMIJ_pYRthILy.jpeg)"}',],
        ['block settings mediaId', `{"mediaId":"${ID}"}`,],
        ['images[].mediaId', `{"images":[{"mediaId":"${ID}","alt":""}]}`,],
        ['video URL', `{"src":"/api/v1/video/${ID}/master.m3u8"}`,],
        ['uuid column (gallery_items.media_id)', ID,],
    ],)('%s', (_label, text,) => {
        expect(matchesAny(text,),).toBe(true,);
    },);

    it.each([
        ['a different file', '/uploads/other.jpeg',],
        ['the name with a different character where `_` sits', '/uploads/pMIJxpYRthILy.jpeg',],
        ['the name without its leading slash boundary', '/uploads/xpMIJ_pYRthILy.jpeg',],
        ['a different uuid', '{"mediaId":"7cf4afe8-34f3-434a-9d34-cc8dabde4b55"}',],
    ],)('does not match %s', (_label, text,) => {
        expect(matchesAny(text,),).toBe(false,);
    },);
});

describe('collectUsage', () => {
    const src = SOURCES.find((s,) => s.name === 'posts',)!;
    const row = (id: string, field = 'Featured image',) => ({ media_id: ID, id, label: `Post ${id}`, field, extra: 'published', });

    it('groups per media, de-duplicates and caps', () => {
        const rows = [row('a',), row('a',), row('b',), ...Array.from({ length: 30, }, (_, i,) => row(`p${i}`,),),];
        const out = collectUsage([ID, 'other',], [{ source: src, rows, },], 20,);
        expect(out.other,).toEqual([],);
        expect(out[ID],).toHaveLength(20,);
        expect(out[ID][0],).toEqual({ kind: 'post', id: 'a', label: 'Post a', adminUrl: '/admin/posts/a', field: 'Featured image', },);
        expect(out[ID].filter((u,) => u.id === 'a',),).toHaveLength(1,);
    });

    it('labels a trashed post and maps site settings keys', () => {
        const trashed = collectUsage([ID,], [{ source: src, rows: [{ ...row('x',), extra: 'deleted', },], },],);
        expect(trashed[ID][0].label,).toBe('Post x (in trash)',);
        const settings = SOURCES.find((s,) => s.name === 'site settings',)!;
        const out = collectUsage([ID,], [{ source: settings, rows: [{ media_id: ID, id: 'site_header', label: null, field: null, extra: null, },], },],);
        expect(out[ID][0],).toMatchObject({ kind: 'header', adminUrl: '/admin/settings?tab=site-header', },);
    });
});

describe('findMediaUsage', () => {
    function mockDb(hits: Record<string, Array<Record<string, unknown>>>,) {
        query.mockImplementation(async (sql: string, params: unknown[],) => {
            if (sql.includes('FROM media WHERE')) return { rows: [MEDIA,], };
            for (const [needle, rows,] of Object.entries(hits,)) if (sql.includes(needle,)) return { rows, };
            void params;
            return { rows: [], };
        },);
    }

    it('runs one query per source with the parallel needle arrays, and scans custom entities', async () => {
        mockDb({
            'FROM posts p JOIN n': [{ media_id: ID, id: 'p1', label: 'Rally', field: 'Featured image', extra: 'published', },],
            'FROM gallery_items gi': [{ media_id: ID, id: 'g1', label: null, field: 'Gallery', extra: null, },],
            'FROM "ce_recipe" e': [{ media_id: ID, id: 'r1', label: 'Soup', field: 'hero_image', extra: null, },],
        },);
        const out = await findMediaUsage([ID, ID, 'not-a-uuid',],);
        expect(Object.keys(out,),).toEqual([ID,],);
        expect(out[ID].map((u,) => u.kind,).sort(),).toEqual(['entity', 'gallery_item', 'post',],);
        expect(out[ID].find((u,) => u.kind === 'entity',),).toMatchObject({ label: 'Recipe: Soup', field: 'Hero image', adminUrl: '/admin/entities/recipe/r1', },);
        const scanCall = query.mock.calls.find((c,) => String(c[0],).includes('FROM posts p JOIN n',),)!;
        const [ids, pats,] = scanCall[1] as [string[], string[],];
        expect(ids,).toHaveLength(pats.length,);
        expect(pats,).toContain(`%${ID}%`,);
        expect(pats,).toContain('%/pMIJ\\_pYRthILy.jpeg%',);
        // The core post type is covered by the bespoke source, not re-scanned.
        expect(query.mock.calls.some((c,) => String(c[0],).includes('"posts" e',),),).toBe(false,);
    });

    it('skips a missing table (feature never installed) and can exclude kinds', async () => {
        query.mockImplementation(async (sql: string,) => {
            if (sql.includes('FROM media WHERE')) return { rows: [MEDIA,], };
            if (sql.includes('shop_product_media',)) throw Object.assign(new Error('relation does not exist',), { code: '42P01', },);
            if (sql.includes('FROM gallery_items gi',)) return { rows: [{ media_id: ID, id: 'g1', label: null, field: 'Gallery', extra: null, },], };
            return { rows: [], };
        },);
        expect((await findMediaUsage([ID,],))[ID],).toHaveLength(1,);
        expect((await findMediaUsage([ID,], { excludeKinds: ['gallery_item',], },))[ID],).toEqual([],);
    });

    it('assertNotInUse throws 409 MEDIA_IN_USE with only the used ids', async () => {
        mockDb({ 'FROM posts p JOIN n': [{ media_id: ID, id: 'p1', label: 'Rally', field: 'Featured image', extra: null, },], },);
        const err = await assertNotInUse([ID,],).catch((e: unknown,) => e,);
        expect(err,).toBeInstanceOf(MediaInUseError,);
        expect(err,).toMatchObject({ statusCode: 409, code: 'MEDIA_IN_USE', },);
        expect(Object.keys((err as MediaInUseError).details!.usage as object,),).toEqual([ID,],);
        mockDb({},);
        await expect(assertNotInUse([ID,],),).resolves.toBeUndefined();
    });
});
