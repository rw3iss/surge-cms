import { describe, expect, it, } from 'vitest';
import type { SiteBreakpoint, } from '@sitesurge/types';
import { blockResponsiveCss, carouselPropTargets, } from './blockResponsiveCss';

const MOBILE: SiteBreakpoint = { id: 'mobile', name: 'Mobile', maxWidth: '768', };

const OPTS = {
    resolveFont: (v?: string,) => v,
    resolveHAlign: (v?: string,) => v,
    resolveColor: (v?: string,) => v,
};

const ID = 'blk-1';
const WRAPPER = `[data-block-id="${ID}"]`;

describe('blockResponsiveCss', () => {
    it('returns null without a block id, overrides, or breakpoints', () => {
        expect(blockResponsiveCss(undefined, { breakpoints: { mobile: { margin: '0', }, }, }, [MOBILE,], OPTS,),).toBeNull();
        expect(blockResponsiveCss(ID, {}, [MOBILE,], OPTS,),).toBeNull();
        expect(blockResponsiveCss(ID, { breakpoints: { mobile: { margin: '0', }, }, }, [], OPTS,),).toBeNull();
    },);

    it('puts every override on the wrapper for an ordinary block', () => {
        const css = blockResponsiveCss(
            ID,
            { breakpoints: { mobile: { margin: '0px', padding: '4px', textAlign: 'center', }, }, },
            [MOBILE,],
            OPTS,
        );
        expect(css,).toContain('@media (max-width:768px)',);
        expect(css,).toContain(`${WRAPPER}{`,);
        // One combined rule — no descendant selectors involved.
        expect(css,).not.toContain(`${WRAPPER} `,);
        expect(css,).toContain('margin:0px auto !important',);
        expect(css,).toContain('padding:4px !important',);
    },);

    describe('carousel targets follow each default', () => {
        // Regression: a carousel's default margin is inline on the WRAPPER, but
        // the override was emitted on the descendant `.hero-carousel`. On mobile
        // the wrapper therefore kept its desktop `margin: 0 15px` gutters and the
        // override was powerless, however `!important` it was.
        const cssFor = (override: Record<string, unknown>, contentCarousel = false,) =>
            blockResponsiveCss(
                ID,
                { breakpoints: { mobile: override, }, },
                [MOBILE,],
                OPTS,
                carouselPropTargets(contentCarousel,),
            ) ?? '';

        it('margin reaches the wrapper', () => {
            const css = cssFor({ margin: '0px', },);
            expect(css,).toContain(`${WRAPPER}{margin:0px auto !important}`,);
        },);

        it('margin also reaches the slide overlay on a media carousel', () => {
            // The default margin is ALSO applied there via --hero-content-margin.
            expect(cssFor({ margin: '0px', },),).toContain(`${WRAPPER} .hero-carousel__content{`,);
            // A content carousel has no overlay, so the wrapper is the only target.
            expect(cssFor({ margin: '0px', }, true,),).not.toContain('.hero-carousel__content',);
        },);

        it('width / max-width / max-height reach the wrapper', () => {
            const css = cssFor({ width: '50%', maxWidth: '600px', maxHeight: '400px', },);
            expect(css,).toContain('width:50% !important',);
            expect(css,).toContain('max-width:600px !important',);
            expect(css,).toContain('max-height:400px !important',);
            expect(css,).not.toContain('.hero-carousel{',);
        },);

        it('height stays on the carousel element, which owns it', () => {
            expect(cssFor({ height: '300px', },),).toContain(`${WRAPPER} .hero-carousel{height:300px !important}`,);
        },);

        it('min-height reaches BOTH places its default is applied', () => {
            const css = cssFor({ minHeight: '200px', },);
            expect(css,).toContain(`${WRAPPER}{min-height:200px !important}`,);
            expect(css,).toContain(`${WRAPPER} .hero-carousel{min-height:200px !important}`,);
        },);

        it('padding and alignment go to the slide overlay', () => {
            const css = cssFor({ padding: '15px 50px', textAlign: 'center', },);
            expect(css,).toContain(`${WRAPPER} .hero-carousel__content{`,);
            expect(css,).toContain('padding:15px 50px !important',);
            expect(css,).toContain('text-align:center !important',);
        },);

        it('a content carousel puts overlay props on the carousel element', () => {
            expect(cssFor({ padding: '8px', }, true,),).toContain(`${WRAPPER} .hero-carousel{padding:8px !important}`,);
        },);
    },);
},);
