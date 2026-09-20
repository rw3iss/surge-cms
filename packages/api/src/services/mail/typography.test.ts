/**
 * `applyTypographyInline` is the email path, where there is no stylesheet to
 * fall back on. Two properties matter and would both fail quietly:
 *
 *   - it must FILL IN, never overwrite — these are defaults, so an author who
 *     styled one heading keeps it
 *   - it must not corrupt the markup it is editing, because it works on a
 *     string rather than a DOM
 */
import { describe, expect, it, } from 'vitest';
// Lives here, not in `packages/shared`, because that package ships no test
// runner — and the mail renderer is what depends on this behaviour.
import { applyTypographyInline, resolveTypography, TYPOGRAPHY_DEFAULTS, } from '@sitesurge/types';

const T = TYPOGRAPHY_DEFAULTS;

describe('applyTypographyInline', () => {
    it('adds line-height and margin to a bare heading', () => {
        const out = applyTypographyInline('<h1>Title</h1>', T,);
        expect(out,).toContain(`line-height:${T.headingLineHeight}`,);
        expect(out,).toContain(`margin:${T.headingMargin}`,);
        expect(out,).toContain('>Title</h1>',);
    },);

    it('uses the PARAGRAPH values for <p>, not the heading ones', () => {
        // Body copy needs more leading than a heading; swapping them is the
        // kind of mistake that looks "slightly off" rather than broken.
        const out = applyTypographyInline('<p>Body</p>', T,);
        expect(out,).toContain(`line-height:${T.paragraphLineHeight}`,);
        expect(out,).toContain(`margin:${T.paragraphMargin}`,);
    },);

    it('covers h1 through h6', () => {
        for (let n = 1; n <= 6; n++) {
            const out = applyTypographyInline(`<h${n}>x</h${n}>`, T,);
            expect(out, `h${n}`,).toContain(`line-height:${T.headingLineHeight}`,);
        }
    },);

    it('does NOT overwrite a line-height the author already set', () => {
        const out = applyTypographyInline('<h1 style="line-height:3">Big</h1>', T,);
        expect(out,).toContain('line-height:3',);
        expect(out,).not.toContain(T.headingLineHeight,);
        // The margin was not set, so that one IS filled in.
        expect(out,).toContain(`margin:${T.headingMargin}`,);
    },);

    it('treats margin-top/margin-bottom as "margin already declared"', () => {
        // This is the pasted-Google-Docs shape. Adding a `margin` shorthand
        // alongside would leave which one wins down to declaration order.
        const pasted = '<h1 style="line-height:1.38;margin-top:12pt;margin-bottom:12pt;">T</h1>';
        const out = applyTypographyInline(pasted, T,);
        expect(out,).not.toContain(`margin:${T.headingMargin}`,);
        expect(out,).toContain('margin-top:12pt',);
    },);

    it('preserves other attributes and other style properties', () => {
        const out = applyTypographyInline('<h2 id="x" class="y" style="color:red">T</h2>', T,);
        expect(out,).toContain('id="x"',);
        expect(out,).toContain('class="y"',);
        expect(out,).toContain('color:red',);
        expect(out,).toContain(`line-height:${T.headingLineHeight}`,);
    },);

    it('handles single-quoted style attributes', () => {
        const out = applyTypographyInline("<p style='color:blue'>T</p>", T,);
        expect(out,).toContain('color:blue',);
        expect(out,).toContain(`line-height:${T.paragraphLineHeight}`,);
    },);

    it('leaves other tags completely alone', () => {
        // `<span>` and `<div>` carry no default rhythm — widening the match
        // would restyle layout wrappers the author controls.
        const html = '<div><span>hi</span><section>x</section></div>';
        expect(applyTypographyInline(html, T,),).toBe(html,);
    },);

    it('does not touch closing tags', () => {
        const out = applyTypographyInline('<h1>a</h1><h1>b</h1>', T,);
        expect(out.match(/<\/h1>/g,)?.length,).toBe(2,);
        expect(out,).not.toContain('</h1 style',);
    },);

    it('is a no-op on empty input', () => {
        expect(applyTypographyInline('', T,),).toBe('',);
    },);
},);

describe('resolveTypography', () => {
    it('falls back to the shared defaults when unset', () => {
        expect(resolveTypography(null,),).toEqual(TYPOGRAPHY_DEFAULTS,);
        expect(resolveTypography({},),).toEqual(TYPOGRAPHY_DEFAULTS,);
    },);

    it('treats an empty or whitespace value as unset', () => {
        // A cleared settings field arrives as '', which must mean "default",
        // not "line-height: nothing".
        const r = resolveTypography({ headingLineHeight: '   ', headingMargin: '', },);
        expect(r.headingLineHeight,).toBe(TYPOGRAPHY_DEFAULTS.headingLineHeight,);
        expect(r.headingMargin,).toBe(TYPOGRAPHY_DEFAULTS.headingMargin,);
    },);

    it('uses an operator value when present', () => {
        const r = resolveTypography({ headingLineHeight: '2', paragraphMargin: '0', },);
        expect(r.headingLineHeight,).toBe('2',);
        expect(r.paragraphMargin,).toBe('0',);
        // Untouched fields keep their defaults.
        expect(r.headingMargin,).toBe(TYPOGRAPHY_DEFAULTS.headingMargin,);
    },);

    it('ships the values the product asked for', () => {
        expect(TYPOGRAPHY_DEFAULTS.headingLineHeight,).toBe('1.15em',);
        expect(TYPOGRAPHY_DEFAULTS.headingMargin,).toBe('10px 0px',);
    },);
},);
