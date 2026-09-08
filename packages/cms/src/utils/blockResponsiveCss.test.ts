import { describe, expect, it, } from 'vitest';
import type { SiteBreakpoint, } from '@sitesurge/types';
import { blockCss, blockResponsiveCss, carouselPropTargets, } from './blockResponsiveCss';

const MOBILE: SiteBreakpoint = { id: 'mobile', name: 'Mobile', maxWidth: '768', };

const OPTS = {
    resolveFont: (v?: string,) => v,
    resolveHAlign: (v?: string,) => v,
    resolveColor: (v?: string,) => v,
};

const ID = 'blk-1';
// The `.block` qualifier keeps these rules off the admin editor's
// `.content-block` container, which carries the same data-block-id.
const WRAPPER = `.block[data-block-id="${ID}"]`;

describe('blockResponsiveCss (breakpoint-only, legacy entry point)', () => {
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
        expect(css,).toContain('margin:0px auto',);
        expect(css,).toContain('padding:4px',);
    },);

    describe('carousel targets follow each default', () => {
        // Regression: a carousel's default margin lands on the WRAPPER, but the
        // override was once emitted on the descendant `.hero-carousel`. On mobile
        // the wrapper kept its desktop `margin: 0 15px` gutters and the override
        // was powerless — it was changing a different element.
        const cssFor = (override: Record<string, unknown>, contentCarousel = false,) =>
            blockResponsiveCss(
                ID,
                { breakpoints: { mobile: override, }, },
                [MOBILE,],
                OPTS,
                carouselPropTargets(contentCarousel,),
            ) ?? '';

        it('margin reaches the wrapper', () => {
            expect(cssFor({ margin: '0px', },),).toContain(`${WRAPPER}{margin:0px auto}`,);
        },);

        it('margin also reaches the slide overlay on a media carousel', () => {
            expect(cssFor({ margin: '0px', },),).toContain(`${WRAPPER} .hero-carousel__content{`,);
            // A content carousel has no overlay, so the wrapper is the only target.
            expect(cssFor({ margin: '0px', }, true,),).not.toContain('.hero-carousel__content',);
        },);

        it('width / max-width / max-height reach the wrapper', () => {
            const css = cssFor({ width: '50%', maxWidth: '600px', maxHeight: '400px', },);
            expect(css,).toContain('width:50%',);
            expect(css,).toContain('max-width:600px',);
            expect(css,).toContain('max-height:400px',);
            expect(css,).not.toContain('.hero-carousel{',);
        },);

        it('height stays on the carousel element, which owns it', () => {
            expect(cssFor({ height: '300px', },),).toContain(`${WRAPPER} .hero-carousel{height:300px}`,);
        },);

        it('min-height reaches BOTH places its default is applied', () => {
            const css = cssFor({ minHeight: '200px', },);
            expect(css,).toContain(`${WRAPPER}{min-height:200px}`,);
            expect(css,).toContain(`${WRAPPER} .hero-carousel{min-height:200px}`,);
        },);

        it('padding and alignment go to the slide overlay', () => {
            const css = cssFor({ padding: '15px 50px', textAlign: 'center', },);
            expect(css,).toContain(`${WRAPPER} .hero-carousel__content{`,);
            expect(css,).toContain('padding:15px 50px',);
            expect(css,).toContain('text-align:center',);
        },);

        it('a content carousel puts overlay props on the carousel element', () => {
            expect(cssFor({ padding: '8px', }, true,),).toContain(`${WRAPPER} .hero-carousel{padding:8px}`,);
        },);
    },);
},);

describe('blockCss (default + breakpoints, layered)', () => {
    it('returns null with no id or no style', () => {
        expect(blockCss(undefined, { margin: '4px', }, [MOBILE,], OPTS,),).toBeNull();
        expect(blockCss(ID, undefined, [MOBILE,], OPTS,),).toBeNull();
    },);

    it('emits the DEFAULT style with no @media, inside @layer block', () => {
        const css = blockCss(ID, { padding: '10px', textAlign: 'center', }, [MOBILE,], OPTS,) ?? '';
        expect(css,).toContain('@layer block{',);
        expect(css,).toContain('padding:10px',);
        expect(css,).not.toContain('@media',);
    },);

    it('emits breakpoint overrides into @layer block-bp, inside @media', () => {
        const css = blockCss(
            ID,
            { padding: '10px', breakpoints: { mobile: { padding: '4px', }, }, },
            [MOBILE,],
            OPTS,
        ) ?? '';
        expect(css,).toContain('@layer block{',);
        expect(css,).toContain('@layer block-bp{',);
        expect(css,).toContain('@media (max-width:768px)',);
        expect(css,).toContain('padding:4px',);
    },);

    it('NEVER emits !important — precedence comes from layer order', () => {
        // This is the requirement, not an incidental property: an `!important`
        // here would outrank a later layer and break template instance overrides.
        const css = blockCss(
            ID,
            {
                margin: '0 15px', padding: '10px', width: '50%', textAlign: 'left',
                breakpoints: { mobile: { margin: '0px', padding: '4px', }, },
            },
            [MOBILE,],
            OPTS,
            carouselPropTargets(false,),
        ) ?? '';
        expect(css,).not.toContain('!important',);
        expect(blockResponsiveCss(
            ID,
            { breakpoints: { mobile: { margin: '0px', }, }, },
            [MOBILE,],
            OPTS,
        ),).not.toContain('!important',);
    },);

    it('`defaultLayer` moves the default into the tpl layer, breakpoints stay in block-bp', () => {
        // How a template's inner blocks are emitted so a using block's own style
        // (layer `block`) wins without depending on document order.
        const css = blockCss(
            ID,
            { padding: '10px', breakpoints: { mobile: { padding: '4px', }, }, },
            [MOBILE,],
            OPTS,
            undefined,
            'tpl',
        ) ?? '';
        expect(css,).toContain('@layer tpl{',);
        expect(css,).not.toContain('@layer block{',);
        expect(css,).toContain('@layer block-bp{',);
    },);

    it('does not serialize the `breakpoints` bag as CSS declarations', () => {
        const css = blockCss(ID, { breakpoints: { mobile: { padding: '4px', }, }, }, [MOBILE,], OPTS,) ?? '';
        expect(css,).not.toContain('breakpoints:',);
        expect(css,).not.toContain('[object Object]',);
    },);

    describe('THE INVARIANT: a property\'s default and its override share a selector', () => {
        // This is what makes the carousel class of bug unrepresentable rather
        // than merely fixed. Both passes resolve through the same selectorsFor.
        const PROPS: Array<[string, Record<string, unknown>,]> = [
            ['margin', { margin: '4px', },],
            ['height', { height: '100px', },],
            ['min-height', { minHeight: '50px', },],
            ['width', { width: '30%', },],
            ['padding', { padding: '2px', },],
            ['text-align', { textAlign: 'center', },],
        ];

        /** Selectors used by a css string, in order of appearance. */
        const selectorsOf = (css: string,): string[] =>
            [...css.matchAll(/(\.block\[data-block-id="[^"]+"\][^{@]*)\{/g,),].map((m,) => m[1].trim());

        for (const contentCarousel of [false, true,]) {
            for (const [label, bag,] of PROPS) {
                it(`${label} (contentCarousel=${contentCarousel})`, () => {
                    const targets = carouselPropTargets(contentCarousel,);
                    const asDefault = blockCss(ID, bag, [MOBILE,], OPTS, targets,) ?? '';
                    const asOverride = blockCss(
                        ID,
                        { breakpoints: { mobile: bag, }, },
                        [MOBILE,],
                        OPTS,
                        targets,
                    ) ?? '';
                    // Unique selectors, not the raw sequence: an override is
                    // emitted TWICE — once under `@media` for the real
                    // viewport, once under `@container` for the editor's device
                    // preview. The invariant is about WHICH elements a property
                    // lands on, which is unchanged by emitting it in two
                    // at-rules.
                    const uniq = (css: string,) => [...new Set(selectorsOf(css,),),].sort();
                    expect(uniq(asDefault,),).toEqual(uniq(asOverride,),);
                    expect(uniq(asDefault,).length,).toBeGreaterThan(0,);
                },);
            }
        }
    },);
},);

describe('suppressHeight applies to the default pass only', () => {
    // Regression caught by the before/after visual diff: applying it to the
    // breakpoint pass too silently reverted a carousel to its desktop height on
    // mobile. A default height reaches the carousel as a component prop; a
    // per-breakpoint height has no such path, so this CSS is its only route.
    const opts = { ...OPTS, suppressHeight: true, };

    it('omits the default height but still emits the breakpoint height', () => {
        const css = blockCss(
            ID,
            { height: '320px', breakpoints: { mobile: { height: '200px', }, }, },
            [MOBILE,],
            opts,
            carouselPropTargets(false,),
        ) ?? '';
        expect(css,).not.toContain('height:320px',);
        expect(css,).toContain(`${WRAPPER} .hero-carousel{height:200px}`,);
    },);
},);

/**
 * The editor's device preview caps a container's width and leaves the viewport
 * alone, so a `@media` rule can never fire in it. Each breakpoint is therefore
 * emitted twice: once for the real viewport, once for that preview container.
 */
describe('container-query variant for the editor preview', () => {
    const bag = { breakpoints: { mobile: { padding: '4px', }, }, };

    it('emits the same declarations under @media AND @container', () => {
        const css = blockCss(ID, bag, [MOBILE,], OPTS,) ?? '';
        expect(css,).toContain('@media (max-width:768px)',);
        expect(css,).toContain('@container ss-bp (max-width:768px)',);
        // Two rules, same declaration.
        expect([...css.matchAll(/padding:4px/g,),].length,).toBe(2,);
    },);

    it('puts both in the block-bp layer, so a responsive rule still wins', () => {
        const css = blockCss(ID, bag, [MOBILE,], OPTS,) ?? '';
        const layer = /@layer block-bp\{([\s\S]*)\}$/.exec(css.trim(),)?.[1] ?? '';
        expect(layer,).toContain('@media',);
        expect(layer,).toContain('@container',);
    },);

    it('skips the container variant for a height-only breakpoint', () => {
        // The preview container is `container-type: inline-size`, which can only
        // answer inline-axis questions — a height query there would never match,
        // and emitting one that silently never fires is worse than none.
        const heightOnly = { id: 'tall', name: 'Tall', minHeight: '900', };
        const css = blockCss(ID, { breakpoints: { tall: { padding: '4px', }, }, }, [heightOnly,], OPTS,) ?? '';
        expect(css,).toContain('@media (min-height:900px)',);
        expect(css,).not.toContain('@container',);
    },);

    it('emits nothing extra for a block with no breakpoint overrides', () => {
        const css = blockCss(ID, { padding: '9px', }, [MOBILE,], OPTS,) ?? '';
        expect(css,).not.toContain('@container',);
        expect(css,).not.toContain('@media',);
    },);
},);
