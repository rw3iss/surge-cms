/**
 * Server gallery HTML: SSR figures + the email table grid.
 */
import type { GalleryItem, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { emailColumns, } from '../mail/blocks/gallery';
import { absUrl, galleryEmailHtml, galleryFiguresHtml, previewUrl, } from './render';

const item = (over: Partial<GalleryItem> & { mediaType?: 'image' | 'video'; thumb?: string | null; } = {},): GalleryItem => ({
    id: over.id ?? 'a1',
    mediaId: 'm1',
    media: {
        id: 'm1', type: over.mediaType ?? 'image', mimeType: over.mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
        url: over.mediaType === 'video' ? '/api/v1/video/m1/file' : '/uploads/a.jpg',
        thumbnailUrl: over.thumb === undefined ? '/uploads/thumb-a.jpg' : over.thumb,
        width: 800, height: 600, durationMs: null, title: null, caption: null, alt: 'An "alt"', credits: null,
        accessLevel: 'public', status: 'ready',
    },
    title: over.title ?? 'Sunset <b>',
    caption: over.caption ?? 'Over the bay',
    titleOverride: null, captionOverride: null, tags: [], sortOrder: 0, visibility: 'inherit', minTierId: null,
    comments: 'inherit', anonymousComments: 'inherit', url: `/gallery/${over.id ?? 'a1'}`, commentCount: 0,
    publishedAt: '2026-10-11T00:00:00Z', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z',
    ...over,
} as GalleryItem);

describe('absUrl', () => {
    it('keeps absolute URLs and prefixes site paths', () => {
        expect(absUrl('https://cdn.x/a.jpg', 'https://site',),).toBe('https://cdn.x/a.jpg',);
        expect(absUrl('/uploads/a.jpg', 'https://site/',),).toBe('https://site/uploads/a.jpg',);
        expect(absUrl('', 'https://site',),).toBe('',);
    },);
},);

describe('previewUrl', () => {
    it('a video shows its poster, never the video file', () => {
        expect(previewUrl(item({ mediaType: 'video', },),),).toBe('/uploads/thumb-a.jpg',);
        expect(previewUrl(item({ mediaType: 'video', thumb: null, },),),).toBe('',);
    },);
},);

describe('galleryFiguresHtml (SSR)', () => {
    it('emits escaped, linked, absolute figures', () => {
        const html = galleryFiguresHtml([item(),], 'https://site',);
        expect(html,).toContain('<figure class="ssr-gallery__item"><a href="https://site/gallery/a1">',);
        expect(html,).toContain('src="https://site/uploads/a.jpg"',);
        expect(html,).toContain('alt="An &quot;alt&quot;"',);
        expect(html,).toContain('Sunset &lt;b&gt;',);
        expect(html,).not.toContain('<b>',);
    },);
    it('labels videos and skips items whose media is gone', () => {
        const html = galleryFiguresHtml([item({ mediaType: 'video', },), { ...item({ id: 'x', },), media: null, },], '',);
        expect(html,).toContain('(video)',);
        expect(html,).not.toContain('/gallery/x',);
    },);
    it('nothing in, nothing out', () => {
        expect(galleryFiguresHtml([], '',),).toBe('',);
    },);
},);

describe('galleryEmailHtml', () => {
    it('lays items out in table rows, padding the last row', () => {
        const html = galleryEmailHtml([item({ id: 'a', },), item({ id: 'b', },), item({ id: 'c', },), item({ id: 'd', },),], 'https://site', { columns: 3, },);
        expect(html.match(/<tr>/g,)?.length,).toBe(2,);
        expect(html.match(/<td /g,)?.length,).toBe(6,);
        expect(html,).toContain('width="33%"',);
        expect(html,).toContain('https://site/uploads/a.jpg',);
    },);
    it('a video is its poster linked to the item page, with a Watch line', () => {
        const html = galleryEmailHtml([item({ mediaType: 'video', },),], 'https://site', { columns: 1, },);
        expect(html,).toContain('<a href="https://site/gallery/a1"',);
        expect(html,).toContain('&#9654; Watch',);
        expect(html,).not.toContain('/api/v1/video/m1/file',);
    },);
    it('titles and captions only when asked', () => {
        expect(galleryEmailHtml([item(),], 'https://site',),).not.toContain('Over the bay',);
        expect(galleryEmailHtml([item(),], 'https://site', { showCaptions: true, },),).toContain('Over the bay',);
    },);
    it('refuses CSS that could escape a declaration', () => {
        expect(galleryEmailHtml([item(),], 'https://site', { radius: '4px;}x{', },),).not.toContain('}x{',);
    },);
},);

describe('emailColumns (Gallery block in email)', () => {
    it('maps layouts onto a grid, capped at 4', () => {
        expect(emailColumns({ desktop: { layout: 'grid', columns: 6, }, },),).toBe(4,);
        expect(emailColumns({ desktop: { layout: 'row', itemsPerPage: 2, }, },),).toBe(2,);
        expect(emailColumns({ desktop: { layout: 'stage', }, },),).toBe(1,);
        expect(emailColumns({},),).toBe(3,);
    },);
},);
