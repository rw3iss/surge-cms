/**
 * A Video block's poster must stay inside the block's box in email.
 *
 * Two separate settings were ignored, each for its own reason:
 *   - the block's own Max Height PROPERTY (`settings.maxHeight`, a bare number
 *     meaning px) — `renderVideo` never read it;
 *   - a max-height from the block STYLE, incl. an assigned style template
 *     (inlined into `node.style` by `populateBlockStyles`) — the cell style
 *     dropped `maxHeight`, and the poster was a fixed `width="600"` regardless.
 * Email has no cascade and Outlook ignores max-height, so the poster has to
 * carry the numbers itself, as attributes too.
 */
import { TYPOGRAPHY_DEFAULTS, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { DEFAULT_VIDEO_RADIUS, fitMedia, mediaBox, pxValue, } from './_util';
import { type EmailBlockNode, type EmailRenderCtx, renderNode, } from './index';
import { VIDEO_MEDIA_SIZE_KEY, VIDEO_MEDIA_TITLE_KEY, } from './video';

const CTX: EmailRenderCtx = {
    siteName: 'Test', siteUrl: 'https://test.example', palette: {}, fontFamily: 'Arial',
    textColor: '#111', bgColor: '#fff', linkColor: '#00e', typography: TYPOGRAPHY_DEFAULTS,
};

const video = (settings: Record<string, unknown>, style: Record<string, unknown> = {},): EmailBlockNode => ({
    id: 'v1', blockType: 'video',
    settings: { posterUrl: 'https://x.test/p.jpg', url: 'https://x.test/v', ...settings, },
    style, children: [],
});
const img = (html: string,) => /<img[^>]*>/.exec(html,)?.[0] ?? '';
const cell = (html: string,) => /<td [^>]*style="([^"]*)"/.exec(html,)?.[1] ?? '';
const landscape = { [VIDEO_MEDIA_SIZE_KEY]: { width: 1920, height: 1080, }, };
const portrait = { [VIDEO_MEDIA_SIZE_KEY]: { width: 1080, height: 1920, }, };

describe('pxValue', () => {
    it('reads bare numbers and px as pixels', () => {
        expect(pxValue('300',),).toBe(300,);
        expect(pxValue(300,),).toBe(300,);
        expect(pxValue('300px',),).toBe(300,);
        expect(pxValue(' 12.6px ',),).toBe(13,);
    });
    it('refuses units email cannot resolve', () => {
        for (const v of ['50%', '20vh', '2em', 'auto', '', null, undefined, 0,]) expect(pxValue(v,),).toBeNull();
    });
});

describe('mediaBox / fitMedia', () => {
    it('keeps the tightest cap from settings and style', () => {
        const box = mediaBox(video({ maxHeight: '400', }, { maxHeight: '300px', height: '100%', },),);
        expect(box,).toEqual({ maxWidth: 600, maxHeight: 300, },);
    });
    it('fits a landscape video by width and a portrait one by height', () => {
        expect(fitMedia({ maxWidth: 600, maxHeight: 300, }, 16 / 9,),).toEqual({ width: 533, height: 300, },);
        expect(fitMedia({ maxWidth: 600, maxHeight: 2000, }, 16 / 9,),).toEqual({ width: 600, height: 338, },);
        expect(fitMedia({ maxWidth: 600, maxHeight: 300, }, 9 / 16,),).toEqual({ width: 168, height: 299, },);
    });
    it('without an aspect ratio sets only the height', () => {
        expect(fitMedia({ maxWidth: 600, maxHeight: 300, }, null,),).toEqual({ width: null, height: 300, },);
    });
});

/** The poster cell of the overlay layout (poster as the cell background). */
const posterCell = (html: string,) => /<td background="[^"]*"[^>]*>/.exec(html,)?.[0] ?? '';

describe('renderVideo max height', () => {
    it('honours the block PROPERTY max height (bare number = px)', () => {
        const td = posterCell(renderNode(video({ maxHeight: '300', ...landscape, },), CTX,),);
        expect(td,).toContain('height="300"',);
        expect(td,).toContain('width="533"',);
        expect(td,).not.toContain('width="600"',);
    });

    it('honours a numeric property max height (size unknown → capped <img>)', () => {
        expect(img(renderNode(video({ maxHeight: 300, },), CTX,),),).toContain('max-height:300px',);
    });

    it('honours a STYLE TEMPLATE max height (inlined into node.style)', () => {
        // What populateBlockStyles turns `{ id }` into: the template's props, id kept.
        const html = renderNode(video(portrait, { id: 'tpl-1', maxHeight: '300px', },), CTX,);
        const td = posterCell(html,);
        expect(td,).toContain('height="299"',);
        expect(td,).toContain('width="168"',);
        expect(cell(html,),).toContain('max-height:300px',);
    });

    it('honours a per-block style height', () => {
        const tag = img(renderNode(video({}, { height: '250px', },), CTX,),);
        expect(tag,).toContain('max-height:250px',);
        expect(tag,).toContain('height="250"',);
        expect(tag,).toContain('width:auto',);
    });

    it('centres the poster', () => {
        expect(renderNode(video({ maxHeight: '300', ...landscape, },), CTX,),).toMatch(/class="email-video" align="center"/,);
    });

    it('honours the property max width', () => {
        const td = posterCell(renderNode(video({ maxWidth: '400', ...landscape, },), CTX,),);
        expect(td,).toContain('width="400"',);
        expect(td,).toContain('height="225"',);
    });

    it('caps the no-poster placeholder too', () => {
        const html = renderNode(video({ posterUrl: undefined, maxHeight: '100', },), CTX,);
        expect(html,).toContain('max-height:100px',);
    });

    it('fills the column when nothing caps it', () => {
        const td = posterCell(renderNode(video(landscape,), CTX,),);
        expect(td,).toContain('width="600"',);
        expect(td,).toContain('height="338"',);
    });
});

describe('renderVideo links', () => {
    it('a library video links to the site watch page, never the CDN file', () => {
        const html = renderNode(video({
            mediaId: 'b7d0c1a2-1111-4222-8333-944455556666',
            url: 'https://cdn.surgemedia.us/video/b7d0c1a2-1111-4222-8333-944455556666/abc-secret/downloads/1080p.mp4',
            ...landscape,
        },), CTX,);
        expect(html,).toContain('href="https://test.example/watch/b7d0c1a2-1111-4222-8333-944455556666"',);
        expect(html,).not.toContain('cdn.surgemedia.us/video',);
        expect(html,).not.toContain('.mp4"',);
    });

    it('a library video FILE URL without a mediaId still goes to the watch page', () => {
        const html = renderNode(video({ url: '/api/v1/video/b7d0c1a2-1111-4222-8333-944455556666/file', },), CTX,);
        expect(html,).toContain('href="https://test.example/watch/b7d0c1a2-1111-4222-8333-944455556666"',);
    });

    it('a YouTube URL stays the provider page', () => {
        const html = renderNode(video({ url: 'https://www.youtube.com/watch?v=abc', },), CTX,);
        expect(html,).toContain('href="https://www.youtube.com/watch?v=abc"',);
    });

    it('the image block rewrites a library-video link but keeps an operator link', () => {
        const node = (link: string,): EmailBlockNode => ({
            id: 'i2', blockType: 'image', settings: { images: [{ url: 'https://x.test/i.png', link, },], }, style: {}, children: [],
        });
        expect(renderNode(node('https://cdn.x/video/b7d0c1a2-1111-4222-8333-944455556666/e-s/downloads/720p.mp4',), CTX,),)
            .toContain('href="https://test.example/watch/b7d0c1a2-1111-4222-8333-944455556666"',);
        expect(renderNode(node('https://elsewhere.test/page',), CTX,),).toContain('href="https://elsewhere.test/page"',);
    });
});

describe('renderVideo title', () => {
    it('is hidden by default', () => {
        expect(renderNode(video({ title: 'My clip', },), CTX,),).not.toContain('email-video-title',);
    });

    it('shows the media title, centred, above the video when on', () => {
        const html = renderNode(video({ showTitle: true, title: 'Block title', [VIDEO_MEDIA_TITLE_KEY]: 'Media title', ...landscape, },), CTX,);
        const m = /<div class="email-video-title" style="([^"]*)">([^<]*)<\/div>/.exec(html,);
        expect(m?.[2],).toBe('Media title',);
        expect(m?.[1],).toContain('text-align:center',);
        expect(html.indexOf('email-video-title',),).toBeLessThan(html.indexOf('class="email-video"',),);
    });

    it('falls back to the block title', () => {
        expect(renderNode(video({ showTitle: true, title: 'Block title', },), CTX,),).toContain('>Block title</div>',);
    });
});

describe('renderVideo watch overlay', () => {
    it('layers a "Watch" bar on the poster (background cell + VML), one link', () => {
        const html = renderNode(video(landscape,), CTX,);
        expect(html,).not.toContain('▶ Watch the video',);
        expect(posterCell(html,),).toContain("background-image:url('https://x.test/p.jpg')",);
        expect(html,).toContain('<v:fill type="frame" src="https://x.test/p.jpg"',);
        const bar = /<td class="email-watch-bar"[^>]*>/.exec(html,)?.[0] ?? '';
        expect(bar,).toContain('rgba(0,0,0,0.5)',);
        expect(bar,).toContain('bgcolor="#000000"',);
        expect(bar,).toContain('color:#ffffff',);
        expect(html,).toContain('&#9654;',);
        expect(html,).toMatch(/>Watch<\/span>/,);
        // The bar sits INSIDE the poster cell (an overlay), not after it.
        expect(html.indexOf('email-watch-bar',),).toBeGreaterThan(html.indexOf('<td background=',),);
        expect((html.match(/<a /g,) ?? []).length,).toBe(1,);
    });

    it('degrades to the bar directly under the picture when the size is unknown', () => {
        const html = renderNode(video({},), CTX,);
        expect(img(html,),).toBeTruthy();
        expect(html.indexOf('email-watch-bar',),).toBeGreaterThan(html.indexOf('<img',),);
    });
});

describe('renderVideo radius', () => {
    it('defaults to the admin preview radius on the poster and the bar bottom', () => {
        const html = renderNode(video(landscape,), CTX,);
        expect(posterCell(html,),).toContain(`border-radius:${DEFAULT_VIDEO_RADIUS}`,);
        expect(html,).toContain(`border-radius:0 0 ${DEFAULT_VIDEO_RADIUS} ${DEFAULT_VIDEO_RADIUS}`,);
        expect(img(renderNode(video({},), CTX,),),).toContain(`border-radius:${DEFAULT_VIDEO_RADIUS} ${DEFAULT_VIDEO_RADIUS} 0 0`,);
    });

    it('uses the block border radius when set', () => {
        const html = renderNode(video(landscape, { borderRadius: '20px', },), CTX,);
        expect(posterCell(html,),).toContain('border-radius:20px',);
        expect(html,).toContain('border-radius:0 0 20px 20px',);
    });
});

describe('image block max height', () => {
    it('caps the picture without stretching it', () => {
        const html = renderNode({
            id: 'i1', blockType: 'image', settings: { images: [{ url: 'https://x.test/i.png', },], },
            style: { maxHeight: '200px', }, children: [],
        }, CTX,);
        const tag = img(html,);
        expect(tag,).toContain('max-height:200px',);
        expect(tag,).toContain('height="200"',);
        expect(tag,).toContain('width:auto',);
    });
});
