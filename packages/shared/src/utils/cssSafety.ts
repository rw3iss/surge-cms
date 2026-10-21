/**
 * ONE rule for "may this operator-typed value go inside a CSS declaration?".
 *
 * Every style value an editor types (a banner position, a block's padding, a
 * gallery gap) ends up interpolated into a `<style>` sheet or a `style=""`
 * attribute. A value that can end the declaration (`;`), open or close a rule
 * (`{` `}`), close the element (`<` `>`), start a comment, or LOAD something
 * (`url(`, `@import`, the old IE `expression(`) is refused.
 *
 * The backslash is refused too: a CSS escape such as `\75 rl(` decodes to
 * `url(` in the browser, so without it the `url(` check is sidestepped.
 *
 * Quotes are refused by default. `allowQuotes` lets a font stack such as
 * `"Inter", sans-serif` through — but only when every quote is paired, since an
 * unclosed string swallows the rest of the line.
 *
 * Shared by the API (write-side validation) and the renderers (`blockCss` drops
 * an unsafe value that predates the check), so the two cannot disagree.
 */
const UNSAFE_CSS_VALUE = /[;{}<>\\]|\/\*|\*\/|url\s*\(|image-set\s*\(|expression\s*\(|@import|javascript:/i;

export interface CssSafetyOptions {
    /** Permit balanced `"` / `'` (font stacks). Default false. */
    allowQuotes?: boolean;
}

function quotesBalanced(s: string,): boolean {
    return (s.split('"',).length - 1) % 2 === 0 && (s.split("'",).length - 1) % 2 === 0;
}

/** True when `v` can be dropped into a CSS declaration value as-is. */
export function isSafeCssValue(v: string, opts: CssSafetyOptions = {},): boolean {
    if (UNSAFE_CSS_VALUE.test(v,)) return false;
    if (/[\r\n]/.test(v,)) return false;
    if (/["']/.test(v,)) return !!opts.allowQuotes && quotesBalanced(v,);
    return true;
}

/**
 * True when `v` is safe inside `url("…")`. The value is a URL, not CSS, so
 * `url(` is not the concern here — escaping the quoted string is: a `"`, a
 * backslash, a newline or markup brackets are refused, and so is a
 * `javascript:` / `data:text` scheme.
 */
export function isSafeCssUrl(v: string,): boolean {
    if (/["\\<>\r\n]/.test(v,)) return false;
    return !/^\s*(javascript|vbscript|data:text)/i.test(v,);
}

/**
 * The block `style` keys whose value is emitted as CSS. The bag is open (see
 * `api/blockStyleInput.ts`), so only these are checked — a non-CSS key such as
 * a template `name` may hold any text.
 */
export const BLOCK_STYLE_CSS_KEYS = [
    'backgroundColor', 'backgroundImage', 'backgroundPosition', 'textColor', 'textAlign', 'verticalAlign',
    'horizontalAlign', 'fontFamily', 'fontSize', 'lineHeight', 'width', 'maxWidth', 'minHeight', 'height',
    'maxHeight', 'borderRadius', 'padding', 'margin', 'gap', 'overflowX', 'overflowY', 'order',
] as const;

/** A CSS `order` value: an integer (optionally signed). */
export function isCssOrder(v: unknown,): boolean {
    return /^\s*[+-]?\d{1,6}\s*$/.test(String(v ?? '',),);
}

/** Is one block style value safe for its key? Non-strings and empties pass. */
export function isSafeBlockStyleValue(key: string, v: unknown,): boolean {
    if (typeof v !== 'string' || v === '') return true;
    if (key === 'backgroundImage') return isSafeCssUrl(v,);
    if (key === 'order') return isCssOrder(v,);
    return isSafeCssValue(v, { allowQuotes: key === 'fontFamily', },);
}

/**
 * The first unsafe CSS key in a block style bag (base level, then every
 * breakpoint bag), as `key` or `breakpoints.<id>.key`; null when all are safe.
 */
export function findUnsafeBlockStyleKey(style: Record<string, unknown> | null | undefined,): string | null {
    if (!style || typeof style !== 'object') return null;
    const check = (bag: Record<string, unknown>,): string | null => {
        for (const key of BLOCK_STYLE_CSS_KEYS) if (!isSafeBlockStyleValue(key, bag[key],)) return key;
        return null;
    };
    const base = check(style,);
    if (base) return base;
    const bps = style.breakpoints;
    if (bps && typeof bps === 'object') {
        for (const [id, bag,] of Object.entries(bps as Record<string, unknown>,)) {
            if (bag && typeof bag === 'object') {
                const k = check(bag as Record<string, unknown>,);
                if (k) return `breakpoints.${id}.${k}`;
            }
        }
    }
    return null;
}

/** A block style `order` as an integer, or null when unset / not a valid CSS order. */
export function parseCssOrder(v: unknown,): number | null {
    if (typeof v === 'number') return Number.isInteger(v,) && Math.abs(v,) < 1e6 ? v : null;
    if (typeof v !== 'string' || !isCssOrder(v,)) return null;
    return parseInt(v.trim(), 10,);
}
