/**
 * The rich-text block must read the same in an inbox as in the editor.
 *
 * On the web `richTextTypographyCss` puts `font-size` on the `.rich-text` ROOT,
 * so every descendant inherits one base size. `applyTypographyInline` only
 * reaches `<p>` and `<h1>`–`<h6>`, so anything else a contentEditable produces
 * — notably the `<div>`s it emits for the soft-wrapped lines of a signature —
 * had no size in email and fell back to the email body's. A signature rendered
 * visibly smaller than the paragraph above it, in the mail only.
 */
import { describe, expect, it, } from 'vitest';
import { TYPOGRAPHY_DEFAULTS, } from '@sitesurge/types';
import { renderRichText, } from './richText';

const ctx = { typography: TYPOGRAPHY_DEFAULTS, } as never;
const render = (content: string,) =>
    renderRichText({ settings: { content, }, } as never, ctx,) as {
        content: string;
        cellStyle: Record<string, string>;
    };

describe('renderRichText cell typography', () => {
    it('puts the base font-size on the CELL, so every child inherits it', () => {
        const out = render('<p>Body</p>',);
        expect(out.cellStyle['font-size'],).toBe(TYPOGRAPHY_DEFAULTS.paragraphFontSize,);
    },);

    it('still sets the line-height it always did', () => {
        const out = render('<p>Body</p>',);
        expect(out.cellStyle['line-height'],).toBe(TYPOGRAPHY_DEFAULTS.paragraphLineHeight,);
    },);

    it('leaves a signature\'s <div>s without their own size, to inherit the cell', () => {
        // The real shape a contentEditable saves for "Sincerely, / Frank Scales".
        const out = render('<div>Sincerely,</div><div>Frank Scales</div>',);
        expect(out.content,).not.toMatch(/<div[^>]*font-size/,);
        expect(out.cellStyle['font-size'],).toBe(TYPOGRAPHY_DEFAULTS.paragraphFontSize,);
    },);

    it('does NOT give a div the paragraph margin', () => {
        // The two signature lines are tight in the editor. Adding `div` to the
        // tag inliner would have fixed the size and spaced them 15px apart,
        // trading one mismatch for another.
        const out = render('<div>Sincerely,</div><div>Frank Scales</div>',);
        expect(out.content,).not.toMatch(/<div[^>]*margin/,);
    },);

    it('keeps the explicit size on paragraphs', () => {
        const out = render('<p>Body</p>',);
        expect(out.content,).toContain(`font-size:${TYPOGRAPHY_DEFAULTS.paragraphFontSize}`,);
    },);

    it('agrees between the cell base and the paragraph size', () => {
        // If these two ever diverge, a <p> and the bare text beside it render
        // at different sizes — the exact bug, in a new place.
        const out = render('<p>Body</p>Loose text',);
        const pSize = /font-size:([^;"]+)/.exec(out.content,)?.[1].trim();
        expect(pSize,).toBe(out.cellStyle['font-size'],);
    },);

    it('respects a custom configured paragraph size', () => {
        const custom = { ...TYPOGRAPHY_DEFAULTS, paragraphFontSize: '18px', };
        const out = renderRichText(
            { settings: { content: '<p>Body</p>', }, } as never,
            { typography: custom, } as never,
        ) as { cellStyle: Record<string, string>; };
        expect(out.cellStyle['font-size'],).toBe('18px',);
    },);
},);
