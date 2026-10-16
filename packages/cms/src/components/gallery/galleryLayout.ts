/**
 * Pure layout + paging helpers for the gallery views (GalleryView, the Gallery
 * block, `{{gallery()}}`, the /gallery page). No DOM, no Solid — unit-tested.
 */
import type {
    GalleryAppearance, GalleryAspect, GalleryBlockLayout, GalleryBlockLayoutOptions, GalleryBlockSettings, GalleryQuery,
} from '@sitesurge/types';

/** The block layouts + the page-only `masonry`. */
export type GalleryViewLayout = GalleryBlockLayout | 'masonry';
/** Block layout options, allowing the page-only `masonry`. */
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
        itemWidth: (pick('itemWidth',) as string | undefined) || null,
        itemHeight: (pick('itemHeight',) as string | undefined) || null,
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
        radius: a.radius || undefined,
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

// ─── Entity query (selection modal) → GalleryQuery ────────────────────────

interface EntityQueryLike {
    search?: string;
    filter?: Record<string, unknown>;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    limit?: number;
}

function filterValue(f: Record<string, unknown> | undefined, key: string,): string | undefined {
    const raw = f?.[key];
    const v = raw !== null && typeof raw === 'object' && !Array.isArray(raw,) && 'value' in (raw as object)
        ? (raw as { value: unknown; }).value
        : raw;
    if (v === undefined || v === null) return undefined;
    const s = Array.isArray(v,) ? v.map(String,).join(',',) : String(v,);
    return s.trim() || undefined;
}

/** The "Configure query" modal's EntityQuery (gallery_item virtual filters type/tag/sort) → GalleryQuery. */
export function entityQueryToGalleryQuery(q: EntityQueryLike | null | undefined, limit?: number,): GalleryQuery {
    const type = filterValue(q?.filter, 'type',);
    const sortVal = filterValue(q?.filter, 'sort',);
    const sortFromBy = q?.sortBy === 'createdAt' ? (q.sortOrder === 'asc' ? 'oldest' : 'newest') : q?.sortBy === 'title' ? 'title' : undefined;
    const sort = (['order', 'newest', 'oldest', 'title', 'random',].includes(sortVal ?? '',) ? sortVal : sortFromBy) as GalleryQuery['sort'];
    const out: GalleryQuery = {
        type: type === 'image' || type === 'video' ? type : 'all',
        sort: sort ?? 'order',
    };
    const tag = filterValue(q?.filter, 'tag',);
    if (tag) out.tag = tag;
    if (q?.search?.trim()) out.search = q.search.trim();
    const lim = limit ?? q?.limit;
    if (lim && lim > 0) out.limit = Math.min(200, Math.round(lim,),);
    return out;
}

/** GalleryQuery → the EntityQuery the modal re-opens with. */
export function galleryQueryToEntityQuery(q: GalleryQuery | undefined,): { search?: string; filter?: Record<string, unknown>; limit?: number; } {
    const filter: Record<string, unknown> = {};
    if (q?.type && q.type !== 'all') filter.type = q.type;
    if (q?.tag) filter.tag = q.tag;
    if (q?.sort && q.sort !== 'order') filter.sort = q.sort;
    return { search: q?.search, filter: Object.keys(filter,).length ? filter : undefined, limit: q?.limit, };
}
