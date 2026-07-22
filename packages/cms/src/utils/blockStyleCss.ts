/**
 * Shared block-style → CSS mapping for the LAYOUT + TYPOGRAPHY subset of a
 * block style (text-align, vertical alignment, font, box sizing, margin,
 * overflow, horizontal-align var).
 *
 * WHY this exists: the same mapping was hand-written twice — once in the public
 * `BlockRenderer` wrapper and once in the admin `ContentBlock` inline-edit
 * preview — and drifted, so the admin preview silently ignored width / max-width
 * / min-height / height / margin / horizontal-align. Both paths now call this
 * one pure function, so a new style property is added in ONE place.
 *
 * Scope note: background color/image and padding stay in each caller — the
 * public path composites a color+image overlay and cascades a site-default
 * padding, neither of which the flat admin preview has. This helper covers
 * exactly the properties that are computed purely from the block style with
 * identical semantics in both contexts.
 */

/** Injected resolvers keep this util framework-free (matches groupStyle.ts). */
export interface BlockStyleCssResolvers {
    /** e.g. `fontStack` from utils/appearanceStyle — maps a font id to a stack. */
    resolveFont: (v: string | undefined,) => string | undefined;
    /** e.g. `(v) => toFlexAlign(v, 'flex-start')` — maps a horizontal-align
     *  keyword to a flex value emitted as the `--block-h-align` custom prop. */
    resolveHAlign: (v: string | undefined,) => string | undefined;
}

export interface BlockStyleCssOptions extends BlockStyleCssResolvers {
    /** Group-item wrappers own their width/flex via the parent group's slot
     *  sizing, so skip width / max-width / height here (min-height still
     *  applies). Defaults to false. */
    suppressBox?: boolean;
}

type CssRecord = Record<string, string | undefined>;

/**
 * Build the layout + typography CSS for a resolved block style. Returns only
 * the properties the style actually sets (everything else omitted), so the
 * result can be spread into a larger style object without clobbering.
 */
export function blockStyleLayoutCss(
    style: Record<string, any> | undefined,
    opts: BlockStyleCssOptions,
): CssRecord {
    const s = style || {};
    const out: CssRecord = {};

    if (s.textAlign) out['text-align'] = s.textAlign;

    // Vertical alignment turns the block into a flex column so its content can
    // be pushed to the center/bottom. 'top' (or unset) leaves normal flow.
    if (s.verticalAlign && s.verticalAlign !== 'top') {
        out.display = 'flex';
        out['flex-direction'] = 'column';
        out['justify-content'] = s.verticalAlign === 'center'
            ? 'center'
            : s.verticalAlign === 'bottom'
            ? 'flex-end'
            : undefined;
    }

    if (s.fontSize) out['font-size'] = s.fontSize;
    if (s.lineHeight) out['line-height'] = s.lineHeight;
    const ff = opts.resolveFont(s.fontFamily,);
    if (ff) out['font-family'] = ff;

    // Box sizing. A group_item's slot sizing owns width/flex, so it opts out.
    if (!opts.suppressBox) {
        if (s.width) out.width = s.width;
        if (s.maxWidth) out['max-width'] = s.maxWidth;
        if (s.height) out.height = s.height;
    }
    if (s.minHeight) out['min-height'] = s.minHeight;

    // Horizontal alignment → a CSS var the block's item row/grid reads as its
    // justify-content (e.g. the social grid).
    if (s.horizontalAlign) {
        const h = opts.resolveHAlign(s.horizontalAlign,);
        if (h) out['--block-h-align'] = h;
    }

    // A single-value margin auto-centers the block ("16px" → "16px auto");
    // multi-value margins and "auto" pass through untouched.
    if (s.margin) {
        const m = String(s.margin,).trim();
        const parts = m.split(/\s+/,);
        out.margin = parts.length === 1 && m !== 'auto' ? `${m} auto` : m;
    }

    if (s.overflowX) out['overflow-x'] = s.overflowX;
    if (s.overflowY) out['overflow-y'] = s.overflowY;

    return out;
}
