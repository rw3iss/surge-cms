/**
 * The rich-text typography rules exist to be DEFAULTS. Two things make that
 * true, and both would fail silently if broken:
 *
 *   - they must cover the admin's contentEditable (`.rte-content`) as well as
 *     rendered output (`.rich-text`), or the editor shows one thing and the
 *     email delivers another
 *   - a block that sets its own font size / line height must still win
 */
import { describe, expect, it, } from 'vitest';
import { richTextTypographyCss, } from './appearanceStyle';
import { blockStyleLayoutCss, } from '@sitesurge/types';
import { STRIPPED_PROPS, stripsFontSize, } from './pasteCleanup';

describe('richTextTypographyCss', () => {
    it('covers the rendered output AND the admin editor', () => {
        const css = richTextTypographyCss({},);
        // `.rich-text` alone left the block editor on browser defaults — the
        // reported "preview doesn't match" bug.
        expect(css,).toContain('.rich-text h1',);
        expect(css,).toContain('.rte-content h1',);
        expect(css,).toContain('.rich-text p',);
        expect(css,).toContain('.rte-content p',);
    },);

    it('sits in the theme layer so block styles outrank it', () => {
        // Injected at runtime, and unlayered CSS beats every layer — including
        // `block`. Unnamed, these defaults would outrank the per-block styles
        // they must yield to.
        expect(richTextTypographyCss({},).startsWith('@layer theme{',),).toBe(true,);
    },);

    it('defers to a block-level line height and font size via custom properties', () => {
        const css = richTextTypographyCss({},);
        // The default is the FALLBACK arm of the var(), so a block that
        // publishes the property wins by inheritance.
        expect(css,).toContain('line-height:var(--block-line-height,',);
        expect(css,).toContain('font-size:var(--block-font-size,',);
    },);

    it('uses the operator values when set', () => {
        const css = richTextTypographyCss({
            headingLineHeight: '2', headingMargin: '4px 0',
            paragraphLineHeight: '1.9', paragraphMargin: '2px 0',
            paragraphFontSize: '18px',
        },);
        expect(css,).toContain('var(--block-line-height,2)',);
        expect(css,).toContain('margin:4px 0',);
        expect(css,).toContain('var(--block-font-size,18px)',);
    },);
},);

describe('block styles publish the override custom properties', () => {
    const opts = { resolveFont: () => undefined, };

    it('emits --block-font-size alongside font-size', () => {
        // Without the custom property a block's font size could not reach
        // rich-text paragraphs once a default existed on the descendant.
        const out = blockStyleLayoutCss({ fontSize: '22px', } as never, opts as never,);
        expect(out['font-size'],).toBe('22px',);
        expect(out['--block-font-size'],).toBe('22px',);
    },);

    it('emits --block-line-height alongside line-height', () => {
        const out = blockStyleLayoutCss({ lineHeight: '2.1', } as never, opts as never,);
        expect(out['line-height'],).toBe('2.1',);
        expect(out['--block-line-height'],).toBe('2.1',);
    },);

    it('emits neither when the block sets nothing', () => {
        const out = blockStyleLayoutCss({} as never, opts as never,);
        expect(out['--block-font-size'],).toBeUndefined();
        expect(out['--block-line-height'],).toBeUndefined();
    },);
},);

describe('paste cleanup rules', () => {
    /*
     * The RULES are asserted here; the DOM transform that applies them is
     * verified in a browser, because this package's test environment has no
     * DOM and adding one for a selector string is not worth a dependency.
     */
    it('strips the properties a word processor imposes', () => {
        // Google Docs writes all four onto every block it copies.
        expect(STRIPPED_PROPS,).toContain('line-height',);
        expect(STRIPPED_PROPS,).toContain('margin-top',);
        expect(STRIPPED_PROPS,).toContain('margin-bottom',);
        expect(STRIPPED_PROPS,).toContain('margin',);
    });

    it('drops font-size from INLINE runs, so the paragraph governs', () => {
        // A `<span style="font-size:12pt">` is describing the SOURCE document.
        // Left in, the Paragraph Font Size setting can never reach the text —
        // and a link whose style gets stripped elsewhere then renders at a
        // different size from the sentence around it.
        for (const tag of ['span', 'a', 'font', 'strong', 'em', 'b', 'i', 'u',]) {
            expect(stripsFontSize(tag,), tag,).toBe(true,);
        }
        expect(stripsFontSize('SPAN',),).toBe(true,);
    });

    it('KEEPS font-size on block elements', () => {
        // A heading's size is meaningful; dropping it would flatten a pasted
        // document's hierarchy.
        for (const tag of ['h1', 'h2', 'h3', 'p', 'div', 'li', 'blockquote',]) {
            expect(stripsFontSize(tag,), tag,).toBe(false,);
        }
    });

    it('does not strip colour or weight — those are real decisions', () => {
        expect(STRIPPED_PROPS,).not.toContain('color',);
        expect(STRIPPED_PROPS,).not.toContain('font-weight',);
        expect(STRIPPED_PROPS,).not.toContain('background-color',);
    });
});
