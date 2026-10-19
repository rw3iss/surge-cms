/**
 * The Group block's layout, read ONE way by the admin editor (slot count,
 * preview), the site renderer and the email renderer.
 *
 * Stored on `settings.direction` (the key predates "Layout"):
 *   `horizontal` — Row: `columns` slots side by side (a column grid on the web)
 *   `vertical`   — Column: `columns` slots stacked
 *   `grid`       — Grid: `columns` × `rows` cells, filled left→right, top→bottom
 */
export type GroupLayout = 'horizontal' | 'vertical' | 'grid';

export const GROUP_MAX_COLUMNS = 16;
export const GROUP_MAX_ROWS = 16;
export const GROUP_DEFAULT_COLUMNS = 2;
export const GROUP_DEFAULT_ROWS = 2;

export interface ResolvedGroupLayout {
    layout: GroupLayout;
    columns: number;
    /** Grid only (1 for row / column). */
    rows: number;
    /** How many slots (group_item children) the group should have. */
    slots: number;
}

function count(v: unknown, fallback: number, max: number,): number {
    const n = Math.trunc(Number(v,),);
    return Number.isFinite(n,) && n >= 1 ? Math.min(max, n,) : fallback;
}

export function groupLayoutOf(settings: Record<string, unknown> | null | undefined,): ResolvedGroupLayout {
    const s = settings ?? {};
    const layout: GroupLayout = s.direction === 'vertical' || s.direction === 'grid' ? s.direction : 'horizontal';
    const columns = count(s.columns, GROUP_DEFAULT_COLUMNS, GROUP_MAX_COLUMNS,);
    const rows = layout === 'grid' ? count(s.rows, GROUP_DEFAULT_ROWS, GROUP_MAX_ROWS,) : 1;
    return { layout, columns, rows, slots: columns * rows, };
}

/** Slots a group should hold — what the editor creates / trims to. */
export function groupSlotCount(settings: Record<string, unknown> | null | undefined,): number {
    return groupLayoutOf(settings,).slots;
}
