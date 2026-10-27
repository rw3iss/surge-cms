import { describe, expect, it, } from 'vitest';
import { mergeSaved, } from './mergeSaved';

describe('mergeSaved', () => {
    it('is the loaded row until something is saved', () => {
        const row = { id: '1', slug: 'home-copy', status: 'draft', };
        expect(mergeSaved(row, null,),).toBe(row,);
    },);
    it('overlays the saved fields (a renamed slug, a publish)', () => {
        expect(mergeSaved({ id: '1', slug: 'home-copy', status: 'draft', }, { slug: 'home-draft', status: 'published', },),)
            .toEqual({ id: '1', slug: 'home-draft', status: 'published', },);
    },);
    it('handles nothing loaded', () => {
        expect(mergeSaved(null, null,),).toBeNull();
        expect(mergeSaved(null, { slug: 'x', },),).toEqual({ slug: 'x', },);
    },);
},);
