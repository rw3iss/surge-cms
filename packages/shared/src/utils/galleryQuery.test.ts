import { describe, expect, it, } from 'vitest';
import { entityQueryToGalleryQuery, galleryQueryToEntityQuery, } from './galleryQuery';

describe('Set data… ↔ GalleryQuery (one shared mapping)', () => {
    it('keeps featured (virtual filter or the isFeatured field), collection, tag, type, limit', () => {
        expect(entityQueryToGalleryQuery({ filter: { featured: { op: 'eq', value: true, }, }, limit: 6, },),)
            .toEqual({ type: 'all', sort: 'order', featured: true, limit: 6, },);
        expect(entityQueryToGalleryQuery({ filter: { isFeatured: 'true', collection: 'root', tag: 'news', type: 'image', }, },),)
            .toMatchObject({ featured: true, collectionId: 'root', tag: 'news', type: 'image', },);
    },);
    it('maps the modal sort with its direction', () => {
        expect(entityQueryToGalleryQuery({ sortBy: 'publishedAt', sortOrder: 'desc', },).sort,).toBe('newest',);
        expect(entityQueryToGalleryQuery({ sortBy: 'title', sortOrder: 'desc', },),).toMatchObject({ sort: 'title', dir: 'desc', },);
    },);
    it('round-trips through the modal', () => {
        const q = { type: 'video' as const, sort: 'title' as const, dir: 'desc' as const, featured: true, collectionId: 'root', tag: 'a', limit: 6, };
        expect(entityQueryToGalleryQuery(galleryQueryToEntityQuery(q,),),).toEqual(q,);
    },);
    it('honours != (featured, type) and drops a negated tag / collection instead of inverting it', () => {
        expect(entityQueryToGalleryQuery({ filter: { featured: { op: 'ne', value: true, }, }, },).featured,).toBe(false,);
        expect(entityQueryToGalleryQuery({ filter: { isFeatured: { op: 'ne', value: 'false', }, }, },).featured,).toBe(true,);
        expect(entityQueryToGalleryQuery({ filter: { type: { op: 'ne', value: 'video', }, }, },).type,).toBe('image',);
        const q = entityQueryToGalleryQuery({ filter: { tag: { op: 'ne', value: 'x', }, collection: { op: 'ne', value: 'root', }, }, },);
        expect(q.tag,).toBeUndefined();
        expect(q.collectionId,).toBeUndefined();
    },);
},);
