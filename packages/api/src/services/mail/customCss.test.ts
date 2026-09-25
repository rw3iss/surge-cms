/**
 * A block's Custom CSS, delivered by email.
 *
 * The web path scopes the whole sheet into a `<style>` and trusts the browser.
 * Email cannot: a `<style>` in the head is stripped or ignored by enough
 * clients that anything important has to become an inline attribute. These
 * tests pin WHICH rules get inlined, and — just as importantly — that the ones
 * that cannot be are neither guessed at nor silently dropped.
 */
import { describe, expect, it, } from 'vitest';
import { applyInlineRules, importantify, parseDeclarations, planCustomCss, } from './blocks/customCss';

const SCOPE = '[data-block-id="b1"]';
const plan = (css: string,) => planCustomCss(css, SCOPE,);

describe('parseDeclarations', () => {
    it('reads a simple declaration list', () => {
        expect(parseDeclarations('color: red; font-weight: bold',),)
            .toEqual({ 'color': 'red', 'font-weight': 'bold', },);
    });

    it('tolerates a trailing semicolon and odd whitespace', () => {
        expect(parseDeclarations('  color:red ;  ',),).toEqual({ color: 'red', },);
    });

    it('does not split on a `;` inside parentheses', () => {
        // `url(...)` and `calc(...)` both routinely carry punctuation.
        expect(parseDeclarations('background: url(a;b.png); color: red',),)
            .toEqual({ background: 'url(a;b.png)', color: 'red', },);
    });

    it('does not split on a `;` inside a quoted string', () => {
        expect(parseDeclarations('content: ";"; color: red',),)
            .toEqual({ content: '";"', color: 'red', },);
    });

    it('strips a trailing !important', () => {
        // Pointless in an inline style that already wins, and noise in the
        // attribute.
        expect(parseDeclarations('color: red !important',),).toEqual({ color: 'red', },);
    });

    it('ignores a property with no value and a value with no property', () => {
        expect(parseDeclarations('color:; ; :red; width: 2px',),).toEqual({ width: '2px', },);
    });

    it('lower-cases the property but preserves the value', () => {
        // `Color` is a property; `Red` could be a font name or a var() name.
        expect(parseDeclarations('Color: Red',),).toEqual({ color: 'Red', },);
    });
});

describe('planCustomCss — what becomes an inline style', () => {
    it('treats `&` as declarations for the block cell', () => {
        const p = plan('& { padding: 0; background: #eee }',);
        expect(p.cell,).toEqual({ padding: '0', background: '#eee', },);
        expect(p.inline,).toHaveLength(0,);
        expect(p.stylesheet,).toBe('',);
    });

    it('treats selector-less declarations as the block cell too', () => {
        expect(plan('{ padding: 0 }',).cell,).toEqual({ padding: '0', },);
    });

    it('routes a bare tag selector to the inline pass', () => {
        const p = plan('p { color: red }',);
        expect(p.inline,).toHaveLength(1,);
        expect(p.inline[0].decls,).toEqual({ color: 'red', },);
        expect(p.stylesheet,).toBe('',);
    });

    it('routes `.class`, `#id` and `tag.class` to the inline pass', () => {
        expect(plan('.price { color: red }',).inline,).toHaveLength(1,);
        expect(plan('#total { color: red }',).inline,).toHaveLength(1,);
        expect(plan('a.btn { color: red }',).inline,).toHaveLength(1,);
    });

    it('splits a comma list into one inline rule per selector', () => {
        const p = plan('h1, h2 { margin: 0 }',);
        expect(p.inline,).toHaveLength(2,);
        expect(p.inline.map(r => r.match.tag),).toEqual(['h1', 'h2',],);
    });

    it("sends a comma list's `&` to the cell and its tag to the inline pass", () => {
        const p = plan('&, p { color: red }',);
        expect(p.cell,).toEqual({ color: 'red', },);
        expect(p.inline,).toHaveLength(1,);
    });
});

describe('planCustomCss — what stays in the stylesheet', () => {
    it('leaves a descendant selector alone rather than guessing', () => {
        // There is no DOM here. A matcher that "mostly" handled combinators
        // would corrupt the message on the cases it got wrong.
        const p = plan('div p { color: red }',);
        expect(p.inline,).toHaveLength(0,);
        expect(p.stylesheet,).toContain(`${SCOPE} div p`,);
    });

    it('leaves a pseudo-class alone — there is no hover in an attribute', () => {
        const p = plan('a:hover { color: red }',);
        expect(p.inline,).toHaveLength(0,);
        expect(p.stylesheet,).toContain(':hover',);
    });

    it('leaves a media query alone — an inline style carries no condition', () => {
        const p = plan('@media (max-width: 600px) { p { color: red } }',);
        expect(p.inline,).toHaveLength(0,);
        expect(p.stylesheet,).toContain('@media (max-width: 600px)',);
        expect(p.stylesheet,).toContain(`${SCOPE} p`,);
    });

    it('does not split a media query on the comma in its condition LIST', () => {
        /*
         * `@media screen, print` is ONE at-rule with two conditions. It has to
         * be recognised as an at-rule before the comma-splitting that serves
         * selector lists, or it is torn into `@media screen` and a fragment
         * beginning `print{`, and the whole rule is dropped by the client.
         */
        const p = plan('@media screen, print { p { color: red } }',);
        expect(p.stylesheet,).toContain('@media screen, print',);
        expect(p.stylesheet,).not.toContain('{print',);
        expect(p.inline,).toHaveLength(0,);
        // And the inner selector is still scoped.
        expect(p.stylesheet,).toContain(`${SCOPE} p`,);
    });

    it('scopes the leftover sheet to this block', () => {
        const p = plan('div p { color: red }',);
        expect(p.stylesheet,).toContain('data-block-id',);
        expect(p.stylesheet,).not.toMatch(/(^|[{};])\s*div p\s*\{/,);
    });

    it('drops nothing: every rule lands in exactly one of the three groups', () => {
        const p = plan('& { padding: 0 } p { color: red } div p { margin: 0 } @media screen { a { color: blue } }',);
        expect(p.cell,).toEqual({ padding: '0', },);
        expect(p.inline,).toHaveLength(1,);
        expect(p.stylesheet,).toContain('div p',);
        expect(p.stylesheet,).toContain('@media screen',);
    });

    it('returns everything empty for blank input', () => {
        for (const v of ['', '   ', null, undefined,]) {
            const p = planCustomCss(v, SCOPE,);
            expect(p.cell,).toEqual({},);
            expect(p.inline,).toHaveLength(0,);
            expect(p.stylesheet,).toBe('',);
        }
    });

    it('does not inline a rule with no declarations', () => {
        expect(plan('p { }',).inline,).toHaveLength(0,);
    });
});

describe('applyInlineRules', () => {
    const rule = (css: string,) => plan(css,).inline;

    it('adds a style attribute to a matching tag', () => {
        expect(applyInlineRules('<p>Hi</p>', rule('p { color: red }',),),)
            .toBe('<p style="color:red">Hi</p>',);
    });

    it('leaves non-matching tags untouched', () => {
        expect(applyInlineRules('<div>Hi</div>', rule('p { color: red }',),),)
            .toBe('<div>Hi</div>',);
    });

    it('never touches a CLOSING tag', () => {
        // `</p>` matching would produce `</p style="…">`, which is broken HTML.
        const out = applyInlineRules('<p>Hi</p>', rule('p { color: red }',),);
        expect(out,).toContain('</p>',);
        expect(out,).not.toContain('</p ',);
    });

    it('applies to EVERY matching tag, not just the first', () => {
        const out = applyInlineRules('<p>a</p><p>b</p>', rule('p { color: red }',),);
        expect(out.match(/style="color:red"/g,)?.length,).toBe(2,);
    });

    it('merges with an existing style attribute instead of replacing it', () => {
        const out = applyInlineRules('<p style="margin:0">Hi</p>', rule('p { color: red }',),);
        expect(out,).toContain('margin:0',);
        expect(out,).toContain('color:red',);
    });

    it('overrides a conflicting property the renderer already set', () => {
        /*
         * The whole reason the field exists: someone reaches for Custom CSS
         * because what the renderer produced is not what they want. In email
         * every style is inline, so "inline wins" would mean the field could
         * never change anything.
         */
        const out = applyInlineRules('<p style="color:#111">Hi</p>', rule('p { color: red }',),);
        expect(out,).toContain('color:red',);
        expect(out,).not.toContain('#111',);
    });

    it('keeps other attributes and their values', () => {
        const out = applyInlineRules('<a href="https://x.test/?a=1&b=2">Hi</a>', rule('a { color: red }',),);
        expect(out,).toContain('href="https://x.test/?a=1&b=2"',);
        expect(out,).toContain('color:red',);
    });

    it('matches on class', () => {
        const rules = rule('.price { color: red }',);
        expect(applyInlineRules('<span class="price">1</span>', rules,),).toContain('color:red',);
        expect(applyInlineRules('<span class="other">1</span>', rules,),).not.toContain('color:red',);
    });

    it('matches one class among several, not a substring of one', () => {
        const rules = rule('.price { color: red }',);
        expect(applyInlineRules('<span class="a price b">1</span>', rules,),).toContain('color:red',);
        // `.price` must not match `class="pricey"`.
        expect(applyInlineRules('<span class="pricey">1</span>', rules,),).not.toContain('color:red',);
    });

    it('matches on id, and on tag+class together', () => {
        expect(applyInlineRules('<div id="total">1</div>', rule('#total { color: red }',),),)
            .toContain('color:red',);
        const both = rule('a.btn { color: red }',);
        expect(applyInlineRules('<a class="btn">x</a>', both,),).toContain('color:red',);
        expect(applyInlineRules('<span class="btn">x</span>', both,),).not.toContain('color:red',);
    });

    it('does not mangle a self-closing tag', () => {
        const out = applyInlineRules('<img src="x.png" />', rule('img { border: 0 }',),);
        expect(out,).toContain('src="x.png"',);
        expect(out,).toContain('border:0',);
        expect(out,).not.toContain('/ style',);
    });

    it('does not treat a `>` inside an attribute value as the end of the tag', () => {
        const out = applyInlineRules('<a title="a > b">x</a>', rule('a { color: red }',),);
        expect(out,).toContain('title="a > b"',);
        expect(out,).toContain('color:red',);
    });

    it('leaves text content alone even when it names the tag', () => {
        const out = applyInlineRules('<div>a p tag</div>', rule('p { color: red }',),);
        expect(out,).toBe('<div>a p tag</div>',);
    });

    it('applies several matching rules to one tag, later winning', () => {
        const rules = [...rule('p { color: red; margin: 0 }',), ...rule('p { color: blue }',),];
        const out = applyInlineRules('<p>x</p>', rules,);
        expect(out,).toContain('margin:0',);
        expect(out,).toContain('color:blue',);
        expect(out,).not.toContain('color:red',);
    });

    it('is a no-op with no rules or no html', () => {
        expect(applyInlineRules('<p>x</p>', [],),).toBe('<p>x</p>',);
        expect(applyInlineRules('', rule('p{color:red}',),),).toBe('',);
    });
});

describe('importantify', () => {
    it('marks every declaration important', () => {
        expect(importantify('a{color:red;margin:0}',),)
            .toBe('a{color:red !important;margin:0 !important}',);
    });

    it('is why the head <style> can beat an inline base style', () => {
        // Email has no cascade layers, and every base style here is an inline
        // attribute — which outranks any stylesheet rule without !important.
        expect(importantify('a{color:red}',),).toContain('!important',);
    });

    it('does not double up an existing !important', () => {
        expect(importantify('a{color:red !important}',),).toBe('a{color:red !important}',);
    });

    it('leaves an empty rule body alone rather than emitting `{}` garbage', () => {
        expect(importantify('a{}',),).toBe('a{}',);
    });

    it('does not touch an at-rule prelude', () => {
        const out = importantify('@media (max-width:1px){a{color:red}}',);
        expect(out,).toContain('@media (max-width:1px)',);
        expect(out,).toContain('color:red !important',);
    });
});
