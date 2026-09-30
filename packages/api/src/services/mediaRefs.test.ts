import { beforeEach, describe, expect, it, vi, } from 'vitest';

const query = vi.fn();
let dbDown = false;
vi.mock('../db', () => ({
    query: async (...a: unknown[]) => {
        if (dbDown) throw new Error('db down',);
        return query(...a,);
    },
}),);
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), }, }),);

const { attachFeaturedMedia, urlPath, } = await import('./mediaRefs');

const ROW = {
    id: 'm1', url: 'https://cdn.x/uploads/a.jpg', thumbnail_url: null, title: 'Rally',
    caption: 'Crowd', credits: 'Photo: J. Doe', alt: 'A crowd', mime_type: 'image/jpeg',
};

beforeEach(() => {
    query.mockReset();
    dbDown = false;
},);

describe('attachFeaturedMedia', () => {
    it('attaches the library record, matched by URL or by path', async () => {
        query.mockResolvedValue({ rows: [ROW,], },);
        const recs = [
            { featuredImage: 'https://cdn.x/uploads/a.jpg', },
            { featuredImage: '/uploads/a.jpg', },
        ];
        await attachFeaturedMedia(recs,);
        expect(query,).toHaveBeenCalledTimes(1,); // one query for the whole batch
        for (const r of recs as Array<Record<string, any>>) {
            expect(r.featuredMedia,).toMatchObject({ id: 'm1', title: 'Rally', description: 'Crowd', credits: 'Photo: J. Doe', },);
            expect(r.featuredMedia.path,).toBe(r.featuredImage,);
        }
    },);

    it('gives a bare ref for a URL not in the library, null for no image', async () => {
        query.mockResolvedValue({ rows: [], },);
        const recs: Array<Record<string, any>> = [{ featuredImage: 'https://else.where/b.png', }, { featuredImage: '', },];
        await attachFeaturedMedia(recs,);
        expect(recs[0].featuredMedia,).toMatchObject({ id: null, path: 'https://else.where/b.png', credits: null, },);
        expect(recs[1].featuredMedia,).toBeNull();
    },);

    it('survives a failed lookup', async () => {
        dbDown = true;
        const recs: Array<Record<string, any>> = [{ featuredImage: '/u.jpg', },];
        await attachFeaturedMedia(recs,);
        expect(recs[0].featuredMedia.path,).toBe('/u.jpg',);
    },);

    it('urlPath strips the host and query', () => {
        expect(urlPath('https://cdn.x/uploads/a.jpg?v=2',),).toBe('/uploads/a.jpg',);
    },);
},);
