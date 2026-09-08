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
import type { SiteBreakpoint, } from '../types/content';
import { blockStyleLayoutCss, type BlockStyleCssResolvers, } from './blockStyleCss';
import {
    breakpointContainerCondition,
    breakpointMediaCondition,
    PREVIEW_CONTAINER,
} from './breakpoints';

export interface BlockResponsiveOptions extends BlockStyleCssResolvers {
    /** Resolve a stored color value (hex / swatch ref) to a literal CSS color. */
    resolveColor: (v: string | undefined,) => string | undefined;
    /** Skip width / max-width / height (group-item slot sizing owns those). */
    suppressBox?: boolean;
    /** Skip ONLY `height` — a carousel's height is owned by its "Custom Height"
     *  setting, so a stale `style.height` must not force a fixed wrapper height. */
    suppressHeight?: boolean;
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

/**
 * Serialize a declaration record to `prop:value;` (skips empties).
 *
 * No `!important`. It used to be here for exactly one reason — the block's
 * DEFAULT was an inline style, and nothing in a stylesheet outranks that. Now
 * that defaults are emitted into the `block` layer alongside these overrides,
 * precedence comes from cascade-layer order (see `CascadeLayer`), which beats
 * specificity outright. Re-introducing `!important` here would break the very
 * thing the layers exist to provide: the ability for a later layer — a template
 * instance override — to win cleanly.
 */
function stringifyDecls(rec: Record<string, string | undefined>,): string {
    return Object.entries(rec,)
        .filter(([, v,],) => v != null && v !== '')
        .map(([k, v,],) => `${k}:${v}`)
        .join(';',);
}

/** Escape a block id for safe use inside a `[data-block-id="…"]` selector. */
function escapeId(id: string,): string {
    return id.replace(/["\\]/g, '\\$&',);
}

/**
 * Cascade layers, in the order declared in `packages/cms/index.html`:
 * `@layer theme, tpl, block, block-bp`. Later wins regardless of specificity.
 *
 *  - `tpl`      — a block TEMPLATE's inner-block styles (the reusable component)
 *  - `block`    — a block's own default style (an instance beats the template)
 *  - `block-bp` — that block's per-breakpoint overrides
 */
export type CascadeLayer = 'tpl' | 'block' | 'block-bp';

/** Wrap rules in their layer. Empty input yields no at-rule at all. */
function inLayer(layer: CascadeLayer, rules: string[],): string[] {
    return rules.length ? [`@layer ${layer}{${rules.join('')}}`,] : [];
}

/**
 * Serialize ONE style bag to rules, routed through `targets`.
 *
 * Shared by the default pass and each breakpoint pass, which is what makes the
 * carousel bug unrepresentable: a property's default and its override are
 * resolved by the same `selectorsFor`, so they cannot land on different
 * elements.
 */
function rulesFor(
    styleBag: Record<string, unknown>,
    selectorsFor: (prop: string,) => string[],
    opts: BlockResponsiveOptions,
    /** Full at-rule prefix to wrap each rule in, e.g. `@media (max-width:768px)`
     *  or `@container ss-bp (max-width:768px)`. Omitted → unwrapped. */
    atRule?: string,
): string[] {
    const rec = declarationRecord(styleBag, opts,);

    // Group declarations by target selector so each element gets ONE rule, in a
    // stable order (insertion order of first use).
    const bySelector = new Map<string, Record<string, string>>();
    for (const [prop, value,] of Object.entries(rec,)) {
        if (value == null || value === '') continue;
        for (const sel of selectorsFor(prop,)) {
            const bucket = bySelector.get(sel,) ?? {};
            bucket[prop] = value;
            bySelector.set(sel, bucket,);
        }
    }

    const out: string[] = [];
    for (const [sel, decls,] of bySelector) {
        const d = stringifyDecls(decls,);
        if (d) out.push(atRule ? `${atRule}{${sel}{${d}}}` : `${sel}{${d}}`,);
    }
    return out;
}

/**
 * Build `selectorsFor` for one block id + target map.
 *
 * The `.block` class is load-bearing, not decoration. The admin editor wraps
 * each block in a `.content-block` container that carries the SAME
 * `data-block-id` (it needs it for drag/drop and selection), and inside that
 * container renders the real `.block` wrapper. A bare `[data-block-id]`
 * selector matched both, so a block's padding pushed the editor's header bar
 * in and its background image painted behind the whole editing chrome.
 *
 * Only the public wrapper carries `.block`, so qualifying with it puts the
 * style exactly where it belongs — on the block's content — in the editor and
 * on the live site alike.
 */
function makeSelectorsFor(blockId: string, targets: PropTargets,): (prop: string,) => string[] {
    const base = `.block[data-block-id="${escapeId(blockId,)}"]`;
    const fallback = targets['*'] ?? ['',];
    return (prop: string,) => (targets[prop] ?? fallback).map((d,) => (d ? `${base} ${d}` : base));
}

/**
 * ALL of a block's CSS: its default style plus every per-breakpoint override,
 * as one layered stylesheet. Returns null when the block has no style at all.
 *
 * This replaces the old split where the default was an inline `style={}` and
 * only the overrides were CSS. That split is what allowed a default and its
 * override to drift onto different elements (the carousel `margin` bug), and it
 * forced `!important` on every override just to outrank the inline default.
 *
 * `defaultLayer` lets the template render path emit the SAME styles one layer
 * earlier (`tpl`), so a using block's own style wins without any ordering logic
 * — which matters because a template's `<style>` is nested INSIDE the instance's
 * wrapper and would otherwise win on document order.
 */
export function blockCss(
    blockId: string | undefined,
    style: Record<string, unknown> | undefined,
    breakpoints: SiteBreakpoint[] | undefined,
    opts: BlockResponsiveOptions,
    targets: PropTargets = WRAPPER_ONLY,
    defaultLayer: CascadeLayer = 'block',
): string | null {
    if (!blockId || !style) return null;
    const selectorsFor = makeSelectorsFor(blockId, targets,);

    // `breakpoints` is the override bag, not a CSS property — exclude it from
    // the default pass or it would serialize as garbage declarations.
    const { breakpoints: bps, ...defaults } = style as Record<string, unknown> & {
        breakpoints?: Record<string, Record<string, unknown>>;
    };

    const out: string[] = [
        ...inLayer(defaultLayer, rulesFor(defaults, selectorsFor, opts,),),
    ];

    if (bps && breakpoints?.length) {
        // `suppressHeight` applies to the DEFAULT pass only.
        //
        // It exists because a carousel's default height already reaches the
        // carousel element as a component prop, so emitting it again would be
        // redundant. A per-breakpoint height has no such prop — this CSS is the
        // only way it can ever apply. Suppressing it here silently reverted a
        // carousel to its desktop height on mobile.
        const bpOpts = { ...opts, suppressHeight: false, };
        const bpRules: string[] = [];
        for (const bp of breakpoints) {
            const override = bps[bp.id];
            if (!override || Object.keys(override,).length === 0) continue;
            const media = breakpointMediaCondition(bp,);
            if (media) {
                bpRules.push(...rulesFor(override, selectorsFor, bpOpts, `@media ${media}`,),);
            }
            // The SAME declarations again as a container query, for the editor's
            // device preview. That preview caps a container's width and leaves
            // the viewport alone, so `@media` cannot fire in it; a container
            // query asks the box that actually changed.
            //
            // Emitted always, but inert everywhere except the preview: nothing
            // on the public site declares this container name, so these rules
            // match nothing there and site output is unchanged. That is the
            // point — one stylesheet, no per-block simulation to drift, and
            // nested content (a component's blocks, an entity slide) picks the
            // override up for free instead of needing its own special case.
            const contained = breakpointContainerCondition(bp,);
            if (contained) {
                bpRules.push(
                    ...rulesFor(override, selectorsFor, bpOpts, `@container ${PREVIEW_CONTAINER} ${contained}`,),
                );
            }
        }
        // Breakpoints always land in `block-bp`, even for a template's inner
        // blocks: a responsive rule should still beat a non-responsive one.
        out.push(...inLayer('block-bp', bpRules,),);
    }

    return out.length ? out.join('\n',) : null;
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

    const selectorsFor = makeSelectorsFor(blockId, targets,);
    const rules: string[] = [];
    for (const bp of breakpoints) {
        const override = bps[bp.id];
        if (!override || Object.keys(override,).length === 0) continue;
        const media = breakpointMediaCondition(bp,);
        if (media) rules.push(...rulesFor(override, selectorsFor, opts, `@media ${media}`,),);
    }
    return rules.length ? inLayer('block-bp', rules,).join('\n',) : null;
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
 *  - padding — the ONE genuinely re-routed property. It goes to the slide
 *    content so the backdrop media stays full-bleed (`CarouselBlockRenderer`
 *    feeds it in as `--hero-content-padding`). A CONTENT carousel
 *    (entity/posts items) has no overlay, so it lands on the carousel element.
 *  - everything else (background, colour, alignment) — the WRAPPER, which is
 *    where the default has always been applied.
 *
 * That last line is load-bearing. While defaults were inline and only overrides
 * were CSS, the two could disagree about the target element and nobody noticed
 * until a specific override silently did nothing. Now that both passes read this
 * one map, a disagreement is impossible — so the map has to describe where the
 * DEFAULT actually goes, not where it might be tidier to put it.
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
        padding: [contentSel,],
        '*': ['',],
    };
}
