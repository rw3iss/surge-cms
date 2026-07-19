import { toFlexAlign, } from './cssAlign';

export interface GroupStyleOptions {
    /** Fallback gap when the group sets none. The admin preview uses a visible
     *  default so empty slots read as a grid; the public renderer leaves it
     *  unset. */
    defaultGap?: string;
    /** Minimum container height — the editor floors empty groups so their
     *  slot pickers stay clickable; the public renderer omits it. */
    minHeight?: string;
}

/**
 * Flex-container style for a group block. Shared by the public renderer
 * (`BlockRenderer` GroupBlock) and the admin preview (`ContentBlock`
 * GroupBlockPreview) so the two can't drift — WYSIWYG parity is the whole
 * point of the group block. `data` is the group's settings (public) or data
 * (admin); both carry the same keys. Editor-only affordances (default gap,
 * min-height) are opt-in via `options`.
 */
/** The forced column count for a horizontal group, or `null` when the group
 *  shouldn't force columns (vertical direction, or no valid columns value).
 *  Callers add the `--cols` modifier class + set `--group-cols` when non-null. */
export function groupColumns(data: Record<string, unknown>,): number | null {
    const direction = (data.direction as string) || 'horizontal';
    if (direction !== 'horizontal') return null;
    const cols = Math.trunc(Number(data.columns,),);
    if (!Number.isFinite(cols,) || cols < 1) return null;
    return Math.min(16, cols,);
}

export function groupContainerStyle(
    data: Record<string, unknown>,
    options: GroupStyleOptions = {},
): Record<string, string | undefined> {
    const direction = (data.direction as string) || 'horizontal';
    const gap = (data.gap as string) || options.defaultGap;
    const cols = groupColumns(data,);

    // Columns force an exact N-column grid (each child = 100/N of the row, no
    // wrapping) — flex let children keep their own width and stack. The
    // `--group-cols` var drives `grid-template-columns` in CSS (so a mobile
    // media query can collapse to one column). Vertical / no-columns groups
    // stay flex.
    if (cols) {
        return {
            display: 'grid',
            '--group-cols': String(cols,),
            gap,
            'align-items': toFlexAlign(data.align as string, 'stretch',),
            'justify-items': 'stretch',
            ...(options.minHeight ? { 'min-height': options.minHeight, } : {}),
        };
    }

    return {
        display: 'flex',
        'flex-direction': direction === 'vertical' ? 'column' : 'row',
        'flex-wrap': (data.wrap as string) || 'wrap',
        gap,
        // Flex defaults (stretch / flex-start) match the browser's, so the
        // public renderer's previously-unset values are unchanged; the admin
        // preview now maps `start`/`end` the same way instead of leaking raw
        // keywords.
        'align-items': toFlexAlign(data.align as string, 'stretch',),
        'justify-content': toFlexAlign(data.justify as string, 'flex-start',),
        ...(options.minHeight ? { 'min-height': options.minHeight, } : {}),
    };
}
