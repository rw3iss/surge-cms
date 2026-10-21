/**
 * Pure layout + paging helpers for the gallery views (GalleryView, the Gallery
 * block, `{{gallery()}}`, the /gallery page). No DOM, no Solid — unit-tested.
 */
import { cssLength, } from '@sitesurge/types';
import type {
    GalleryAppearance, GalleryAspect, GalleryBlockLayout, GalleryBlockLayoutOptions, GalleryBlockSettings, GalleryQuery,
} from '@sitesurge/types';

/** The layouts GalleryView renders (block layouts; the page uses a subset). */
export type GalleryViewLayout = GalleryBlockLayout;
/** Block layout options. */
export type GalleryViewLayoutOptions = Omit<GalleryBlockLayoutOptions, 'layout'> & { layout?: GalleryViewLayout; };
/** What GalleryView renders from: GalleryBlockSettings minus the data source. */
export type GalleryViewSettings = Omit<GalleryBlockSettings, 'source' | 'itemIds' | 'query' | 'desktop' | 'mobile'> & {
    desktop?: GalleryViewLayoutOptions;
    mobile?: GalleryViewLayoutOptions;
};

/** Effective per-breakpoint options: mobile values win on mobile, per key, when set. */
export interface ResolvedGalleryLayout {
    layout: GalleryViewLayout;
    columns: number | null;
    itemsPerPage: number;
    scrollBy: number;
    rows: number | null;
    gap: string;
    itemWidth: string | null;
    itemHeight: string | null;
    aspect: GalleryAspect;
    fit: 'cover' | 'contain';
}

const set = (v: unknown,) => v !== undefined && v !== null && v !== '';

export function resolveLayout(
    desktop: GalleryViewLayoutOptions | undefined,
    mobile: GalleryViewLayoutOptions | undefined,
    isMobile: boolean,
): ResolvedGalleryLayout {
    const d = desktop ?? {};
    const m = isMobile ? (mobile ?? {}) : {};
    const pick = <K extends keyof GalleryViewLayoutOptions,>(k: K,) => (set(m[k],) ? m[k] : d[k]);
    const pos = (v: unknown, fallback: number | null,) => {
        const n = Math.round(Number(v,),);
        return Number.isFinite(n,) && n >= 1 ? n : fallback;
    };
    const layout = (set(m.layout,) ? m.layout : d.layout) ?? 'grid';
    return {
        layout,
        columns: pos(pick('columns',), null,),
        itemsPerPage: pos(pick('itemsPerPage',), layout === 'carousel' ? 1 : 3,)!,
        scrollBy: pos(pick('scrollBy',), 1,)!,
        rows: pos(pick('rows',), null,),
        gap: (pick('gap',) as string | undefined) || '12px',
        // A bare number is px (`cssLength`), the same reading the email gives it.
        itemWidth: cssLength(pick('itemWidth',),) ?? null,
        itemHeight: cssLength(pick('itemHeight',),) ?? null,
        aspect: (pick('aspect',) as GalleryAspect | undefined) ?? 'square',
        fit: (pick('fit',) as 'cover' | 'contain' | undefined) ?? 'cover',
    };
}

/** CSS `aspect-ratio` for an aspect setting; `original` = natural size. */
export function aspectRatio(a: GalleryAspect | undefined,): string | undefined {
    switch (a) {
        case 'square': return '1 / 1';
        case '4:3': return '4 / 3';
        case '3:2': return '3 / 2';
        case '16:9': return '16 / 9';
        default: return undefined;
    }
}

// ─── Tile frame (Fit) ─────────────────────────────────────────────────────

/** How a tile's media box is drawn. */
export type TileFrame =
    /** The fixed box (aspect / height), the picture cropped to fill it — or natural size when neither is set. */
    | { kind: 'box'; }
    /** Fit = contain with a known media aspect: the box IS the media, fitted inside the limits. */
    | { kind: 'hug'; width: string; aspectRatio: string; }
    /** Fit = contain, media aspect unknown: the picture scaled down inside the limits, no box. */
    | { kind: 'natural'; maxHeight?: string; };

/** `16 / 9` → 1.777…; anything else → null. */
export function ratioOf(css: string | undefined,): number | null {
    const m = /^\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/.exec(css ?? '',);
    if (!m) return null;
    const r = Number(m[1],) / Number(m[2],);
    return Number.isFinite(r,) && r > 0 ? r : null;
}

/** A media's own aspect (width / height), when known. */
export function mediaAspectOf(m: { width?: number | null; height?: number | null; } | null | undefined,): number | null {
    const w = Number(m?.width,);
    const h = Number(m?.height,);
    return w > 0 && h > 0 ? w / h : null;
}

/**
 * The tile's media frame. Fit = contain no longer letterboxes the media in a
 * filled box: the tile HUGS the media — its own aspect, as wide as the limits
 * allow (the tile width; the Item height, or the box aspect's height) — so the
 * item radius lands on the visible picture. Cover keeps the fixed box.
 *
 *   height set   width = min(100%, height × mediaAspect)
 *   aspect only  width = 100% × min(1, mediaAspect / boxAspect)
 */
export function tileFrame(
    fit: 'cover' | 'contain' | undefined, aspect: string | undefined, height: string | null | undefined, media: number | null,
): TileFrame {
    const box = ratioOf(aspect,);
    if (fit !== 'contain' || (!height && !box)) return { kind: 'box', };
    if (!media) return { kind: 'natural', maxHeight: height || undefined, };
    const r = Math.round(media * 10000,) / 10000;
    const width = height
        ? `min(100%, calc(${height} * ${r}))`
        : `${Math.round(Math.min(1, media / box!,) * 10000,) / 100}%`;
    return { kind: 'hug', width, aspectRatio: String(r,), };
}

// ─── Item width + alignment ───────────────────────────────────────────────

/**
 * `grid-template-columns` for the grid layout.
 *
 *   columns, no itemWidth   → equal columns filling the width (unchanged)
 *   columns + itemWidth     → that many columns, each at most `itemWidth`
 *   itemWidth only          → as many `itemWidth` columns as fit (`auto-fit`,
 *                             so empty tracks collapse and the row can be
 *                             aligned by `justify-content`)
 *   neither                 → auto-fill at `thumbSize` px (unchanged)
 *
 * With an itemWidth the grid can be narrower than the block, so the view's
 * `justify-content` (the block's Horizontal Alignment) places it.
 */
export function gridTemplateColumns(columns: number | null, itemWidth: string | null, thumbSize = 220,): string {
    if (itemWidth) {
        return columns ? `repeat(${columns}, minmax(0, ${itemWidth}))` : `repeat(auto-fit, min(${itemWidth}, 100%))`;
    }
    return columns ? `repeat(${columns}, minmax(0, 1fr))` : `repeat(auto-fill, minmax(min(${thumbSize}px, 100%), 1fr))`;
}

// ─── Masonry ──────────────────────────────────────────────────────────────

/**
 * How the masonry layout is built.
 *
 *   columns set   `columns` stacks, each item in the currently-shortest one
 *                 (`galleryMasonryColumns` — the same placement as the email,
 *                 so items read left-to-right). With an itemWidth each stack
 *                 is at most that wide and the narrower box is placed by the
 *                 alignment (`--gv-justify`).
 *   no columns    CSS multi-column flow at `itemWidth` (else `thumbSize` px)
 *                 per column — as many as fit (the /gallery page's masonry).
 */
export type MasonryPlan = { kind: 'stacks'; columns: number; } | { kind: 'flow'; columnWidth: string; };

export function masonryPlan(columns: number | null, itemWidth: string | null, thumbSize = 220,): MasonryPlan {
    if (columns && columns >= 1) return { kind: 'stacks', columns: Math.round(columns,), };
    return { kind: 'flow', columnWidth: itemWidth || `${thumbSize}px`, };
}

/** A masonry tile's CSS aspect-ratio from its media (reserves the space before the image loads); unknown → natural. */
export function masonryTileAspect(m: { width?: number | null; height?: number | null; } | null | undefined,): string | undefined {
    const w = Number(m?.width,);
    const h = Number(m?.height,);
    return w > 0 && h > 0 ? `${Math.round(w,)} / ${Math.round(h,)}` : undefined;
}

// ─── Paging (row / carousel / paged grid + column) ────────────────────────

/** Last valid START index so the final page is full. */
export const maxStart = (count: number, perPage: number,): number => Math.max(0, count - Math.max(1, perPage,),);

/** Next start: advance by `step`, snap to the last page, then wrap (loop) or stop. */
export function nextStart(cur: number, step: number, count: number, perPage: number, loop: boolean,): number {
    const max = maxStart(count, perPage,);
    if (cur >= max) return loop ? 0 : max;
    return Math.min(cur + Math.max(1, step,), max,);
}

export function prevStart(cur: number, step: number, count: number, perPage: number, loop: boolean,): number {
    const max = maxStart(count, perPage,);
    if (cur <= 0) return loop ? max : 0;
    return Math.max(cur - Math.max(1, step,), 0,);
}

/** Start indexes the dots stand for (each `step` apart, plus the last page). */
export function pageStarts(count: number, perPage: number, step: number,): number[] {
    const max = maxStart(count, perPage,);
    const out: number[] = [];
    for (let i = 0; i < max; i += Math.max(1, step,)) out.push(i,);
    out.push(max,);
    return [...new Set(out,),];
}

/** The dot that is active for a start index (the last page start ≤ it). */
export function activePage(starts: number[], cur: number,): number {
    let idx = 0;
    starts.forEach((s, i,) => {
        if (s <= cur) idx = i;
    },);
    return idx;
}

// ─── Page appearance → view settings ──────────────────────────────────────

/** The /gallery page's appearance as GalleryView settings + extras. */
export function appearanceToView(a: GalleryAppearance,): GalleryViewSettings {
    const layout: GalleryViewLayout = a.layout === 'carousel' ? 'carousel' : a.layout;
    return {
        desktop: { layout, gap: a.gap, aspect: a.aspect, fit: a.fit, itemsPerPage: 1, },
        mobile: {},
        showTitles: a.showTitles,
        showCaptions: a.showCaptions,
        open: a.open,
        thumbStrip: a.open === 'lightbox' && a.thumbStrip,
        itemRadius: a.radius || undefined,
        showArrows: true,
        showDots: true,
        loop: true,
    };
}

/** Page wrapper CSS from appearance (site tokens vs custom values). */
export function pageStyle(a: GalleryAppearance,): Record<string, string> {
    const s: Record<string, string> = {};
    s['padding-inline'] = a.gutter === 'custom' ? (a.customGutter || '16px') : 'var(--site-gutter, 16px)';
    s['padding-block'] = a.padding === 'custom' ? (a.customPadding || '24px') : 'var(--site-page-padding, 24px)';
    if (a.maxWidth === 'custom') {
        if (a.customMaxWidth) s['max-width'] = a.customMaxWidth;
    } else {
        s['max-width'] = 'var(--site-max-width, 1200px)';
    }
    s['margin-inline'] = 'auto';
    s['box-sizing'] = 'border-box';
    s.width = '100%';
    return s;
}

// ─── Entity query (selection modal) ↔ GalleryQuery ────────────────────────
// ONE mapping shared with the server's gallery entity provider (@sitesurge/types).
export { entityQueryToGalleryQuery, galleryQueryToEntityQuery, } from '@sitesurge/types';
