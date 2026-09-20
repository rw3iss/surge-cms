/**
 * Final pass over a rendered email, applied to BOTH the preview and the send.
 *
 * Two jobs, both of which exist because an email is not a web page:
 *
 *  1. **Absolutise URLs.** A block authored for the site writes
 *     `href="/posts/my-slug"`, which is correct there and DEAD in an inbox —
 *     a mail client has no base URL to resolve it against. The main
 *     call-to-action of every newsletter was a link to nowhere.
 *
 *  2. **Derive a plain-text alternative.** Every message was sent as a single
 *     `text/html` part. HTML-only bulk mail is a long-standing spam signal
 *     (SpamAssassin scores it as `MIME_HTML_ONLY`), and some clients and
 *     previews prefer text.
 */

/** Attributes that carry a URL we should absolutise. */
const URL_ATTRS = ['href', 'src', 'background', 'poster',];

/**
 * Rewrite root-relative URLs to absolute ones.
 *
 * Only `/…` paths are touched. Left alone deliberately:
 *   - already-absolute (`https:`, `//cdn…`)
 *   - `mailto:` / `tel:` — not locations
 *   - `#anchor` — meaningless in an email either way, and prefixing it would
 *     produce a link to the homepage, which is worse than a no-op
 *   - `{{…}}` — an unresolved template token; the resolver runs after this and
 *     substitutes a full URL
 *   - `data:` URIs
 */
export function absolutiseUrls(html: string, siteUrl: string,): string {
    const base = (siteUrl || '').replace(/\/+$/, '',);
    if (!base || !html) return html;

    const attrs = URL_ATTRS.join('|',);
    // Matches `href="/path"` and `href='/path'`. The value must start with a
    // single `/` — `//host` is protocol-relative and already absolute.
    const re = new RegExp(`\\b(${attrs})=(["'])(/(?!/)[^"']*)\\2`, 'gi',);
    return html.replace(re, (_m, attr: string, quote: string, path: string,) =>
        `${attr}=${quote}${base}${path}${quote}`
    );
}

/** Block-level tags that should produce a line break in the text version. */
const BLOCK_TAGS = 'address|article|aside|blockquote|div|dl|dd|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul';

const ENTITIES: Record<string, string> = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&ndash;': '–',
    '&hellip;': '…', '&rarr;': '→', '&larr;': '←', '&copy;': '©',
};

/**
 * Derive a readable plain-text version of a rendered email.
 *
 * Deliberately NOT a general HTML-to-text library: the input is our own
 * table-based email markup, so a focused converter avoids a dependency and
 * handles the two things that actually matter for these messages — links
 * keeping their destination, and the table layout not collapsing into one run-on
 * line.
 *
 * A link becomes `text (url)` so the reader can still reach it, which is the
 * whole point of the text part; a link whose text already IS the URL is not
 * duplicated.
 */
export function htmlToText(html: string,): string {
    if (!html) return '';

    let out = html;

    // Drop anything with no textual meaning. `<style>` first — its contents
    // would otherwise survive tag-stripping as a wall of CSS.
    out = out.replace(/<style[\s\S]*?<\/style>/gi, '',);
    out = out.replace(/<script[\s\S]*?<\/script>/gi, '',);
    out = out.replace(/<!--[\s\S]*?-->/g, '',);
    // The preheader is a hidden one-line inbox preview; in a text part it reads
    // as a stray duplicate of the subject.
    out = out.replace(/<div[^>]*class="[^"]*preheader[^"]*"[\s\S]*?<\/div>/gi, '',);

    // An image with alt text carries meaning; one without is decoration.
    out = out.replace(/<img[^>]*\balt="([^"]+)"[^>]*>/gi, (_m, alt: string,) => `[${alt}]`,);
    out = out.replace(/<img[^>]*>/gi, '',);

    // Links: keep the destination. Done before tag-stripping so the href is
    // still available.
    out = out.replace(
        /<a[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
        (_m, href: string, inner: string,) => {
            const text = inner.replace(/<[^>]+>/g, '',).replace(/\s+/g, ' ',).trim();
            const url = href.trim();
            if (!url || url.startsWith('#',)) return text;
            if (!text) return url;
            // Don't render "https://x (https://x)".
            return text === url ? url : `${text} (${url})`;
        },
    );

    out = out.replace(/<br\s*\/?>/gi, '\n',);
    // Headings get a blank line either side so the text has structure.
    out = out.replace(/<\/h[1-6]>/gi, '\n\n',);
    out = out.replace(new RegExp(`</(?:${BLOCK_TAGS})>`, 'gi',), '\n',);
    out = out.replace(/<[^>]+>/g, '',);

    for (const [entity, char,] of Object.entries(ENTITIES,)) {
        out = out.split(entity,).join(char,);
    }
    // Numeric entities (&#8212; etc.).
    out = out.replace(/&#(\d+);/g, (_m, code: string,) => String.fromCharCode(Number(code,),),);

    return out
        // Collapse runs of spaces/tabs, but not newlines.
        .replace(/[ \t ]+/g, ' ',)
        .replace(/ *\n */g, '\n',)
        // At most one blank line between blocks.
        .replace(/\n{3,}/g, '\n\n',)
        .trim();
}

/**
 * Prepare a rendered email for delivery: absolutise its URLs and derive the
 * text alternative.
 *
 * One function so the two steps always happen together and in the right order
 * — the text part must be derived AFTER the links are absolutised, or it would
 * quote `/posts/x` as the destination.
 */
export function finalizeEmail(html: string, siteUrl: string,): { html: string; text: string; } {
    const absolute = absolutiseUrls(html, siteUrl,);
    return { html: absolute, text: htmlToText(absolute,), };
}
