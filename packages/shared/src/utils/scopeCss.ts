/**
 * Rewrite operator-authored CSS so it can only affect ONE block.
 *
 * A per-block "Custom CSS" field is a loaded gun without this: an operator
 * writing `p { color: red }` means "the paragraphs in MY block", but the
 * browser hears "every paragraph on the site". Prefixing each selector with
 * the block's own wrapper turns the natural reading into the actual one.
 *
 * `&` refers to the block wrapper itself, matching the convention of every
 * nesting syntax an operator is likely to have met (Sass, and now CSS
 * nesting), so `& { border: 1px solid }` styles the block rather than its
 * children.
 *
 * **Why a hand-rolled scanner rather than a regex.** Selectors and
 * declarations both contain braces-adjacent punctuation, at-rules nest, and a
 * `}` can appear inside a quoted string (`content: "}"`). A regex that looks
 * right passes the easy cases and mangles the interesting ones — and the
 * output here is injected into a page, so mangling is not a cosmetic concern.
 */

/** At-rules whose body is declarations or nested rules we must NOT scope. */
const UNSCOPED_AT_RULES = /^@(keyframes|-\w+-keyframes|font-face|import|charset|namespace|counter-style|property)\b/i;
/** At-rules whose body contains ordinary rules that DO need scoping. */
const NESTED_AT_RULES = /^@(media|supports|layer|container)\b/i;

interface Block {
    prelude: string;
    body: string;
}

/** One top-level rule of a stylesheet, as parsed. */
export interface CssRule {
    /**
     * The selector list exactly as written, `''` for a selector-less
     * declaration block, or the full at-rule prelude (`@media (…)`) when
     * `atRule` is true.
     */
    selector: string;
    /** Everything between the braces, untouched. */
    body: string;
    /** True when `selector` is an at-rule prelude, so `body` is a nested sheet. */
    atRule: boolean;
}

/**
 * Parse a stylesheet into its top-level rules.
 *
 * Exported so the EMAIL renderer can classify an operator's CSS — which rules
 * can be inlined onto an element, which have to stay in a `<style>` — using the
 * SAME scanner that scopes it for the web. Two parsers for one input is how the
 * two surfaces end up disagreeing about what the operator wrote.
 */
export function parseCssRules(css: string | null | undefined,): CssRule[] {
    const src = (css ?? '').trim();
    if (!src) return [];
    const out: CssRule[] = [];
    for (const node of splitRules(src,)) {
        // A statement at-rule (`@import …;`) has no body and nothing to inline.
        if ('raw' in node) continue;
        const selector = node.prelude.trim();
        out.push({ selector, body: node.body, atRule: selector.startsWith('@',), },);
    }
    return out;
}

/**
 * Split a stylesheet into top-level `{ prelude, body }` pairs.
 *
 * Tracks quotes and comments so a `{`/`}` inside either is not mistaken for
 * structure.
 */
function splitRules(css: string,): Array<Block | { raw: string; }> {
    const out: Array<Block | { raw: string; }> = [];
    let prelude = '';
    let i = 0;

    while (i < css.length) {
        const ch = css[i];

        // Comments — skipped wholesale; they cannot contain structure.
        if (ch === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2,);
            i = end === -1 ? css.length : end + 2;
            continue;
        }
        // Quoted strings inside a prelude (an attribute selector, say).
        if (ch === '"' || ch === "'") {
            const end = findStringEnd(css, i,);
            prelude += css.slice(i, end,);
            i = end;
            continue;
        }
        if (ch === '{') {
            const bodyEnd = findBlockEnd(css, i,);
            out.push({ prelude: prelude.trim(), body: css.slice(i + 1, bodyEnd,), },);
            prelude = '';
            i = bodyEnd + 1;
            continue;
        }
        if (ch === ';' && prelude.trim().startsWith('@',)) {
            // A statement at-rule (`@import url(x);`) — no body.
            out.push({ raw: `${prelude.trim()};`, },);
            prelude = '';
            i += 1;
            continue;
        }
        prelude += ch;
        i += 1;
    }
    return out;
}

/**
 * Index just past the closing quote of the string starting at `start`.
 *
 * Exported because every CSS scanner in the codebase needs it and there is only
 * one right answer: a `}` or `;` inside `content: "…"` is not structure. The
 * email renderer's declaration parser had its own byte-identical copy, which is
 * two chances to get escape handling subtly different.
 */
export function findStringEnd(css: string, start: number,): number {
    const quote = css[start];
    let i = start + 1;
    while (i < css.length) {
        if (css[i] === '\\') {
            i += 2;
            continue;
        }
        if (css[i] === quote) return i + 1;
        i += 1;
    }
    return css.length;
}

/**
 * Split a declaration block into `{ prop: value }`.
 *
 * Tracks quotes and parentheses so a `;` inside `url(a;b)` or `content: ";"`
 * does not cut a declaration in half.
 *
 * A trailing `!important` is dropped: the callers re-serialize this record into
 * a context that has already won (an inline attribute), or only read the
 * property NAMES. Keeping it would put the keyword back into markup where it
 * means nothing.
 *
 * Lives here rather than beside the email inliner that first needed it, so the
 * lint pass can read an operator's declarations WITHOUT importing the renderer.
 */
export function parseDeclarations(body: string,): Record<string, string> {
    const out: Record<string, string> = {};
    let depth = 0;
    let cur = '';
    let i = 0;
    const flush = () => {
        const idx = cur.indexOf(':',);
        if (idx > 0) {
            const prop = cur.slice(0, idx,).trim().toLowerCase();
            const value = cur.slice(idx + 1,).trim();
            if (prop && value) out[prop] = value.replace(/\s*!important\s*$/i, '',);
        }
        cur = '';
    };
    while (i < body.length) {
        const ch = body[i];
        if (ch === '"' || ch === "'") {
            const end = findStringEnd(body, i,);
            cur += body.slice(i, end,);
            i = end;
            continue;
        }
        if (ch === '/' && body[i + 1] === '*') {
            const end = body.indexOf('*/', i + 2,);
            i = end === -1 ? body.length : end + 2;
            continue;
        }
        if (ch === '(') depth += 1;
        else if (ch === ')') depth -= 1;
        if (ch === ';' && depth === 0) {
            flush();
            i += 1;
            continue;
        }
        cur += ch;
        i += 1;
    }
    flush();
    return out;
}

/** Index of the `}` matching the `{` at `start`. */
function findBlockEnd(css: string, start: number,): number {
    let depth = 0;
    let i = start;
    while (i < css.length) {
        const ch = css[i];
        if (ch === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2,);
            i = end === -1 ? css.length : end + 2;
            continue;
        }
        if (ch === '"' || ch === "'") {
            i = findStringEnd(css, i,);
            continue;
        }
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return i;
        }
        i += 1;
    }
    return css.length;
}

/** Split a selector list on top-level commas (not those inside `:is(...)`). */
function splitSelectors(list: string,): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    let i = 0;
    while (i < list.length) {
        const ch = list[i];
        if (ch === '"' || ch === "'") {
            const end = findStringEnd(list, i,);
            cur += list.slice(i, end,);
            i = end;
            continue;
        }
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) {
            out.push(cur,);
            cur = '';
            i += 1;
            continue;
        }
        cur += ch;
        i += 1;
    }
    if (cur.trim()) out.push(cur,);
    return out.map(s => s.trim()).filter(Boolean,);
}

/** Prefix one selector with the scope, honouring a leading `&`. */
function scopeSelector(selector: string, scope: string,): string {
    const sel = selector.trim();
    if (!sel) return sel;
    // `&` anywhere means "the block itself" — `&:hover`, `& > p`, `p &`.
    if (sel.includes('&',)) return sel.replace(/&/g, scope,);
    return `${scope} ${sel}`;
}

/**
 * Scope a stylesheet to `scope` (e.g. `.block[data-block-id="abc"]`).
 *
 * Rules inside `@media` / `@supports` / `@layer` / `@container` are scoped in
 * place, so an operator's own media query still works. `@keyframes` and
 * `@font-face` pass through untouched — their bodies are not selectors, and
 * prefixing `from`/`to` would silently break the animation.
 */
export function scopeCss(css: string | null | undefined, scope: string,): string {
    const src = (css ?? '').trim();
    if (!src || !scope) return '';

    const out: string[] = [];
    for (const node of splitRules(src,)) {
        if ('raw' in node) {
            out.push(node.raw,);
            continue;
        }
        const { prelude, body, } = node;

        if (prelude.startsWith('@',)) {
            if (UNSCOPED_AT_RULES.test(prelude,)) {
                out.push(`${prelude}{${body}}`,);
                continue;
            }
            if (NESTED_AT_RULES.test(prelude,)) {
                out.push(`${prelude}{${scopeCss(body, scope,)}}`,);
                continue;
            }
            // An at-rule we do not recognise: pass it through rather than
            // guess. Dropping it would silently lose the operator's work.
            out.push(`${prelude}{${body}}`,);
            continue;
        }

        if (!prelude) {
            /*
             * Declarations with no selector — the operator wrote
             * `color: red` straight into the box, meaning "this block".
             * That is not valid CSS on its own, but it is the obvious thing
             * to type, so treat it as `& { … }` rather than discarding it.
             */
            out.push(`${scope}{${body}}`,);
            continue;
        }

        const scoped = splitSelectors(prelude,).map(sel => scopeSelector(sel, scope,)).join(',',);
        out.push(`${scoped}{${body}}`,);
    }
    return out.join('',);
}

/**
 * Treat a bare declaration list (`color: red; font-weight: bold`) as a rule for
 * the block itself.
 *
 * Exported for the caller that needs to know whether the operator wrote a
 * stylesheet or just some declarations — the email path inlines the latter
 * directly onto the cell, where there is no stylesheet to rely on.
 */
export function isBareDeclarations(css: string | null | undefined,): boolean {
    const src = (css ?? '').trim();
    if (!src) return false;
    // No braces at all, but has a `prop: value` pair.
    return !src.includes('{',) && /[-\w]+\s*:\s*[^;]+/.test(src,);
}
