import { describe, expect, it, } from 'vitest';
import { lintBlocksForEmail, lintEmailHtml, } from './cssLint';

const codes = (html: string,) => lintEmailHtml(html,).map(w => w.code).sort();

describe('lintEmailHtml', () => {
    it('says nothing about plain inline-styled HTML', () => {
        expect(lintEmailHtml('<div style="padding:32px;color:#fff">Hi</div>',),).toEqual([],);
    });

    it('flags a <style> block', () => {
        expect(codes('<style>.a{padding:1px}</style>',),).toContain('style-block',);
    });

    it.each(['::before', '::after', ':before',],)('flags the pseudo-element %s', (sel,) => {
        expect(codes(`<style>.a${sel}{content:""}</style>`,),).toContain('pseudo-element',);
    },);

    it.each([
        'container-type: inline-size',
        'font-size: clamp(1rem,5cqi,2rem)',
        'width: 50cqw',
        'height: 10cqh',
        'font-size: 4cqmin',
    ],)('flags the container-query construct in %j', (css,) => {
        expect(codes(`<div style="${css}"></div>`,),).toContain('container-query',);
    },);

    it('flags clamp separately from container units', () => {
        // clamp() alone is still unsupported in Outlook even with px arguments.
        expect(codes('<div style="font-size:clamp(16px,2vw,24px)"></div>',),).toContain('clamp',);
    });

    it.each(['flex', 'grid', 'inline-flex',],)('flags display:%s', (v,) => {
        expect(codes(`<div style="display:${v}"></div>`,),).toContain('flex-grid',);
    },);

    it('flags gap', () => {
        expect(codes('<div style="display:flex;gap:16px"></div>',),).toContain('gap',);
    });

    it('flags a CSS custom property', () => {
        expect(codes('<div style="color:var(--site-heading)"></div>',),).toContain('css-variable',);
    });

    it.each(['absolute', 'fixed', 'sticky',],)('flags position:%s', (v,) => {
        expect(codes(`<div style="position:${v}"></div>`,),).toContain('position',);
    },);

    it('does NOT flag position:relative', () => {
        // relative is honoured widely enough to be fine, and is common in
        // otherwise-valid email markup.
        expect(codes('<div style="position:relative"></div>',),).not.toContain('position',);
    });

    it('ignores constructs that only appear inside comments', () => {
        // This codebase writes exactly such a comment to explain why a scrim is
        // a gradient. A lint that fires on its own explanation gets ignored.
        const html = '<!-- a ::before scrim would need a <style> block -->' +
            '<div style="padding:8px">ok</div>';
        expect(lintEmailHtml(html,),).toEqual([],);
    });

    it('reports each rule at most once', () => {
        const html = '<style>.a{gap:1px}</style><style>.b{gap:2px}</style>';
        expect(codes(html,).filter(c => c === 'style-block').length,).toBe(1,);
    });

    it('carries an actionable fix with every warning', () => {
        for (const w of lintEmailHtml('<style>.a::before{display:flex;gap:1px}</style>',)) {
            expect(w.fix.length,).toBeGreaterThan(10,);
            expect(w.message.length,).toBeGreaterThan(10,);
        }
    });

    it.each(['', null, undefined,],)('survives empty input %j', (v,) => {
        expect(lintEmailHtml(v as never,),).toEqual([],);
    },);

    it('is not confused by a repeated scan (no /g statefulness)', () => {
        // A /g regex reused across calls carries lastIndex and would start
        // returning false on alternate invocations.
        const html = '<style>.a{gap:1px}</style>';
        expect(codes(html,),).toEqual(codes(html,),);
        expect(codes(html,).length,).toBeGreaterThan(0,);
    });

    it('does not flag the word "gap" inside ordinary text or an identifier', () => {
        expect(codes('<div style="padding:1px">mind the gap</div>',),).not.toContain('gap',);
        expect(codes('<div class="gap-thing" style="padding:1px"></div>',),).not.toContain('gap',);
    });
});

describe('lintBlocksForEmail', () => {
    const html = (content: string,) => ({ blockType: 'html', settings: { content, }, });

    it('only inspects custom-HTML blocks', () => {
        const blocks = [
            { blockType: 'rich_text', settings: { content: '<style>.a{gap:1px}</style>', }, },
        ];
        expect(lintBlocksForEmail(blocks,),).toEqual([],);
    });

    it('de-duplicates the same problem across blocks', () => {
        const out = lintBlocksForEmail([html('<style>.a{}</style>',), html('<style>.b{}</style>',),],);
        expect(out.filter(w => w.code === 'style-block').length,).toBe(1,);
    });

    it('collects distinct problems from different blocks', () => {
        const out = lintBlocksForEmail([html('<style>.a{}</style>',), html('<div style="display:flex"></div>',),],);
        expect(out.map(w => w.code).sort(),).toEqual(['flex-grid', 'style-block',],);
    });

    it('reads the legacy `html` settings key as well as `content`', () => {
        const out = lintBlocksForEmail([{ blockType: 'html', settings: { html: '<style>.a{}</style>', }, },],);
        expect(out.map(w => w.code),).toContain('style-block',);
    });

    it('survives a block with no settings', () => {
        expect(lintBlocksForEmail([{ blockType: 'html', },],),).toEqual([],);
    });
});

describe('lintBlocksForEmail — Custom CSS shadowing a block setting', () => {
    const social = (settings: Record<string, unknown>, customCss?: string,) => ({
        blockType: 'social',
        settings,
        style: customCss === undefined ? {} : { customCss, },
    });

    it('warns when Custom CSS sets border-radius over Item border radius', () => {
        /*
         * The reported confusion: the panel read `0px 0px 15px 15px` and the
         * inbox showed `15px`, because a leftover `td a img { border-radius }`
         * rule — written as a workaround before the setting existed — was
         * quietly winning from a collapsed field on a different panel.
         */
        const w = lintBlocksForEmail([
            social({ itemBorderRadius: '0px 0px 15px 15px', }, 'td a img { border-radius: 15px }',),
        ],);
        expect(w,).toHaveLength(1,);
        expect(w[0].code,).toBe('shadowed-itemBorderRadius',);
        expect(w[0].message,).toContain('Item border radius',);
        // The actual value, so the operator can see which one is theirs.
        expect(w[0].message,).toContain('0px 0px 15px 15px',);
        expect(w[0].fix,).toContain('border-radius',);
    });

    it('stays quiet when the CSS touches a DIFFERENT property', () => {
        expect(lintBlocksForEmail([
            social({ itemBorderRadius: '8px', }, 'td a img { opacity: 0.5 }',),
        ],),).toHaveLength(0,);
    });

    it('stays quiet when the setting is not in use', () => {
        // Custom CSS alone is not a conflict — there is nothing to shadow.
        expect(lintBlocksForEmail([social({}, 'td a img { border-radius: 15px }',),],),).toHaveLength(0,);
        expect(lintBlocksForEmail([social({ itemBorderRadius: '', }, 'img { border-radius: 4px }',),],),)
            .toHaveLength(0,);
    });

    it('stays quiet when there is no Custom CSS', () => {
        expect(lintBlocksForEmail([social({ itemBorderRadius: '8px', },),],),).toHaveLength(0,);
        expect(lintBlocksForEmail([social({ itemBorderRadius: '8px', }, '   ',),],),).toHaveLength(0,);
    });

    it('finds the property inside a media query', () => {
        // An at-rule's body is a nested sheet, so a shallow scan would miss it.
        const w = lintBlocksForEmail([
            social({ itemBorderRadius: '8px', }, '@media (max-width:600px){ img { border-radius: 2px } }',),
        ],);
        expect(w,).toHaveLength(1,);
    });

    it('does not fire on a property that merely CONTAINS the name', () => {
        // `border-radius` vs `border-radius-fake` / a value mentioning it.
        expect(lintBlocksForEmail([
            social({ itemBorderRadius: '8px', }, 'img { border: 1px solid }',),
        ],),).toHaveLength(0,);
    });

    it('only applies to the block type that owns the setting', () => {
        expect(lintBlocksForEmail([{
            blockType: 'image',
            settings: { itemBorderRadius: '8px', },
            style: { customCss: 'img { border-radius: 15px }', },
        },],),).toHaveLength(0,);
    });

    it('reports once across several offending blocks', () => {
        // The operator needs to know the conflict exists, not a count.
        const w = lintBlocksForEmail([
            social({ itemBorderRadius: '8px', }, 'img { border-radius: 1px }',),
            social({ itemBorderRadius: '9px', }, 'img { border-radius: 2px }',),
        ],);
        expect(w,).toHaveLength(1,);
    });

    it('still lints custom-HTML content alongside it', () => {
        // Two different passes over two different materials; neither may
        // swallow the other.
        const w = lintBlocksForEmail([
            social({ itemBorderRadius: '8px', }, 'img { border-radius: 1px }',),
            { blockType: 'html', settings: { content: '<style>p{color:red}</style>', }, style: {}, },
        ],);
        expect(w.map(x => x.code).sort(),).toEqual(['shadowed-itemBorderRadius', 'style-block',],);
    });
});
