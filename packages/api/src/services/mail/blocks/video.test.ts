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
import { fitMedia, mediaBox, pxValue, } from './_util';
import { type EmailBlockNode, type EmailRenderCtx, renderNode, } from './index';
import { VIDEO_MEDIA_SIZE_KEY, } from './video';

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

describe('renderVideo max height', () => {
    it('honours the block PROPERTY max height (bare number = px)', () => {
        const tag = img(renderNode(video({ maxHeight: '300', ...landscape, },), CTX,),);
        expect(tag,).toContain('max-height:300px',);
        expect(tag,).toContain('height="300"',);
        expect(tag,).toContain('width="533"',);
        expect(tag,).not.toContain('width="600"',);
    });

    it('honours a numeric property max height', () => {
        expect(img(renderNode(video({ maxHeight: 300, },), CTX,),),).toContain('max-height:300px',);
    });

    it('honours a STYLE TEMPLATE max height (inlined into node.style)', () => {
        // What populateBlockStyles turns `{ id }` into: the template's props, id kept.
        const html = renderNode(video(portrait, { id: 'tpl-1', maxHeight: '300px', },), CTX,);
        const tag = img(html,);
        expect(tag,).toContain('max-height:300px',);
        expect(tag,).toContain('height="299"',);
        expect(tag,).toContain('width="168"',);
        expect(cell(html,),).toContain('max-height:300px',);
    });

    it('honours a per-block style height', () => {
        const tag = img(renderNode(video({}, { height: '250px', },), CTX,),);
        expect(tag,).toContain('max-height:250px',);
        expect(tag,).toContain('height="250"',);
        expect(tag,).toContain('width:auto',);
    });

    it('centres the capped poster', () => {
        expect(img(renderNode(video({ maxHeight: '300', },), CTX,),),).toContain('margin:0 auto',);
    });

    it('honours the property max width', () => {
        const tag = img(renderNode(video({ maxWidth: '400', ...landscape, },), CTX,),);
        expect(tag,).toContain('width="400"',);
        expect(tag,).toContain('height="225"',);
    });

    it('caps the no-poster placeholder too', () => {
        const html = renderNode(video({ posterUrl: undefined, maxHeight: '100', },), CTX,);
        expect(html,).toContain('max-height:100px',);
    });

    it('is unchanged when nothing caps it', () => {
        expect(img(renderNode(video(landscape,), CTX,),),).toBe(
            '<img src="https://x.test/p.jpg" alt="Watch the video" width="600" style="display:block;max-width:100%;border:0" />',
        );
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
