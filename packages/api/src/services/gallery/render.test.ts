/**
 * Server gallery HTML: SSR figures + the email table grid.
 */
import type { GalleryItem, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { horizontalPadding, renderGallery, } from '../mail/blocks/gallery';
import { GALLERY_RESOLVED_KEY, } from './serverRender';
import { absUrl, galleryContainSize, galleryEmailAlign, galleryEmailHtml, galleryEmailPlan, galleryFiguresHtml, previewUrl, } from './render';
import type { EmailBlockNode, EmailRenderCtx, } from '../mail/blocks/index';

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

const four = () => [item({ id: 'a', },), item({ id: 'b', },), item({ id: 'c', },), item({ id: 'd', },),];
/** Inner row tables (one per visual row). */
const rowTables = (html: string,) => html.match(/<table role="presentation" align="center" width="\d+" cellpadding="0" cellspacing="0" border="0" style="width:\d+px;max-width:100%;margin:0 auto;border-collapse:collapse;">/g,) ?? [];

describe('galleryEmailPlan', () => {
    it('grid uses its columns (up to 6), column is one per row', () => {
        expect(galleryEmailPlan({ desktop: { layout: 'grid', columns: 6, }, },),).toMatchObject({ mode: 'grid', columns: 6, },);
        expect(galleryEmailPlan({ desktop: { layout: 'grid', columns: 9, }, },).columns,).toBe(6,);
        expect(galleryEmailPlan({ desktop: { layout: 'column', columns: 4, }, },),).toMatchObject({ mode: 'grid', columns: 1, },);
        expect(galleryEmailPlan({},),).toMatchObject({ mode: 'grid', columns: 3, },);
    },);
    it('row / carousel / stage become a centred wrapped grid', () => {
        expect(galleryEmailPlan({ desktop: { layout: 'row', itemsPerPage: 2, }, },),).toMatchObject({ mode: 'wrap', columns: 2, },);
        expect(galleryEmailPlan({ desktop: { layout: 'carousel', itemsPerPage: 4, }, },),).toMatchObject({ mode: 'wrap', columns: 4, },);
        expect(galleryEmailPlan({ desktop: { layout: 'stage', }, },),).toMatchObject({ mode: 'wrap', columns: 3, },);
    },);
    it('a px item width fits as many columns as the body allows', () => {
        // (600 + 12) / (180 + 12) = 3.18 → 3
        const p = galleryEmailPlan({ desktop: { layout: 'row', itemWidth: '180px', itemsPerPage: 5, }, },);
        expect(p,).toMatchObject({ columns: 3, itemWidth: 180, },);
        expect(galleryEmailPlan({ desktop: { layout: 'row', itemWidth: '180px', }, }, { width: 400, },).columns,).toBe(2,);
    },);
    it('item height wins over the aspect; aspect sizes otherwise; original = natural', () => {
        expect(galleryEmailPlan({ desktop: { columns: 3, itemHeight: '240px', aspect: 'square', }, },).itemHeight,).toBe(240,);
        const sq = galleryEmailPlan({ desktop: { columns: 3, aspect: 'square', gap: '12px', }, },);
        expect(sq.itemWidth,).toBe(188,); // 200 slot − 2 × 6 padding
        expect(sq.itemHeight,).toBe(188,);
        expect(galleryEmailPlan({ desktop: { columns: 2, aspect: '16:9', gap: '0', }, },).itemHeight,).toBe(169,);
        expect(galleryEmailPlan({ desktop: { aspect: 'original', }, },).itemHeight,).toBeNull();
    },);
    it('radius: item radius → site radius → 8px; 0 overrides', () => {
        expect(galleryEmailPlan({},).radius,).toBe('8px',);
        expect(galleryEmailPlan({}, { siteRadius: '3px', },).radius,).toBe('3px',);
        expect(galleryEmailPlan({ itemRadius: '0', }, { siteRadius: '3px', },).radius,).toBe('0px',);
        expect(galleryEmailPlan({ itemRadius: '12', }, { siteRadius: '3px', },).radius,).toBe('12px',);
        expect(galleryEmailPlan({ radius: '5px', }, { siteRadius: '3px', },).radius,).toBe('5px',); // legacy key
    },);
},);

describe('galleryEmailHtml', () => {
    it('grid: rows of N cells, the last row padded and left-aligned', () => {
        const html = galleryEmailHtml(four(), 'https://site', { desktop: { layout: 'grid', columns: 3, }, },);
        expect(rowTables(html,).length,).toBe(2,);
        expect(html.match(/<td width="200"/g,)?.length,).toBe(6,);
        expect(html,).toContain('https://site/uploads/a.jpg',);
    },);
    it('row / carousel / stage: wrapped rows sized to their items, centred', () => {
        for (const layout of ['row', 'carousel', 'stage',] as const) {
            const html = galleryEmailHtml(four(), 'https://site', { desktop: { layout, itemsPerPage: 3, columns: 3, }, },);
            const rows = rowTables(html,);
            expect(rows.length,).toBe(2,);
            expect(rows[0],).toContain('width="600"',);
            expect(rows[1],).toContain('width="200"',); // the lone last item, centred
            expect(html.match(/<td width="200"/g,)?.length,).toBe(4,); // no padding cells
            expect(html,).toContain('gallery-grid--wrap',);
        }
    },);
    it('column: one item per row at full width', () => {
        const html = galleryEmailHtml(four(), 'https://site', { desktop: { layout: 'column', }, },);
        expect(rowTables(html,).length,).toBe(4,);
        expect(html,).toContain('width="600"',);
    },);
    it('a cover box is a background cell of that exact size (Outlook attributes + VML), cropped', () => {
        const html = galleryEmailHtml([item(),], 'https://site', { desktop: { columns: 2, itemHeight: '150px', fit: 'cover', gap: '0', }, },);
        expect(html,).toContain('width="300" height="150"',);
        expect(html,).toContain('width:300px;height:150px',);
        expect(html,).toContain('background-size:cover',);
        expect(html,).toContain('aspect="atleast"',);
        expect(html,).toContain(`background-image:url('https://site/uploads/a.jpg')`,);
    },);
    it('original aspect with no height shows the picture at its natural height', () => {
        const html = galleryEmailHtml([item(),], 'https://site', { desktop: { columns: 3, aspect: 'original', }, },);
        expect(html,).toMatch(/<img [^>]*width="188"[^>]*height:auto/,);
        expect(html,).not.toContain('background-image',);
    },);
    it('every item links to its gallery page, whatever the on-click option', () => {
        for (const open of ['lightbox', 'page', 'none',] as const) {
            const html = galleryEmailHtml([item(),], 'https://site', { open, },);
            expect(html,).toContain('href="https://site/gallery/a1"',);
        }
    },);
    it('a video is its poster linked to the item page, with the Watch bar ON it', () => {
        const html = galleryEmailHtml([item({ mediaType: 'video', },),], 'https://site', { desktop: { layout: 'column', }, },);
        expect(html,).toContain('<a href="https://site/gallery/a1"',);
        expect(html,).toContain('class="email-watch-bar"',);
        expect(html,).toMatch(/>Watch<\/span>/,);
        expect(html,).toContain('border-radius:0 0 8px 8px',);
        expect(html,).not.toContain('/api/v1/video/m1/file',);
    },);
    it('item radius on every item: empty → site radius, 0 → square, 12px', () => {
        const rad = (s: Record<string, unknown>, site?: string,) => galleryEmailHtml([item(),], 'https://site', { desktop: { aspect: 'original', }, ...s, }, { siteRadius: site, },);
        expect(rad({}, '5px',),).toContain('border-radius:5px;',);
        expect(rad({ itemRadius: '0', }, '5px',),).toContain('border-radius:0px;',);
        expect(rad({ itemRadius: '12px', }, '5px',),).toContain('border-radius:12px;',);
    },);
    it('titles and captions only when asked', () => {
        expect(galleryEmailHtml([item(),], 'https://site',),).not.toContain('Over the bay',);
        expect(galleryEmailHtml([item(),], 'https://site', { showCaptions: true, },),).toContain('Over the bay',);
    },);
    it('refuses CSS that could escape a declaration', () => {
        expect(galleryEmailHtml([item(),], 'https://site', { itemRadius: '4px;}x{', },),).not.toContain('}x{',);
    },);
},);

describe('horizontalPadding (Gallery block width in email)', () => {
    it('reads left + right of a padding shorthand', () => {
        expect(horizontalPadding('16px',),).toBe(32,);
        expect(horizontalPadding('0 20px',),).toBe(40,);
        expect(horizontalPadding('1px 2px 3px 4px',),).toBe(6,);
        expect(horizontalPadding(undefined,),).toBe(0,);
    },);
},);

describe('gallery email alignment + size (block style)', () => {
    /** Inner row tables with their align + width. */
    const rows = (html: string,) => [...html.matchAll(/<td align="(\w+)" style="padding:0;"><table role="presentation" align="(\w+)" width="(\d+)"[^>]*margin:([^;]+);/g,),]
        .map((m,) => ({ td: m[1], align: m[2], width: Number(m[3],), margin: m[4], }));

    it('galleryEmailAlign: Horizontal Alignment, else Text Align, else centre', () => {
        expect(galleryEmailAlign({ horizontalAlign: 'right', textAlign: 'left', },),).toBe('right',);
        expect(galleryEmailAlign({ horizontalAlign: 'flex-start', },),).toBe('left',);
        expect(galleryEmailAlign({ textAlign: 'right', },),).toBe('right',);
        expect(galleryEmailAlign({ textAlign: 'justify', },),).toBe('center',);
        expect(galleryEmailAlign({},),).toBe('center',);
        expect(galleryEmailAlign(undefined,),).toBe('center',);
    },);

    it('column + fixed item width: each row is the item\'s width, centred / right-aligned', () => {
        const s = { desktop: { layout: 'column' as const, itemWidth: '450px', gap: '12px', }, };
        expect(galleryEmailPlan(s,),).toMatchObject({ columns: 1, itemWidth: 450, slotWidth: 462, width: 462, },);
        const center = rows(galleryEmailHtml(four(), 'https://site', s, { align: 'center', },),);
        expect(center.length,).toBe(4,);
        expect(center.every((r,) => r.width === 462 && r.align === 'center' && r.td === 'center' && r.margin === '0 auto'),).toBe(true,);
        const right = rows(galleryEmailHtml(four(), 'https://site', s, { align: 'right', },),);
        expect(right.every((r,) => r.align === 'right' && r.td === 'right' && r.margin === '0 0 0 auto'),).toBe(true,);
    },);

    it('grid narrower than the body (item width) is placed by the alignment', () => {
        const s = { desktop: { layout: 'grid' as const, columns: 2, itemWidth: '150px', gap: '10px', }, };
        expect(galleryEmailPlan(s,),).toMatchObject({ columns: 2, slotWidth: 160, width: 320, },);
        const center = rows(galleryEmailHtml(four(), 'https://site', s,),); // default centre
        expect(center.map((r,) => [r.align, r.width,]),).toEqual([['center', 320,], ['center', 320,],],);
        const left = rows(galleryEmailHtml(four(), 'https://site', s, { align: 'left', },),);
        expect(left.every((r,) => r.align === 'left' && r.margin === '0 auto 0 0'),).toBe(true,);
    },);

    it('titles follow Text Align', () => {
        const html = galleryEmailHtml([item(),], 'https://site', { showTitles: true, desktop: { layout: 'grid', }, }, { textAlign: 'right', },);
        expect(html,).toMatch(/font-weight:bold;[^"]*text-align:right;/,);
        // Unset: a grid stays left.
        expect(galleryEmailHtml([item(),], 'https://site', { showTitles: true, },),).toMatch(/font-weight:bold;[^"]*text-align:left;/,);
    },);

    it('Gallery block: style maxWidth sizes the gallery, horizontalAlign places it', () => {
        const ctx = { siteUrl: 'https://site', siteRadius: '', textColor: '#333333', palette: [], } as unknown as EmailRenderCtx;
        const node = (style: Record<string, unknown>,): EmailBlockNode => ({
            id: 'g1', blockType: 'gallery', children: [], style,
            settings: { desktop: { layout: 'column', gap: '0', }, [GALLERY_RESOLVED_KEY]: [item(),], },
        });
        const html = (style: Record<string, unknown>,) => {
            const out = renderGallery(node(style,), ctx,);
            return typeof out === 'string' ? out : out.content ?? '';
        };
        // max-width 400 − 2 × 16px default padding = 368, one column → a 368px row, centred.
        const c = rows(html({ maxWidth: '400px', horizontalAlign: 'center', margin: 'auto', },),);
        expect(c,).toEqual([{ td: 'center', align: 'center', width: 368, margin: '0 auto', },],);
        const r = rows(html({ maxWidth: '400px', horizontalAlign: 'right', },),);
        expect(r[0],).toMatchObject({ align: 'right', width: 368, },);
    },);
},);

describe('gallery email: hug items hug their media', () => {
    const portrait = (over = {},) => {
        const it = item({ mediaType: 'video', ...over, },);
        it.media = { ...it.media!, width: 1080, height: 1920, };
        return it;
    };
    const landscape = () => {
        const it = item({ mediaType: 'video', },);
        it.media = { ...it.media!, width: 1920, height: 1080, };
        return it;
    };
    const s = { desktop: { layout: 'column' as const, itemHeight: '300px', fit: 'hug' as const, gap: '12px', aspect: '16:9' as const, }, itemRadius: '15px', };
    const mediaCell = (html: string,) => /<td class="gallery-item-media"[^>]*>/.exec(html,)?.[0] ?? '';

    it('galleryContainSize fits the media inside the box', () => {
        expect(galleryContainSize(588, 300, 1080 / 1920,),).toEqual({ width: 168, height: 299, },);
        expect(galleryContainSize(588, 300, 16 / 9,),).toEqual({ width: 533, height: 300, },);
        expect(galleryContainSize(400, 300, 16 / 9,),).toEqual({ width: 400, height: 225, },);
    },);
    it('a portrait video is the media size, radius on it, no background colour', () => {
        const html = galleryEmailHtml([portrait(),], 'https://site', s,);
        const cell = mediaCell(html,);
        expect(cell,).toContain('width="168" height="299"',);
        expect(cell,).toContain('border-radius:15px',);
        expect(cell,).not.toMatch(/bgcolor|background-color/,);
        expect(cell,).toContain('background-size:cover',);
        // The Watch bar sits inside the media-sized cell: its width is the media's.
        expect(html,).toMatch(/<table role="presentation" width="168"[^>]*>.*email-watch-bar/,);
        expect(html,).toContain('border-radius:0 0 15px 15px',);
    },);
    it('a landscape video fits the height limit', () => {
        expect(mediaCell(galleryEmailHtml([landscape(),], 'https://site', s,),),).toContain('width="533" height="300"',);
    },);
    it('a contain image is an <img> at the media size', () => {
        const img = item();
        img.media = { ...img.media!, width: 600, height: 1200, };
        const html = galleryEmailHtml([img,], 'https://site', s,);
        expect(html,).toMatch(/<img class="gallery-item-media"[^>]*width="150" height="300"[^>]*border-radius:15px/,);
        expect(html,).not.toMatch(/bgcolor|background-color|background-image/,);
    },);
    it('cover keeps the fixed box, still no background colour', () => {
        const html = galleryEmailHtml([portrait(),], 'https://site', { ...s, desktop: { ...s.desktop, fit: 'cover', }, },);
        const cell = mediaCell(html,);
        expect(cell,).toContain('width="588" height="300"',);
        expect(cell,).toContain('background-size:cover',);
        expect(cell,).not.toMatch(/bgcolor|background-color/,);
    },);
    it('unknown aspect: the picture scaled inside the limits, no box', () => {
        const v = item({ mediaType: 'video', },);
        v.media = { ...v.media!, width: null, height: null, };
        const html = galleryEmailHtml([v,], 'https://site', s,);
        expect(html,).not.toContain('background-image',);
        expect(html,).toMatch(/<img class="gallery-item-media"[^>]*max-height:300px/,);
        expect(html,).toContain('email-watch-bar',);
        expect(html,).not.toMatch(/bgcolor="#(?!000000)|background-color:#000000;background-image/,);
    },);
    it('a hugging item is placed per the alignment', () => {
        const html = galleryEmailHtml([portrait(),], 'https://site', s, { align: 'right', },);
        expect(html,).toMatch(/<table role="presentation" width="168"[^>]*margin:0 0 0 auto/,);
    },);
},);

describe('gallery email: masonry', () => {
    /** An item with its own media size (`w`×`h`; 0 = unknown). */
    const sized = (id: string, w: number, h: number, over: Partial<GalleryItem> & { mediaType?: 'image' | 'video'; } = {},) => {
        const i = item({ id, ...over, },);
        return { ...i, media: { ...i.media!, width: w || null, height: h || null, }, } as GalleryItem;
    };
    const masonry = (over: Record<string, unknown> = {},) => ({ desktop: { layout: 'masonry' as const, gap: '0px', ...over, }, });
    /** Item ids per column cell, in order. */
    const columnsOf = (html: string,) =>
        html.split('class="gallery-masonry-col"',).slice(1,).map((c,) => [...c.matchAll(/\/gallery\/([a-z0-9]+)"/g,),].map((m,) => m[1],).filter((v, k, a,) => a.indexOf(v,) === k,),);

    it('plan: columns (default 3, at most 4), natural height, no box', () => {
        expect(galleryEmailPlan(masonry(),),).toMatchObject({ mode: 'masonry', columns: 3, itemHeight: null, fit: 'cover', },);
        expect(galleryEmailPlan(masonry({ columns: 2, },),).columns,).toBe(2,);
        expect(galleryEmailPlan(masonry({ columns: 6, },),).columns,).toBe(4,);
        expect(galleryEmailPlan(masonry({ itemWidth: '180px', },),).columns,).toBe(3,);
        expect(galleryEmailPlan(masonry({ columns: 3, itemHeight: '200px', aspect: 'square', },),).itemHeight,).toBeNull();
    },);

    it('one row of N column cells, each item in the currently-shortest column', () => {
        // 2 columns of 300px: a (tall 1:2 → 600) left, b (2:1 → 150) right,
        // c right (150 < 600), d right (300 < 600), e right (450 < 600), f right? 600 = 600 → leftmost.
        const list = [sized('a', 100, 200,), sized('b', 200, 100,), sized('c', 200, 100,), sized('d', 200, 100,), sized('e', 200, 100,), sized('f', 200, 100,),];
        const html = galleryEmailHtml(list, 'https://s', masonry({ columns: 2, },),);
        expect(html,).toContain('gallery-grid--masonry',);
        expect(columnsOf(html,),).toEqual([['a', 'f',], ['b', 'c', 'd', 'e',],],);
        expect((html.match(/class="gallery-masonry-col" width="300" valign="top"/g,) ?? []).length,).toBe(2,);
    },);

    it('items at their natural aspect: width = column width, height from the aspect (Outlook attributes)', () => {
        const html = galleryEmailHtml([sized('a', 400, 600,), sized('b', 800, 400,),], 'https://s', masonry({ columns: 2, },),);
        expect(html,).toContain('width="300" height="450"',);
        expect(html,).toContain('width="300" height="150"',);
    },);

    it('unknown aspect counts as square for placement and keeps a natural-height picture', () => {
        const list = [sized('a', 0, 0,), sized('b', 300, 300,), sized('c', 300, 600,),];
        const html = galleryEmailHtml(list, 'https://s', masonry({ columns: 2, },),);
        expect(columnsOf(html,),).toEqual([['a', 'c',], ['b',],],);
        expect(html,).toMatch(/src="https:\/\/s\/uploads\/a\.jpg" alt="[^"]*" width="300" style/,);
    },);

    it('videos carry the Watch bar; radius, titles and links like the other modes', () => {
        const html = galleryEmailHtml([sized('v', 1600, 900, { mediaType: 'video', },),], 'https://s', { ...masonry({ columns: 1, },), itemRadius: '10px', showTitles: true, },);
        expect(html,).toContain('Watch',);
        expect(html,).toContain('height="338"',);
        expect(html,).toContain('border-radius:10px',);
        expect(html,).toContain('href="https://s/gallery/v"',);
        expect(html,).toContain('Sunset &lt;b&gt;',);
    },);

    it('gap becomes item padding; a narrower box is placed by the alignment', () => {
        const html = galleryEmailHtml([sized('a', 100, 100,),], 'https://s', masonry({ columns: 2, gap: '20px', itemWidth: '150px', },), { align: 'right', },);
        expect(html,).toContain('padding:10px;vertical-align:top',);
        expect(html,).toContain('align="right" width="340"',);
    },);
},);

describe('gallery email: contain + title placement', () => {
    it('contain: the whole picture centred in a box the same size for every item', () => {
        const html = galleryEmailHtml([item(),], 'https://site', { desktop: { columns: 2, itemHeight: '150px', fit: 'contain', gap: '0', }, },);
        expect(html,).toMatch(/<td align="center" valign="middle" height="150"/,);
        expect(html,).toContain('width="200" height="150"',); // 800×600 fitted in 300×150
        expect(html,).not.toContain('background-size:cover',);
    },);
    it('title above the picture', () => {
        const html = galleryEmailHtml([item(),], 'https://site', { showTitles: true, titlePosition: 'above', desktop: { columns: 1, }, },);
        expect(html.indexOf('Sunset',),).toBeLessThan(html.indexOf('gallery-item-media',),);
    },);
    it('title on the picture (bottom): inside the background cell, white, aligned', () => {
        const html = galleryEmailHtml([item(),], 'https://site', {
            showTitles: true, titlePosition: 'overlay-bottom', titleAlign: 'right', desktop: { columns: 2, itemHeight: '150px', fit: 'cover', },
        },);
        const cellAt = html.indexOf('class="gallery-item-media"',);
        expect(cellAt,).toBeGreaterThan(-1,);
        expect(html.indexOf('Sunset',),).toBeGreaterThan(cellAt,);
        expect(html,).toContain('color:#ffffff;text-align:right',);
        expect(html,).toContain('valign="bottom" style="padding:0"',);
    },);
    it('on the picture with an unknown size: falls back to below', () => {
        const it2 = item({ media: { ...item().media!, width: null, height: null, }, },);
        const html = galleryEmailHtml([it2,], 'https://site', { showTitles: true, titlePosition: 'overlay-top', desktop: { columns: 1, aspect: 'original', }, },);
        expect(html.indexOf('Sunset',),).toBeGreaterThan(html.indexOf('gallery-item-media',),);
        expect(html,).not.toContain('linear-gradient',);
    },);
});
