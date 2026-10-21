import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../db', () => ({ query: vi.fn(async () => ({ rows: [], }),), }),);
vi.mock('../../entities/dataProviders', () => ({ registerEntityDataProvider: vi.fn(), }),);
vi.mock('../../entities/virtualFilters', () => ({ registerVirtualFilter: vi.fn(), }),);

const { toGalleryQuery, } = await import('./entity');

describe('toGalleryQuery sort (select modal → gallery)', () => {
    it('date fields carry the direction', () => {
        expect(toGalleryQuery({ sortBy: 'createdAt', sortOrder: 'asc', },).sort,).toBe('oldest',);
        expect(toGalleryQuery({ sortBy: 'createdAt', sortOrder: 'desc', },).sort,).toBe('newest',);
        expect(toGalleryQuery({ sortBy: 'publishedAt', sortOrder: 'desc', },).sort,).toBe('newest',);
    },);
    it('direction alone sorts by date (regression: the toggle did nothing)', () => {
        expect(toGalleryQuery({ sortOrder: 'asc', },).sort,).toBe('oldest',);
    },);
    it('title and gallery order reverse with dir', () => {
        expect(toGalleryQuery({ sortBy: 'title', sortOrder: 'desc', },),).toMatchObject({ sort: 'title', dir: 'desc', },);
        expect(toGalleryQuery({ sortBy: 'sortOrder', sortOrder: 'desc', },),).toMatchObject({ sort: 'order', dir: 'desc', },);
    },);
    it('no sort → gallery order', () => {
        expect(toGalleryQuery({},).sort,).toBe('order',);
    },);
},);

describe('featured filter (Set data… modal)', () => {
    it('maps the virtual `featured` filter onto GalleryQuery.featured', () => {
        expect(toGalleryQuery({ filter: { featured: { op: 'eq', value: true, }, }, } as never,).featured,).toBe(true,);
        expect(toGalleryQuery({ filter: { featured: 'false', }, } as never,).featured,).toBe(false,);
        expect(toGalleryQuery({},).featured,).toBeUndefined();
    },);
},);
