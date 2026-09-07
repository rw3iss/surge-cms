/**
 * Per-breakpoint responsive CSS for a content block.
 *
 * A block's `style.breakpoints` holds `{ [breakpointId]: { prop: value } }`
 * override bags (see `BlockStyle.breakpoints`). The block's DEFAULT style is
 * applied inline (unchanged legacy path); this builds a scoped `<style>` string
 * of `@media` rules that override the inline default inside each breakpoint's
 * media query. Because a media-query rule has lower priority than an inline
 * style, the override declarations are marked `!important` so they win — scoped
 * tightly to one block via `[data-block-id="…"]`, so the blast radius is a
 * single wrapper.
 *
 * Returns `null` when the block has no breakpoint overrides (the caller then
 * emits no `<style>` and pays zero cost — the common case).
 *
 * Reuses `blockStyleLayoutCss` for the layout/typography subset and adds the
 * background / color / padding props that mapper leaves to callers. `gap` is
 * intentionally excluded (base gap lives on the block's inner element, not the
 * wrapper, so a responsive gap can't be expressed with a wrapper selector).
 */
import type { SiteBreakpoint, } from '@sitesurge/types';
import { blockStyleLayoutCss, type BlockStyleCssResolvers, } from './blockStyleCss';
import { breakpointMediaCondition, } from './breakpointMedia';

export interface BlockResponsiveOptions extends BlockStyleCssResolvers {
    /** Resolve a stored color value (hex / swatch ref) to a literal CSS color. */
    resolveColor: (v: string | undefined,) => string | undefined;
    /** Skip width / max-width / height (group-item slot sizing owns those). */
    suppressBox?: boolean;
}

/** Build the CSS declaration record for one override bag (unfiltered). */
function declarationRecord(
    override: Record<string, unknown>,
    opts: BlockResponsiveOptions,
): Record<string, string | undefined> {
    const rec: Record<string, string | undefined> = {
        ...blockStyleLayoutCss(override, opts,),
    };
    // Background / color / padding — the props blockStyleLayoutCss leaves to
    // callers (the public renderer composites these inline).
    const bgImage = override.backgroundImage as string | undefined;
    const bgColor = override.backgroundColor as string | undefined;
    if (bgImage) {
        rec['background-image'] = `url("${bgImage}")`;
        rec['background-size'] = 'cover';
        rec['background-position'] = (override.backgroundPosition as string | undefined) || 'center';
        rec['background-repeat'] = 'no-repeat';
    } else if (bgColor) {
        rec.background = opts.resolveColor(bgColor,);
    }
    if (override.textColor) rec.color = opts.resolveColor(override.textColor as string,);
    if (override.padding) rec.padding = override.padding as string;
    return rec;
}

/**
 * Where a property's override must land, as descendant selectors relative to the
 * block wrapper. `''` means the wrapper itself; `'*'` is the fallback for every
 * property not named.
 *
 * THE INVARIANT: an override must target the SAME element as that property's
 * DEFAULT. Break it and the override is powerless — the default is an inline
 * style on the wrapper, so a rule aimed at a descendant changes a different
 * element and the wrapper keeps its inline value no matter how `!important` the
 * rule is. That is precisely how a carousel's mobile `margin: 0` override left
 * the desktop `margin: 0 15px` gutters on screen.
 *
 * A property may list SEVERAL targets when its default is genuinely applied in
 * more than one place (a carousel's `min-height` is both inline on the wrapper
 * and a prop on the carousel element).
 */
export type PropTargets = Record<string, string[]>;

/** Everything on the wrapper — every block type except carousel. */
const WRAPPER_ONLY: PropTargets = { '*': ['',], };

/** Serialize a declaration record to `prop:value !important;` (skips empties). */
function stringifyDecls(rec: Record<string, string | undefined>,): string {
    return Object.entries(rec,)
        .filter(([, v,],) => v != null && v !== '')
        .map(([k, v,],) => `${k}:${v} !important`)
        .join(';',);
}

/** Escape a block id for safe use inside a `[data-block-id="…"]` selector. */
function escapeId(id: string,): string {
    return id.replace(/["\\]/g, '\\$&',);
}

export function blockResponsiveCss(
    blockId: string | undefined,
    style: Record<string, unknown> | undefined,
    breakpoints: SiteBreakpoint[] | undefined,
    opts: BlockResponsiveOptions,
    // Per-property override targets (see PropTargets). Omitted → everything on
    // the block wrapper, which is where every non-carousel block puts its
    // default inline style.
    targets: PropTargets = WRAPPER_ONLY,
): string | null {
    if (!blockId) return null;
    const bps = style?.breakpoints as Record<string, Record<string, unknown>> | undefined;
    if (!bps || !breakpoints || breakpoints.length === 0) return null;

    const base = `[data-block-id="${escapeId(blockId,)}"]`;
    const fallback = targets['*'] ?? ['',];
    /** Absolute selectors for one CSS property. */
    const selectorsFor = (prop: string,): string[] =>
        (targets[prop] ?? fallback).map((d,) => (d ? `${base} ${d}` : base));

    const rules: string[] = [];
    for (const bp of breakpoints) {
        const override = bps[bp.id];
        if (!override || Object.keys(override,).length === 0) continue;
        const rec = declarationRecord(override, opts,);

        // Group declarations by target selector so each element gets ONE rule,
        // in a stable order (insertion order of first use).
        const bySelector = new Map<string, Record<string, string>>();
        for (const [prop, value,] of Object.entries(rec,)) {
            if (value == null || value === '') continue;
            for (const sel of selectorsFor(prop,)) {
                const bucket = bySelector.get(sel,) ?? {};
                bucket[prop] = value;
                bySelector.set(sel, bucket,);
            }
        }

        const cond = breakpointMediaCondition(bp,);
        for (const [sel, decls,] of bySelector) {
            const d = stringifyDecls(decls,);
            if (d) rules.push(cond ? `@media ${cond}{${sel}{${d}}}` : `${sel}{${d}}`,);
        }
    }
    return rules.length ? rules.join('\n',) : null;
}

/**
 * Override targets for a carousel, mirroring where each default actually lands
 * (see `BlockRenderer` + `CarouselBlockRenderer`):
 *
 *  - width / max-width / max-height — inline on the WRAPPER.
 *  - margin — inline on the wrapper, AND (media carousels only) the slide
 *    overlay's `--hero-content-margin`, so it has to reach both.
 *  - height — deliberately suppressed on the wrapper; the carousel element owns
 *    it (via the `height` prop / "Custom Height" setting).
 *  - min-height — BOTH: inline on the wrapper and a prop on the carousel.
 *  - everything else (padding, alignment, background, colour) — the slide
 *    content overlay, so the backdrop media stays full-bleed. A CONTENT carousel
 *    (entity/posts items) has no overlay, so those go on the carousel element.
 */
export function carouselPropTargets(isContentCarousel: boolean,): PropTargets {
    const contentSel = isContentCarousel ? '.hero-carousel' : '.hero-carousel__content';
    return {
        width: ['',],
        'max-width': ['',],
        'max-height': ['',],
        margin: isContentCarousel ? ['',] : ['', '.hero-carousel__content',],
        height: ['.hero-carousel',],
        'min-height': ['', '.hero-carousel',],
        '*': [contentSel,],
    };
}
