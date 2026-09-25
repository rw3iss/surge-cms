/**
 * Border radius and per-block Custom CSS, end to end through the email
 * renderer.
 *
 * The unit tests next door pin the CSS translation. These pin the WIRING —
 * that a radius set in the style panel reaches the cell, and that each of the
 * three Custom CSS delivery groups ends up in the part of the message it was
 * sorted into. Wiring is what silently goes missing when a renderer is
 * refactored; the translation has tests that would still pass.
 */
import { type SiteBreakpoint, TYPOGRAPHY_DEFAULTS, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { type EmailBlockNode, type EmailRenderCtx, renderNode, } from './blocks/index';
import { buildEmailResponsiveCss, } from './blocks/responsiveCss';

const CTX: EmailRenderCtx = {
    siteName: 'Test',
    siteUrl: 'https://test.example',
    palette: { brand: '#ED2024', },
    fontFamily: 'Arial, sans-serif',
    textColor: '#111111',
    bgColor: '#ffffff',
    linkColor: '#0000ee',
    typography: TYPOGRAPHY_DEFAULTS,
};

const MOBILE: SiteBreakpoint = { id: 'mobile', name: 'Mobile', maxWidth: '768', };

/** A minimal html block — its content passes through verbatim. */
const node = (style: Record<string, unknown>, content = '<p>Hello</p>',): EmailBlockNode => ({
    id: 'b1',
    blockType: 'html',
    settings: { content, },
    style,
    children: [],
});

/** The `style="…"` of the wrapping `<td>`. */
const cellStyle = (html: string,) => /<td [^>]*style="([^"]*)"/.exec(html,)?.[1] ?? '';

describe('border radius in email', () => {
    it('reaches the block cell', () => {
        expect(cellStyle(renderNode(node({ borderRadius: '8px', },), CTX,),),)
            .toContain('border-radius:8px',);
    });

    it('accepts a multi-value radius verbatim', () => {
        expect(cellStyle(renderNode(node({ borderRadius: '8px 0 8px 0', },), CTX,),),)
            .toContain('border-radius:8px 0 8px 0',);
    });

    it('is absent when unset, rather than emitting an empty declaration', () => {
        expect(cellStyle(renderNode(node({ padding: '4px', },), CTX,),),)
            .not.toContain('border-radius',);
    });

    it('does NOT drag `overflow:hidden` along, unlike the web renderer', () => {
        // `overflow` on a table cell is not something mail clients implement,
        // so it would be dead weight in every message.
        expect(cellStyle(renderNode(node({ borderRadius: '8px', },), CTX,),),)
            .not.toContain('overflow',);
    });

    it('is overridable per breakpoint from the head <style>', () => {
        const css = buildEmailResponsiveCss(
            [{ id: 'b1', blockType: 'html', style: { breakpoints: { mobile: { borderRadius: '0', }, }, }, },],
            [MOBILE,],
            {},
        );
        expect(css,).toContain('border-radius:0 !important',);
        expect(css,).toContain('@media (max-width:768px)',);
    });
});

describe('custom CSS in email — the cell group', () => {
    it('inlines `&` declarations onto the block cell', () => {
        const html = renderNode(node({ customCss: '& { padding: 0; background: #eee }', },), CTX,);
        expect(cellStyle(html,),).toContain('padding:0',);
        expect(cellStyle(html,),).toContain('background:#eee',);
    });

    it('overrides the style panel, not the other way round', () => {
        // Custom CSS closes the block's cascade layer on the web. Email has to
        // reach the same answer by merge order.
        const html = renderNode(node({ padding: '30px', customCss: '& { padding: 0 }', },), CTX,);
        expect(cellStyle(html,),).toContain('padding:0',);
        expect(cellStyle(html,),).not.toContain('padding:30px',);
    });

    it('overrides a renderer-supplied cell style too', () => {
        // Spacer sets its own height via `cellStyle`; the operator still wins.
        const spacer: EmailBlockNode = {
            id: 'b1',
            blockType: 'spacer',
            settings: { height: 40, },
            style: { customCss: '& { height: 4px }', },
            children: [],
        };
        expect(cellStyle(renderNode(spacer, CTX,),),).toContain('height:4px',);
    });
});

describe('custom CSS in email — the inline group', () => {
    it("inlines a simple element rule onto the block's own markup", () => {
        const html = renderNode(node({ customCss: 'p { color: red }', },), CTX,);
        expect(html,).toContain('<p style="color:red">Hello</p>',);
    });

    it('leaves the cell style untouched by an element rule', () => {
        const html = renderNode(node({ customCss: 'p { color: red }', },), CTX,);
        expect(cellStyle(html,),).not.toContain('color:red',);
    });

    it('produces no head <style> for a rule it could inline', () => {
        // Anything inlined is already delivered; repeating it in a stylesheet
        // most clients ignore is pure weight.
        const css = buildEmailResponsiveCss(
            [{ id: 'b1', blockType: 'html', style: { customCss: 'p { color: red }', }, },],
            [MOBILE,],
            {},
        );
        expect(css,).toBe('',);
    });
});

describe('custom CSS in email — the stylesheet group', () => {
    it('sends what cannot be inlined to the head <style>, scoped and important', () => {
        const css = buildEmailResponsiveCss(
            [{ id: 'b1', blockType: 'html', style: { customCss: 'div p:hover { color: red }', }, },],
            [MOBILE,],
            {},
        );
        expect(css,).toContain('[data-block-id="b1"] div p:hover',);
        expect(css,).toContain('color:red !important',);
    });

    it('emits the head <style> even with no breakpoints configured', () => {
        // The old guard returned early on an empty breakpoint list, which would
        // have swallowed every block's base custom CSS on a site that never
        // defined one.
        const css = buildEmailResponsiveCss(
            [{ id: 'b1', blockType: 'html', style: { customCss: 'a:hover { color: red }', }, },],
            [],
            {},
        );
        expect(css,).toContain('[data-block-id="b1"] a:hover',);
    });

    it("puts a breakpoint's custom CSS inside that breakpoint's @media", () => {
        const css = buildEmailResponsiveCss(
            [{
                id: 'b1',
                blockType: 'html',
                style: { breakpoints: { mobile: { customCss: 'p { color: red }', }, }, },
            },],
            [MOBILE,],
            {},
        );
        expect(css,).toContain('@media (max-width:768px)',);
        expect(css,).toContain('[data-block-id="b1"] p',);
        expect(css,).toContain('color:red !important',);
    });

    it("does NOT inline a breakpoint's custom CSS onto the markup", () => {
        // An inline style carries no media condition, so inlining a mobile rule
        // would apply it on the desktop too.
        const html = renderNode(
            node({ breakpoints: { mobile: { customCss: 'p { color: red }', }, }, },),
            CTX,
        );
        expect(html,).toContain('<p>Hello</p>',);
        expect(html,).not.toContain('color:red',);
    });

    it('orders unconditional rules before the media queries', () => {
        const css = buildEmailResponsiveCss(
            [{
                id: 'b1',
                blockType: 'html',
                style: {
                    customCss: 'div p:hover { color: red }',
                    breakpoints: { mobile: { customCss: 'div p:hover { color: blue }', }, },
                },
            },],
            [MOBILE,],
            {},
        );
        expect(css.indexOf('color:red',),).toBeLessThan(css.indexOf('@media',),);
        expect(css,).toContain('color:blue !important',);
    });

    it("keeps one block's rules off another block", () => {
        const css = buildEmailResponsiveCss(
            [
                { id: 'b1', blockType: 'html', style: { customCss: 'div p:hover { color: red }', }, },
                { id: 'b2', blockType: 'html', style: {}, },
            ],
            [],
            {},
        );
        expect(css,).toContain('[data-block-id="b1"] div p:hover',);
        expect(css,).not.toContain('[data-block-id="b2"]',);
        expect(css,).not.toMatch(/(^|[{};])\s*div p\s*\{/,);
    });

    it('emits nothing at all when no block has custom CSS or overrides', () => {
        expect(buildEmailResponsiveCss([{ id: 'b1', blockType: 'html', style: {}, },], [MOBILE,], {},),)
            .toBe('',);
    });
});

describe('border radius reaches the MEDIA, not just the cell', () => {
    /*
     * The bug this pins: a social block with Border Radius set rendered a
     * square thumbnail in email. The radius was on the wrapping <td>, which has
     * no background of its own, so nothing visible changed — and `overflow`,
     * which does the clipping on the web, is not implemented on a table cell by
     * any mail client. The element the reader actually sees has to carry it.
     */
    const mediaNode = (
        blockType: string,
        settings: Record<string, unknown>,
        style: Record<string, unknown>,
    ): EmailBlockNode => ({ id: 'b1', blockType, settings, style, children: [], });

    const CASES: Array<[string, Record<string, unknown>,]> = [
        ['social', { items: [{ postUrl: 'https://x.test/1', thumbnailUrl: 'https://x.test/t.jpg', },], },],
        ['image', { images: [{ url: 'https://x.test/i.png', },], },],
        ['video', { posterUrl: 'https://x.test/p.jpg', url: 'https://x.test/v', },],
        ['carousel', { slides: [{ imageUrl: 'https://x.test/s.jpg', link: 'https://x.test', },], },],
        ['url_link', { url: 'https://x.test', image: 'https://x.test/o.png', },],
    ];

    it.each(CASES,)('%s puts the block radius on its <img>', (type, settings,) => {
        const html = renderNode(mediaNode(type, settings, { borderRadius: '15px', },), CTX,);
        const img = /<img[^>]*>/.exec(html,)?.[0] ?? '';
        expect(img, `${type} emitted no <img>`,).not.toBe('',);
        expect(img,).toContain('border-radius:15px',);
    },);

    it.each(CASES,)('%s leaves its own default alone when no radius is set', (type, settings,) => {
        // An untouched email must be byte-identical to before this change.
        const img = /<img[^>]*>/.exec(renderNode(mediaNode(type, settings, {},), CTX,),)?.[0] ?? '';
        expect(img,).not.toContain('border-radius:15px',);
    },);

    it('social keeps its 4px default, and the operator replaces it', () => {
        const [, settings,] = CASES[0];
        const plain = /<img[^>]*>/.exec(renderNode(mediaNode('social', settings, {},), CTX,),)![0];
        expect(plain,).toContain('border-radius:4px',);
        const rounded = /<img[^>]*>/.exec(
            renderNode(mediaNode('social', settings, { borderRadius: '15px', },), CTX,),
        )![0];
        expect(rounded,).toContain('border-radius:15px',);
        expect(rounded,).not.toContain('border-radius:4px',);
    });

    it('image emits NO radius when the block sets none', () => {
        // Unlike social, the image block never had a default — adding one would
        // silently round every existing image in every existing email.
        const [, settings,] = CASES[1];
        const img = /<img[^>]*>/.exec(renderNode(mediaNode('image', settings, {},), CTX,),)![0];
        expect(img,).not.toContain('border-radius',);
    });

    it('still puts the radius on the cell as well', () => {
        // Harmless where the cell has a background, and it is what a client
        // that ignores the image style would fall back to.
        const [, settings,] = CASES[0];
        const html = renderNode(mediaNode('social', settings, { borderRadius: '15px', },), CTX,);
        expect(cellStyle(html,),).toContain('border-radius:15px',);
    });

    it('rounds the video placeholder too when there is no poster', () => {
        const html = renderNode(
            mediaNode('video', { url: 'https://x.test/v', title: 'T', }, { borderRadius: '15px', },),
            CTX,
        );
        expect(html,).toContain('border-radius:15px',);
    });
});

describe('custom CSS reaches media inside a block', () => {
    it("inlines `td a img` onto a social block's thumbnail", () => {
        // The operator's own route to the same result, and the reason the email
        // inliner understands descendant combinators at all.
        const html = renderNode({
            id: 'b1',
            blockType: 'social',
            settings: { items: [{ postUrl: 'https://x.test/1', thumbnailUrl: 'https://x.test/t.jpg', },], },
            style: { customCss: 'td a img { border-radius: 15px }', },
            children: [],
        }, CTX,);
        const img = /<img[^>]*>/.exec(html,)![0];
        expect(img,).toContain('border-radius:15px',);
        expect(img,).not.toContain('border-radius:4px',);
    });

    it('does not put that rule in the head <style> once it is inlined', () => {
        const css = buildEmailResponsiveCss(
            [{ id: 'b1', blockType: 'social', style: { customCss: 'td a img { border-radius: 15px }', }, },],
            [],
            {},
        );
        expect(css,).toBe('',);
    });
});
