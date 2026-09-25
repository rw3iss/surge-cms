/**
 * Scoping is the ONLY thing standing between a per-block "Custom CSS" box and
 * an operator accidentally restyling the whole site from inside one block. The
 * cases below are the ones where a plausible regex implementation looks right
 * and quietly leaks.
 */
import { describe, expect, it, } from 'vitest';
import { isBareDeclarations, scopeCss, } from './scopeCss';

const S = '.block[data-block-id="b1"]';
const scope = (css: string,) => scopeCss(css, S,);

describe('scopeCss — the containment guarantee', () => {
    it('prefixes a bare element selector so it cannot reach the whole page', () => {
        // The headline case: `p { … }` means "my paragraphs", not "every
        // paragraph on the site".
        expect(scope('p { color: red }',),).toBe(`${S} p{ color: red }`,);
    });

    it('prefixes EVERY selector in a comma list, not just the first', () => {
        // The classic leak: scoping `h1` and letting `h2` escape.
        const out = scope('h1, h2 { margin: 0 }',);
        expect(out,).toBe(`${S} h1,${S} h2{ margin: 0 }`,);
        expect(out.split('{',)[0].split(',',).every(s => s.includes('data-block-id',)),).toBe(true,);
    });

    it('leaves no selector unprefixed anywhere in a multi-rule sheet', () => {
        const out = scope('p{color:red} a{color:blue} .x y{color:green}',);
        // Every rule head must mention the scope.
        for (const rule of out.split('}',).filter(Boolean,)) {
            if (rule.includes('{',)) expect(rule,).toContain('data-block-id',);
        }
    });

    it('scopes a universal selector rather than letting `*` through', () => {
        expect(scope('* { box-sizing: border-box }',),).toBe(`${S} *{ box-sizing: border-box }`,);
    });

    it('scopes a selector that starts with a class or id', () => {
        expect(scope('.card { padding: 4px }',),).toBe(`${S} .card{ padding: 4px }`,);
        expect(scope('#hero { padding: 4px }',),).toBe(`${S} #hero{ padding: 4px }`,);
    });

    it('does not split a comma INSIDE a functional pseudo-class', () => {
        // `:is(h1, h2)` is one selector. Splitting it produces `:is(h1` —
        // invalid, and the browser drops the whole rule.
        const out = scope(':is(h1, h2) { color: red }',);
        expect(out,).toBe(`${S} :is(h1, h2){ color: red }`,);
        expect(out,).not.toContain(':is(h1{',);
    });
});

describe('scopeCss — `&` means the block itself', () => {
    it('replaces a lone `&` with the scope', () => {
        expect(scope('& { border: 1px solid }',),).toBe(`${S}{ border: 1px solid }`,);
    });

    it('keeps `&` attached for a compound selector', () => {
        // `&:hover` must stay ONE compound selector. Emitting `${S} :hover`
        // (with a space) would target hovered DESCENDANTS instead.
        expect(scope('&:hover { opacity: .5 }',),).toBe(`${S}:hover{ opacity: .5 }`,);
        expect(scope('&:hover { opacity: .5 }',),).not.toContain(`${S} :hover`,);
    });

    it('supports `&` in the middle and at the end', () => {
        expect(scope('& > p { margin: 0 }',),).toBe(`${S} > p{ margin: 0 }`,);
        expect(scope('.dark & { color: white }',),).toBe(`.dark ${S}{ color: white }`,);
    });

    it('replaces EVERY `&` in one selector', () => {
        expect(scope('& + & { margin-top: 8px }',),).toBe(`${S} + ${S}{ margin-top: 8px }`,);
    });

    it('handles `&` per-selector inside a comma list', () => {
        const out = scope('&, & p { color: red }',);
        expect(out,).toBe(`${S},${S} p{ color: red }`,);
    });
});

describe('scopeCss — bare declarations', () => {
    it('treats a selector-less declaration list as the block itself', () => {
        // Typing `color: red` straight into the box is the obvious thing to do
        // even though it is not valid CSS. Discarding it would look like the
        // feature is broken.
        expect(scope('{ color: red }',),).toBe(`${S}{ color: red }`,);
    });

    it('recognises a bare declaration list for the caller', () => {
        expect(isBareDeclarations('color: red',),).toBe(true,);
        expect(isBareDeclarations('color: red; font-weight: bold',),).toBe(true,);
    });

    it('does NOT call a real stylesheet bare declarations', () => {
        // The email path inlines bare declarations onto the cell; misreading a
        // stylesheet as declarations would inline `p { color` as a property.
        expect(isBareDeclarations('p { color: red }',),).toBe(false,);
        expect(isBareDeclarations('@media (max-width:1px){a{color:red}}',),).toBe(false,);
    });

    it('is false for empty or property-less text', () => {
        expect(isBareDeclarations('',),).toBe(false,);
        expect(isBareDeclarations('   ',),).toBe(false,);
        expect(isBareDeclarations(null,),).toBe(false,);
        expect(isBareDeclarations(undefined,),).toBe(false,);
        expect(isBareDeclarations('just some words',),).toBe(false,);
    });
});

describe('scopeCss — at-rules', () => {
    it('scopes rules INSIDE @media, keeping the query intact', () => {
        const out = scope('@media (max-width: 600px) { p { color: red } }',);
        expect(out,).toContain('@media (max-width: 600px)',);
        expect(out,).toContain(`${S} p`,);
    });

    it('scopes inside @supports and @container too', () => {
        expect(scope('@supports (display: grid) { .g { display: grid } }',),)
            .toContain(`${S} .g`,);
        expect(scope('@container (min-width: 10px) { .g { color: red } }',),)
            .toContain(`${S} .g`,);
    });

    it('scopes rules nested TWO at-rules deep', () => {
        const out = scope('@media screen { @supports (color: red) { p { color: red } } }',);
        expect(out,).toContain(`${S} p`,);
        expect(out,).toContain('@media screen',);
        expect(out,).toContain('@supports (color: red)',);
    });

    it('leaves @keyframes alone — its body is not selectors', () => {
        // `from`/`to`/`50%` are keyframe selectors. Prefixing them with an
        // element selector silently kills the animation.
        const out = scope('@keyframes spin { from { opacity: 0 } to { opacity: 1 } }',);
        expect(out,).toContain('from { opacity: 0 }',);
        expect(out,).not.toContain(`${S} from`,);
        expect(out,).not.toContain('data-block-id',);
    });

    it('leaves a vendor-prefixed @keyframes alone as well', () => {
        const out = scope('@-webkit-keyframes spin { from { opacity: 0 } }',);
        expect(out,).not.toContain('data-block-id',);
    });

    it('leaves @font-face alone', () => {
        const out = scope('@font-face { font-family: X; src: url(x.woff2) }',);
        expect(out,).toContain('font-family: X',);
        expect(out,).not.toContain('data-block-id',);
    });

    it('passes a statement at-rule through without a body', () => {
        const out = scope('@import url("x.css"); p { color: red }',);
        expect(out,).toContain('@import url("x.css");',);
        expect(out,).toContain(`${S} p`,);
    });

    it('passes an UNRECOGNISED at-rule through untouched', () => {
        /*
         * The fallback arm, pinned deliberately.
         *
         * `@page`'s body is declarations, not selectors, and so is that of
         * every at-rule CSS grows next. Guessing "scope it" mangles the ones
         * that behave like `@keyframes`; guessing "drop it" loses the
         * operator's work silently. Passing through is the only choice that
         * fails safely in both directions.
         *
         * Without this test the `@keyframes` special case is the only thing
         * keeping keyframes intact, and a change to this arm would break them
         * with every test still green.
         */
        const out = scope('@page { margin: 1cm }',);
        expect(out,).toContain('@page',);
        expect(out,).toContain('margin: 1cm',);
        expect(out,).not.toContain('data-block-id',);
    });
});

describe('scopeCss — parsing hazards', () => {
    it('does not treat a `}` inside a quoted string as the end of a rule', () => {
        // The reason this is a scanner and not a regex.
        const out = scope('p::after { content: "}" } a { color: red }',);
        expect(out,).toContain(`${S} p::after`,);
        expect(out,).toContain(`${S} a`,);
        expect(out,).toContain('content: "}"',);
    });

    it('does not treat a `{` inside a quoted string as the start of a rule', () => {
        const out = scope('p::after { content: "{" } a { color: red }',);
        expect(out,).toContain(`${S} a{ color: red }`,);
    });

    it('survives an escaped quote inside a string', () => {
        const out = scope('p::after { content: "\\"}" } a { color: red }',);
        expect(out,).toContain(`${S} a`,);
    });

    it('does not split a comma inside a quoted attribute value', () => {
        const out = scope('[data-x="a,b"] { color: red }',);
        expect(out,).toBe(`${S} [data-x="a,b"]{ color: red }`,);
    });

    it('ignores braces inside comments', () => {
        const out = scope('/* } */ p { color: red }',);
        expect(out,).toBe(`${S} p{ color: red }`,);
    });

    it('does not choke on an unterminated rule', () => {
        // Operators type broken CSS constantly. Throwing here would take down
        // the whole page render.
        expect(() => scope('p { color: red',)).not.toThrow();
        expect(scope('p { color: red',),).toContain('data-block-id',);
    });

    it('does not choke on an unterminated string', () => {
        expect(() => scope('p::after { content: "oops',)).not.toThrow();
    });
});

describe('scopeCss — empty input', () => {
    it.each([null, undefined, '', '   ',],)('returns empty for %j', (v,) => {
        expect(scopeCss(v, S,),).toBe('',);
    },);

    it('returns empty when there is no scope to apply', () => {
        // Better nothing than unscoped CSS loose on the page.
        expect(scopeCss('p { color: red }', '',),).toBe('',);
    });
});
