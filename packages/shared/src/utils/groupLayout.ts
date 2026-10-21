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

/** One column track of a column grid: a proportional share, or a fixed length. */
export type GroupTrack = { fr: number; } | { fixed: string; };

/**
 * A slot's width for its group's column tracks: its Width property, else its
 * style width (`100%` = the default, i.e. unset). Web and email read it the same.
 */
export function groupSlotWidth(
    settings: Record<string, unknown> | null | undefined,
    style?: Record<string, unknown> | null,
): string | undefined {
    const w = (settings?.width as string | undefined) || (style?.width as string | undefined);
    return typeof w === 'string' && w.trim() && w.trim() !== '100%' ? w.trim() : undefined;
}

/**
 * Column tracks of a column grid (Row with columns, or Grid) from its slots'
 * widths, or null when no slot sets one (→ N equal columns). ONE rule for the
 * web (`groupTracks` → `grid-template-columns`) and email (cell widths).
 *
 * Percentages become proportional shares (80% + 20% → 80fr 20fr), so a gap is
 * absorbed instead of overflowing 100%. A slot without a width shares what the
 * percentages leave (100 − sum, split evenly; 1fr when nothing is left). Any
 * other length (300px, 20rem) is a fixed column.
 */
export function groupColumnTracks(widths: Array<string | null | undefined>, columns: number,): GroupTrack[] | null {
    const cols = widths.slice(0, columns,);
    while (cols.length < columns) cols.push(undefined,);
    const norm = cols.map((w,) => (typeof w === 'string' ? w.trim() : ''));
    if (!norm.some(Boolean,)) return null;
    const pct = norm.map((w,) => (/^\d+(\.\d+)?%$/.test(w,) ? parseFloat(w,) : null));
    const used = pct.reduce<number>((s, v,) => s + (v ?? 0), 0,);
    const free = norm.filter((w,) => !w).length;
    const share = free && used > 0 && used < 100 ? (100 - used) / free : null;
    return norm.map((w, i,): GroupTrack => {
        if (pct[i] != null) return { fr: pct[i]!, };
        if (w) return { fixed: w, };
        return { fr: share ? Math.round(share * 100,) / 100 : 1, };
    },);
}
