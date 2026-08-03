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

/** Build the `prop:value !important;` declaration string for one override bag. */
function declarations(override: Record<string, unknown>, opts: BlockResponsiveOptions,): string {
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
    // Optional descendant selector to target instead of the block wrapper — used
    // by the carousel, which routes its block-style padding to the slide content
    // (`.hero-carousel__content`), not the outer `.block`, so per-breakpoint
    // overrides must land on the same inner element as the default style.
    innerSelector?: string,
): string | null {
    if (!blockId) return null;
    const bps = style?.breakpoints as Record<string, Record<string, unknown>> | undefined;
    if (!bps || !breakpoints || breakpoints.length === 0) return null;

    const base = `[data-block-id="${escapeId(blockId,)}"]`;
    const sel = innerSelector ? `${base} ${innerSelector}` : base;
    const rules: string[] = [];
    for (const bp of breakpoints) {
        const override = bps[bp.id];
        if (!override || Object.keys(override,).length === 0) continue;
        const decls = declarations(override, opts,);
        if (!decls) continue;
        const cond = breakpointMediaCondition(bp,);
        rules.push(cond ? `@media ${cond}{${sel}{${decls}}}` : `${sel}{${decls}}`,);
    }
    return rules.length ? rules.join('\n',) : null;
}
