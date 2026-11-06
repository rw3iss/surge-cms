import { describe, expect, it, } from 'vitest';
import { galleryNavKey, } from './itemKeyNav';

describe('galleryNavKey', () => {
    it('maps the arrows', () => {
        expect(galleryNavKey({ key: 'ArrowLeft', }, false,),).toBe('prev',);
        expect(galleryNavKey({ key: 'ArrowRight', }, false,),).toBe('next',);
        expect(galleryNavKey({ key: 'ArrowUp', }, false,),).toBeNull();
    });
    it('leaves arrows to text fields, the player and modified keys', () => {
        expect(galleryNavKey({ key: 'ArrowLeft', }, true,),).toBeNull();
        expect(galleryNavKey({ key: 'ArrowLeft', altKey: true, }, false,),).toBeNull();
        expect(galleryNavKey({ key: 'ArrowRight', metaKey: true, }, false,),).toBeNull();
        expect(galleryNavKey({ key: 'ArrowRight', defaultPrevented: true, }, false,),).toBeNull();
    });
});
