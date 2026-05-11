/**
 * Tiny string-rendering helpers shared across all per-block-type email
 * renderers. Email HTML rules:
 *   - Inline styles only (no class names, no <style> reliance).
 *   - Table-based outer layout.
 *   - Explicit width/height attrs on images for Outlook.
 *   - Escape any operator-supplied text (rich_text + html are explicit
 *     exceptions; they get sanitized via the existing util).
 */

export function escapeHtml(s: string,): string {
    return s.replace(/[&<>"']/g, (c,) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    } as Record<string, string>)[c]!,);
}

export function inlineStyle(obj: Record<string, string | number | undefined>,): string {
    return Object.entries(obj,)
        .filter(([, v,],) => v !== undefined && v !== '' && v !== null,)
        .map(([k, v,],) => `${k}:${v}`,)
        .join(';',);
}

/** Convert an HTTP-ish URL relative path into an absolute URL anchored
 *  at the site root, for email-client clients that don't follow
 *  relative links. */
export function absUrl(siteUrl: string, link: string,): string {
    if (!link) return siteUrl || '#';
    if (/^https?:\/\//i.test(link,)) return link;
    if (!siteUrl) return link;
    return siteUrl.replace(/\/+$/, '',) + (link.startsWith('/',) ? link : `/${link}`);
}
