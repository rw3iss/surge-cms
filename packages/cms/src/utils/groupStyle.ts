import { GROUP_MAX_COLUMNS, groupColumnTracks, groupLayoutOf, groupSlotWidth, } from '@sitesurge/types';
import { toFlexAlign, } from './cssAlign';

export interface GroupStyleOptions {
    /** Fallback gap when the group sets none. The admin preview uses a visible
     *  default so empty slots read as a grid; the public renderer leaves it
     *  unset. */
    defaultGap?: string;
    /** Minimum container height — the editor floors empty groups so their
     *  slot pickers stay clickable; the public renderer omits it. */
    minHeight?: string;
    /** The block style's gap (admin preview, breakpoint-merged). */
    gap?: string;
    /** Each slot's width (its Width property or style width), in slot order —
     *  a column grid sizes its columns from them (see `groupTracks`). */
    slotWidths?: Array<string | null | undefined>;
}

/**
 * `grid-template-columns` tracks for a column grid from its slots' widths, or
 * null when no slot sets one (→ N equal columns). The rule itself
 * (`groupColumnTracks`, shared with email) lives in `@sitesurge/types`.
 */
export function groupTracks(widths: Array<string | null | undefined>, columns: number,): string | null {
    const tracks = groupColumnTracks(widths, columns,);
    if (!tracks) return null;
    return tracks.map((t,) => ('fixed' in t ? `minmax(0, ${t.fixed})` : `minmax(0, ${t.fr}fr)`)).join(' ',);
}

/** The forced column count for a horizontal group, or `null` when the group
 *  shouldn't force columns (vertical direction, or no valid columns value).
 *  Callers add the `--cols` modifier class + set `--group-cols` when non-null. */
export function groupColumns(data: Record<string, unknown>,): number | null {
    const direction = (data.direction as string) || 'horizontal';
    // Grid: always exactly `columns` tracks; the rows come from the slot count
    // (columns × rows cells, `groupLayoutOf`), so no row template is needed.
    if (direction === 'grid') return groupLayoutOf(data,).columns;
    if (direction !== 'horizontal') return null;
    const cols = Math.trunc(Number(data.columns,),);
    if (!Number.isFinite(cols,) || cols < 1) return null;
    return Math.min(GROUP_MAX_COLUMNS, cols,);
}

/** A slot's width for its group's column tracks: its Width property, else its style width. */
export const slotWidthOf = groupSlotWidth;

/** Whether a horizontal group should stack to a single column on mobile.
 *  A `nowrap` horizontal group can never wrap its slots, so on a phone its
 *  columns get crushed (e.g. a 1/3 + 2/3 split → ~127px + ~255px). Callers
 *  add the `--stack-mobile` modifier class (CSS collapses it to a column and
 *  forces slot width to 100% under the mobile breakpoint). Wrapping groups
 *  and column-grids already reflow, so they're excluded. */
export function groupStacksMobile(data: Record<string, unknown>,): boolean {
    const direction = (data.direction as string) || 'horizontal';
    if (direction === 'vertical' || direction === 'grid') return false;
    if (groupColumns(data,) != null) return false;
    return (data.wrap as string) === 'nowrap';
}

/**
 * Flex/grid-item CSS for a single group_item slot. The public renderer applies
 * this to the `.block--group_item` element (the flex/grid item); the admin
 * preview must apply the SAME sizing to its slot wrapper so items lay out (and
 * respect the group's justify/align) identically — otherwise admin items fill
 * the container and justify-content has nothing to distribute. `parent` supplies
 * the group's item-size defaults (itemMinWidth, …).
 */
export function groupSlotItemStyle(
    item: Record<string, unknown>,
    parent: Record<string, unknown> = {},
): Record<string, string | undefined> {
    // In a column grid the slot's width sizes its COLUMN (groupTracks), so the
    // slot itself fills the column — applying it here too shrank the slot
    // inside its column (80% of a half). Flex rows still size the item.
    const width = groupColumns(parent,) != null ? undefined : ((item.width as string) || undefined);
    const alignSelf = (() => {
        const v = item.alignSelf as string | undefined;
        if (!v) return undefined;
        if (v === 'start') return 'flex-start';
        if (v === 'end') return 'flex-end';
        return v;
    })();
    // A Column group stacks its slots at their content height: `1 1 0` there
    // would share the group's HEIGHT between them, so a group stretched by its
    // row (e.g. beside a taller sibling) spread its slots apart with empty space.
    const vertical = ((item.__groupDirection as string | undefined) ?? (parent.direction as string | undefined)) === 'vertical';
    return {
        // A slot with an explicit width sizes to it; otherwise it shares the row.
        flex: width || vertical ? '0 0 auto' : '1 1 0',
        width,
        'min-width': (item.minWidth as string) || (parent.itemMinWidth as string) || undefined,
        'max-width': (item.maxWidth as string) || (parent.itemMaxWidth as string) || undefined,
        'min-height': (item.minHeight as string) || (parent.itemMinHeight as string) || undefined,
        'max-height': (item.maxHeight as string) || (parent.itemMaxHeight as string) || undefined,
        height: (item.height as string) || undefined,
        'align-self': alignSelf,
    };
}

/**
 * Flex-container style for a group block. Shared by the public renderer
 * (`BlockRenderer` GroupBlock) and the admin preview (`ContentBlock`
 * GroupBlockPreview) so the two can't drift — WYSIWYG parity is the whole
 * point of the group block. `data` is the group's settings (public) or data
 * (admin); both carry the same keys. Editor-only affordances (default gap,
 * min-height) are opt-in via `options`.
 */
export function groupContainerStyle(
    data: Record<string, unknown>,
    options: GroupStyleOptions = {},
): Record<string, string | undefined> {
    const direction = (data.direction as string) || 'horizontal';
    // The slot gap is the block STYLE's Gap (emitted by blockCss onto
    // `.block--group`, per breakpoint). `data.gap` is the retired group setting
    // (migration 181 moved it into the style) — still honoured if one remains,
    // inline, so it only applies when the style sets none. The admin preview
    // passes its resolved style gap as `options.gap`.
    const gap = options.gap || (data.gap as string) || options.defaultGap;
    const cols = groupColumns(data,);

    // Columns force an exact N-column grid (each child = 100/N of the row, no
    // wrapping) — flex let children keep their own width and stack. The
    // `--group-cols` var drives `grid-template-columns` in CSS (so a mobile
    // media query can collapse to one column). Vertical / no-columns groups
    // stay flex.
    if (cols) {
        const tracks = options.slotWidths ? groupTracks(options.slotWidths, cols,) : null;
        return {
            display: 'grid',
            '--group-cols': String(cols,),
            // ALWAYS set (equal columns when no slot has a width): custom
            // properties inherit, so a nested group that left it unset picked up
            // its PARENT's tracks (a 1-column component inside an 80/20 row
            // rendered as two columns).
            '--group-tracks': tracks ?? `repeat(${cols}, minmax(0, 1fr))`,
            gap,
            'align-items': toFlexAlign(data.align as string, 'stretch',),
            // Main-axis distribution still applies to the grid tracks (visible
            // when items don't fill the row); default stretches to fill.
            'justify-content': toFlexAlign(data.justify as string, 'stretch',),
            'justify-items': 'stretch',
            ...(options.minHeight ? { 'min-height': options.minHeight, } : {}),
        };
    }

    return {
        display: 'flex',
        'flex-direction': direction === 'vertical' ? 'column' : 'row',
        // A Column never wraps: a wrapping column flex box with a definite
        // height (a group stretched by its row) spreads its slots apart instead
        // of stacking them at their content height.
        'flex-wrap': direction === 'vertical' ? 'nowrap' : ((data.wrap as string) || 'wrap'),
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
