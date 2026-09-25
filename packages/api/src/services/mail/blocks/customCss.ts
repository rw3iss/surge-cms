/**
 * A block's operator-authored Custom CSS, translated for email.
 *
 * On the web the whole sheet is scoped and injected as a `<style>`. Email has
 * no such luxury: Gmail strips `<style>` in a forwarded message, several
 * clients drop it outright, and Outlook's Word engine ignores most of what
 * survives. Inline `style` attributes are the only thing that works
 * everywhere — which is why every other part of this renderer is inline.
 *
 * So the sheet is SPLIT by how reliably each rule can be delivered:
 *
 *   1. `&` and bare declarations → merged into the block's own `<td>` style.
 *      Completely reliable, and the shape most operators actually write.
 *   2. A SIMPLE single-element selector (`p`, `.price`, `#total`, `a.btn`)
 *      → inlined onto every matching opening tag in the block's own markup.
 *      Also completely reliable, and covers the rest of the common cases.
 *   3. Everything else — descendant combinators, pseudo-classes, media
 *      queries — → the head `<style>`, scoped to this block. A progressive
 *      enhancement, exactly like the per-breakpoint rules next door.
 *
 * Why not inline everything with a real selector engine: the email HTML is
 * built as strings, so there is no DOM to match against, and a matcher that
 * mostly works would fail silently on the cases it got wrong. A rule that
 * lands in group 3 either applies or does not; a rule a broken matcher
 * misplaces corrupts the message. The boundary is drawn where correctness is
 * certain.
 *
 * Precedence: the operator's declarations are merged LAST, so they beat what
 * this renderer emitted. That mirrors the web, where custom CSS closes the
 * block's cascade layer and overrides the style controls above it.
 */
import { parseCssRules, scopeCss, } from '@sitesurge/types';

/** A selector we can match against a single opening tag. */
interface SimpleSelector {
    /** Lower-case tag name, or '' for "any tag" (a bare `.class` / `#id`). */
    tag: string;
    /** Required class, if any. */
    className: string;
    /** Required id, if any. */
    id: string;
}

export interface InlineRule {
    match: SimpleSelector;
    decls: Record<string, string>;
}

export interface EmailCustomCss {
    /** Declarations for the block's own cell. */
    cell: Record<string, string>;
    /** Rules to inline onto elements inside the block's markup. */
    inline: InlineRule[];
    /** Rules that could not be inlined, already scoped to this block. */
    stylesheet: string;
}

const EMPTY: EmailCustomCss = { cell: {}, inline: [], stylesheet: '', };

/**
 * `tag`, `.class`, `#id`, `tag.class`, `tag#id` — and nothing else.
 *
 * Deliberately strict. Admitting `div p` or `.a .b` here would mean pretending
 * to understand structure this renderer cannot see.
 */
const SIMPLE_SELECTOR = /^([a-z][\w-]*)?(?:([.#])([\w-]+))?$/i;

function parseSimpleSelector(sel: string,): SimpleSelector | null {
    const m = SIMPLE_SELECTOR.exec(sel.trim(),);
    if (!m) return null;
    const [, tag, kind, name,] = m;
    if (!tag && !name) return null; // the empty string matches everything
    return {
        tag: (tag ?? '').toLowerCase(),
        className: kind === '.' ? name : '',
        id: kind === '#' ? name : '',
    };
}

/**
 * Split a declaration block into `{ prop: value }`.
 *
 * Tracks quotes and parentheses so a `;` inside `url(a;b)` or `content: ";"`
 * does not cut a declaration in half.
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
            // A trailing `!important` is meaningless in an inline style that
            // already wins, and noise in the attribute.
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

function findStringEnd(s: string, start: number,): number {
    const quote = s[start];
    let i = start + 1;
    while (i < s.length) {
        if (s[i] === '\\') {
            i += 2;
            continue;
        }
        if (s[i] === quote) return i + 1;
        i += 1;
    }
    return s.length;
}

/**
 * Classify one block's custom CSS into the three delivery groups.
 *
 * `scope` is the selector the leftover stylesheet is scoped to — for email,
 * `[data-block-id="…"]` (there is no `.block` wrapper in a table layout).
 */
export function planCustomCss(css: string | null | undefined, scope: string,): EmailCustomCss {
    if (!css || !css.trim()) return EMPTY;

    const cell: Record<string, string> = {};
    const inline: InlineRule[] = [];
    const leftover: string[] = [];

    for (const rule of parseCssRules(css,)) {
        if (rule.atRule) {
            // A media/supports query cannot be inlined by definition — an
            // inline style has no condition attached to it.
            leftover.push(`${rule.selector}{${rule.body}}`,);
            continue;
        }
        const decls = parseDeclarations(rule.body,);
        // Selector-less declarations mean "this block".
        if (!rule.selector) {
            Object.assign(cell, decls,);
            continue;
        }
        for (const one of rule.selector.split(',',).map(s => s.trim()).filter(Boolean,)) {
            if (one === '&') {
                Object.assign(cell, decls,);
                continue;
            }
            const simple = parseSimpleSelector(one,);
            if (simple && Object.keys(decls,).length) inline.push({ match: simple, decls, },);
            else leftover.push(`${one}{${rule.body}}`,);
        }
    }

    return { cell, inline, stylesheet: scopeCss(leftover.join('',), scope,), };
}

/** `{ a: '1', b: '2' }` → `a:1;b:2`. */
function serialize(decls: Record<string, string>,): string {
    return Object.entries(decls,).map(([k, v,],) => `${k}:${v}`).join(';',);
}

/** Does this opening tag satisfy the selector? */
function tagMatches(tag: string, attrs: string, sel: SimpleSelector,): boolean {
    if (sel.tag && sel.tag !== tag.toLowerCase()) return false;
    if (sel.className) {
        const m = /\sclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs,);
        const classes = (m?.[2] ?? m?.[3] ?? m?.[4] ?? '').split(/\s+/,);
        if (!classes.includes(sel.className,)) return false;
    }
    if (sel.id) {
        const m = /\sid\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs,);
        if ((m?.[2] ?? m?.[3] ?? m?.[4] ?? '') !== sel.id) return false;
    }
    return true;
}

/**
 * Write the matching rules' declarations onto every opening tag in `html`.
 *
 * Operator declarations are merged AFTER any style attribute already present,
 * so they win — an operator reaches for Custom CSS precisely when what the
 * renderer produced is not what they want. This is a small divergence from the
 * web, where an author's own inline style (from the rich-text editor) would
 * beat a stylesheet; in email every style is inline, so honouring that would
 * mean the field could never change anything a renderer had emitted.
 */
export function applyInlineRules(html: string, rules: InlineRule[],): string {
    if (!rules.length || !html) return html;
    // Opening tags only: `<tag …>`, never `</tag>` or `<!-- -->`.
    return html.replace(/<([a-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (whole, tag, attrs,) => {
        const merged: Record<string, string> = {};
        for (const r of rules) if (tagMatches(tag, attrs, r.match,)) Object.assign(merged, r.decls,);
        if (!Object.keys(merged,).length) return whole;

        const styleRe = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i;
        const existing = styleRe.exec(attrs,);
        if (existing) {
            const prior = parseDeclarations(existing[2] ?? existing[3] ?? '',);
            const next = serialize({ ...prior, ...merged, },);
            return `<${tag}${attrs.replace(styleRe, ` style="${next}"`,)}>`;
        }
        // A self-closing tag keeps its slash; appending after it would produce
        // `<br/ style="…">`.
        const selfClosing = attrs.endsWith('/',);
        const base = selfClosing ? attrs.slice(0, -1,) : attrs;
        return `<${tag}${base} style="${serialize(merged,)}"${selfClosing ? ' /' : ''}>`;
    },);
}

/**
 * Turn a scoped stylesheet into `<style>`-ready rules whose declarations beat
 * the inline styles on the same elements.
 *
 * `!important` is the only lever available here. Email has no cascade layers,
 * and every base style in this renderer is an inline attribute, which outranks
 * any stylesheet rule without it. (The web path must NOT do this — there the
 * layers provide precedence and `!important` would break template overrides.)
 */
export function importantify(sheet: string,): string {
    return sheet.replace(/\{([^{}]*)\}/g, (whole, body: string,) => {
        const decls = parseDeclarations(body,);
        const keys = Object.keys(decls,);
        if (!keys.length) return whole;
        return `{${keys.map(k => `${k}:${decls[k]} !important`).join(';',)}}`;
    },);
}
