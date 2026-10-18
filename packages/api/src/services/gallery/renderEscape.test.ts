/** Gallery HTML escaping (audit 2026-10-18 A7). */
import { describe, expect, it, } from 'vitest';
import { absoluteGalleryUrl, cssUrl, } from './render';

describe('gallery render helpers', () => {
    it('cssUrl percent-encodes what could close url(\'…\')', () => {
        expect(cssUrl("https://x/a'b(c).jpg",),).toBe('https://x/a%27b%28c%29.jpg',);
        expect(cssUrl('https://x/a b.jpg',),).toBe('https://x/a%20b.jpg',);
    },);
    it('absoluteGalleryUrl takes (url, base)', () => {
        expect(absoluteGalleryUrl('/uploads/a.jpg', 'https://site/',),).toBe('https://site/uploads/a.jpg',);
        expect(absoluteGalleryUrl('https://cdn/a.jpg', 'https://site',),).toBe('https://cdn/a.jpg',);
    },);
},);
