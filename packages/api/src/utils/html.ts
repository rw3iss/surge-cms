/**
 * HTML text escaping — the one source of truth (do not re-declare this
 * elsewhere; import it). Escapes the five HTML-significant characters
 * `& < > " '` so operator-supplied text can't break out of an attribute
 * or element context.
 *
 * Accepts `unknown`: `null`/`undefined` become `''`, `Date` coerces to
 * its ISO string (for meta timestamps), everything else via `String()`.
 * This is the superset of the previously-duplicated implementations, so
 * every prior call site's output is unchanged.
 */
export function escapeHtml(s: unknown,): string {
    if (s === null || s === undefined) return '';
    let str: string;
    if (s instanceof Date) {
        str = s.toISOString();
    } else if (typeof s === 'string') {
        str = s;
    } else {
        str = String(s,);
    }
    return str
        .replace(/&/g, '&amp;',)
        .replace(/</g, '&lt;',)
        .replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',)
        .replace(/'/g, '&#39;',);
}
