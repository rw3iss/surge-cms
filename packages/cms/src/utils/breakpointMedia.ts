import type { SiteBreakpoint, } from '@sitesurge/types';

/** Numeric-only bound → px; otherwise pass the literal (e.g. `'48rem'`). */
function toLen(v: string | undefined,): string {
    const t = (v ?? '').trim();
    if (!t) return '';
    return /^\d+(\.\d+)?$/.test(t,) ? `${t}px` : t;
}

/**
 * Build a CSS media-condition from a breakpoint's bounds (AND-joined), e.g.
 * `(max-width:768px)` or `(min-width:48rem) and (max-width:80rem)`. Returns ''
 * when no bounds are set (→ the caller should treat it as "always"). Shared by
 * the per-block responsive CSS and the per-breakpoint global layout CSS so the
 * two can't drift.
 */
export function breakpointMediaCondition(bp: SiteBreakpoint,): string {
    const parts: string[] = [];
    const minW = toLen(bp.minWidth,); if (minW) parts.push(`(min-width:${minW})`,);
    const maxW = toLen(bp.maxWidth,); if (maxW) parts.push(`(max-width:${maxW})`,);
    const minH = toLen(bp.minHeight,); if (minH) parts.push(`(min-height:${minH})`,);
    const maxH = toLen(bp.maxHeight,); if (maxH) parts.push(`(max-height:${maxH})`,);
    return parts.join(' and ',);
}
