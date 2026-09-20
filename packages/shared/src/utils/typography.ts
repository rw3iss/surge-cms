/**
 * Default heading/paragraph rhythm for rich-text content.
 *
 * ONE definition, because three very different renderers have to agree:
 *
 *   - the public site + admin previews, via CSS custom properties
 *     (`utils/appearanceStyle.appearanceGlobalCss`)
 *   - email, which has no stylesheet worth relying on and needs the values
 *     inlined onto each tag (`services/mail/blocks/richText.ts`)
 *   - the settings UI, which shows these as the placeholder defaults
 *
 * Three hard-coded copies would drift, and the drift would only show up as
 * "the email looks different from the page", which nobody reports as a bug.
 *
 * WHY THESE VALUES: browsers give an `<h1>` a large `em`-based margin and a
 * line-height near 1.2 that varies by element, so a heading and the paragraph
 * under it sit at different rhythms. Fixing both to one value makes rich text
 * look the same wherever it is rendered.
 */

export interface TypographyDefaults {
    /** `line-height` for h1–h6 inside rich text. */
    headingLineHeight: string;
    /** `margin` shorthand for h1–h6 inside rich text. */
    headingMargin: string;
    /** `line-height` for `<p>` inside rich text. */
    paragraphLineHeight: string;
    /** `margin` shorthand for `<p>` inside rich text. */
    paragraphMargin: string;
}

export const TYPOGRAPHY_DEFAULTS: TypographyDefaults = {
    headingLineHeight: '1.15em',
    headingMargin: '10px 0px',
    // Body copy needs more leading than a heading to stay readable; headings
    // are short and large, paragraphs are long and small.
    paragraphLineHeight: '1.5',
    paragraphMargin: '10px 0px',
};

/** Resolve the effective values, treating empty strings as "unset". */
export function resolveTypography(
    a: Partial<TypographyDefaults> | null | undefined,
): TypographyDefaults {
    const pick = (v: string | undefined, fallback: string,): string => {
        const t = (v ?? '').trim();
        return t.length > 0 ? t : fallback;
    };
    return {
        headingLineHeight: pick(a?.headingLineHeight, TYPOGRAPHY_DEFAULTS.headingLineHeight,),
        headingMargin: pick(a?.headingMargin, TYPOGRAPHY_DEFAULTS.headingMargin,),
        paragraphLineHeight: pick(a?.paragraphLineHeight, TYPOGRAPHY_DEFAULTS.paragraphLineHeight,),
        paragraphMargin: pick(a?.paragraphMargin, TYPOGRAPHY_DEFAULTS.paragraphMargin,),
    };
}

/** Tags the rich-text defaults apply to. */
export const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6',] as const;

/**
 * Add default `line-height`/`margin` to heading and paragraph tags in an HTML
 * string, for renderers with no stylesheet (email).
 *
 * ONLY fills in what the element does not already declare — these are
 * DEFAULTS, so an author who set a margin on one heading keeps it. That also
 * means content carrying pasted inline styles (Google Docs writes
 * `line-height:1.38;margin-top:12pt`) keeps them here; the fix for that is to
 * stop the paste carrying them in, not to fight it at render time.
 *
 * String-level rather than DOM-based because this runs server-side in the mail
 * renderer, where there is no DOM, and the input has already been sanitised.
 */
export function applyTypographyInline(html: string, t: TypographyDefaults,): string {
    if (!html) return html;

    return html.replace(
        /<(h[1-6]|p)(\s[^>]*)?>/gi,
        (match, tag: string, attrs: string | undefined,) => {
            const isHeading = tag.toLowerCase() !== 'p';
            const lineHeight = isHeading ? t.headingLineHeight : t.paragraphLineHeight;
            const margin = isHeading ? t.headingMargin : t.paragraphMargin;

            const existing = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs ?? '',);
            const styleText = existing ? (existing[2] ?? existing[3] ?? '') : '';

            const declares = (prop: string,): boolean =>
                new RegExp(`(^|;)\\s*${prop}\\s*:`, 'i',).test(styleText,);

            const additions: string[] = [];
            // `margin-top`/`margin-bottom` count as declaring the margin: a
            // pasted heading sets those two rather than the shorthand, and
            // adding a shorthand alongside would depend on order to decide the
            // winner.
            if (!declares('line-height',)) additions.push(`line-height:${lineHeight}`,);
            if (!declares('margin',) && !declares('margin-top',) && !declares('margin-bottom',)) {
                additions.push(`margin:${margin}`,);
            }
            if (additions.length === 0) return match;

            const merged = [styleText.trim().replace(/;$/, '',), ...additions,]
                .filter(Boolean,)
                .join(';',);

            const rest = existing
                ? (attrs ?? '').replace(existing[0], '',).trim()
                : (attrs ?? '').trim();

            return `<${tag}${rest ? ` ${rest}` : ''} style="${merged}">`;
        },
    );
}
