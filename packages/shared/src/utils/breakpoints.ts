import type { SiteBreakpoint, } from '../types/content';

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
 * the per-block responsive CSS (public renderer + email renderer) and the
 * per-breakpoint global layout CSS so the surfaces can't drift.
 */
export function breakpointMediaCondition(bp: SiteBreakpoint,): string {
    const parts: string[] = [];
    const minW = toLen(bp.minWidth,); if (minW) parts.push(`(min-width:${minW})`,);
    const maxW = toLen(bp.maxWidth,); if (maxW) parts.push(`(max-width:${maxW})`,);
    const minH = toLen(bp.minHeight,); if (minH) parts.push(`(min-height:${minH})`,);
    const maxH = toLen(bp.maxHeight,); if (maxH) parts.push(`(max-height:${maxH})`,);
    return parts.join(' and ',);
}

/** Container name the admin's device preview declares, so `@container` rules
 *  fire against the capped preview width instead of the real viewport. */
export const PREVIEW_CONTAINER = 'ss-bp';

/**
 * The same breakpoint as a CONTAINER condition, for the editor's device
 * preview.
 *
 * The preview only caps a container's width — the real viewport is still the
 * whole admin window, so a `@media` rule can never fire there. A container
 * query asks the preview box instead, which is what actually changed.
 *
 * WIDTH BOUNDS ONLY: the preview container uses `container-type: inline-size`,
 * which can answer inline-axis questions and nothing else. A height-bounded
 * breakpoint therefore returns '' — it cannot be simulated, and emitting a
 * query that silently never matches would be worse than not emitting one.
 */
export function breakpointContainerCondition(bp: SiteBreakpoint,): string {
    const parts: string[] = [];
    const minW = toLen(bp.minWidth,); if (minW) parts.push(`(min-width:${minW})`,);
    const maxW = toLen(bp.maxWidth,); if (maxW) parts.push(`(max-width:${maxW})`,);
    return parts.join(' and ',);
}
