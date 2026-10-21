import { groupColumnTracks, groupLayoutOf, groupSlotWidth, } from '@sitesurge/types';
import { BlockEmailRenderer, renderNode, } from './index';
import { cellStyleFromBlock, inlineStyle, pxValue, } from './_util';

/**
 * Group renders as a nested table — the email-safe equivalent of the
 * web's flex layout. Each `group_item` child becomes a `<td>` whose
 * content is its children rendered as a sub-table. The outer
 * wrapping `<tr><td style="...">` (with the group's block.style
 * applied) is handled centrally by `renderNode`.
 *
 * Layout (`settings.direction`, read by `groupLayoutOf`):
 *   'horizontal' → children are side-by-side cells in one row.
 *   'vertical'   → children are stacked rows.
 *   'grid'       → `columns` cells per row, filled left→right, top→bottom; an
 *                  empty slot keeps its cell.
 *
 * Column widths (row + grid) follow the web's column tracks
 * (`groupColumnTracks`): slot widths 80% / 20% → 80% / 20% cells, unset slots
 * share the rest, no widths → equal columns. Before, a row's cells sized to
 * their content (the web shows equal columns) and a grid cell's own width
 * overrode its column.
 *
 * Gap: the block STYLE's Gap (`row column` or one value, px only — email has
 * no gap), else the retired `settings.gap`. Columns are spaced with left
 * padding on every cell after the first, rows with a spacer row. A breakpoint
 * gap does not apply (an inline style has no media condition).
 */
export function groupEmailGap(node: { style?: Record<string, unknown>; settings: Record<string, unknown>; },): { row: number; col: number; } {
    const raw = String((node.style?.gap as string | undefined) || (node.settings.gap as string | undefined) || '',).trim();
    if (!raw) return { row: 0, col: 0, };
    const [a, b,] = raw.split(/\s+/,);
    const row = pxValue(a,) ?? 0;
    return { row, col: b ? (pxValue(b,) ?? 0) : row, };
}
/**
 * Cell width per column (CSS length), from the slots' widths the way the web
 * sizes its tracks. All shares → percentages that sum to 100; any fixed column
 * → fixed columns keep their length and the shares get none (the table splits
 * what is left).
 */
export function groupEmailColumnWidths(
    slots: Array<{ settings: Record<string, unknown>; style?: Record<string, unknown>; }>,
    columns: number,
): Array<string | undefined> {
    const pct = (n: number,) => `${Math.floor(n * 100,) / 100}%`;
    const tracks = groupColumnTracks(slots.slice(0, columns,).map((s,) => groupSlotWidth(s.settings, s.style,)), columns,);
    if (!tracks) return Array.from({ length: columns, }, () => pct(100 / columns,),);
    if (tracks.every((t,) => 'fr' in t)) {
        const sum = tracks.reduce((a, t,) => a + (t as { fr: number; }).fr, 0,);
        return tracks.map((t,) => pct(((t as { fr: number; }).fr / sum) * 100,));
    }
    return tracks.map((t,) => ('fixed' in t ? t.fixed : undefined));
}

/** `<td>` width attribute + style for a column width (attribute: % or bare px only). */
function widthAttrs(w: string | undefined,): { attr: string; style: string; } {
    if (!w) return { attr: '', style: '', };
    const attr = /%$/.test(w,) ? w : /^\d+(\.\d+)?px$/.test(w,) ? String(parseFloat(w,),) : '';
    return { attr: attr ? ` width="${attr}"` : '', style: `width:${w};`, };
}

export const renderGroup: BlockEmailRenderer = (node, ctx,) => {
    const layout = groupLayoutOf(node.settings,);
    const direction = layout.layout;
    const items = node.children.filter((c,) => c.blockType === 'group_item',);
    if (items.length === 0) return '';

    const gap = groupEmailGap(node,);
    const spacer = (colspan: number,) =>
        `<tr><td colspan="${colspan}" style="height:${gap.row}px;line-height:${gap.row}px;font-size:0">&nbsp;</td></tr>`;
    const cellList = items.map((item,) => {
        // Each group_item's children are normal blocks — render them
        // with the central pipeline so block.style propagates.
        const innerRows = item.children.map((c,) => renderNode(c, ctx,),).join('\n',);
        const innerTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${innerRows}</table>`;
        // group_item carries its own slot-style overrides on
        // settings (width / min/max / alignSelf), which are NOT
        // exposed via block.style for group_items. Apply them
        // directly to the cell here, and also let group_item.style
        // contribute (so operators can paint a slot background).
        const slotStyles: Record<string, string> = { ...cellStyleFromBlock(item, ctx,), };
        const slotOverrides: Record<string, string> = {};
        // Row / grid: the slot's width sizes its COLUMN (groupEmailColumnWidths),
        // not the cell on top of it. A column's slot keeps its own width.
        if (direction === 'vertical') {
            if (item.settings.width) slotOverrides.width = String(item.settings.width,);
        } else {
            delete slotStyles.width;
        }
        if (item.settings.minWidth) slotOverrides['min-width'] = String(item.settings.minWidth,);
        if (item.settings.maxWidth) slotOverrides['max-width'] = String(item.settings.maxWidth,);
        if (item.settings.alignSelf && item.settings.alignSelf !== 'stretch') {
            slotOverrides['vertical-align'] = String(item.settings.alignSelf,);
        } else {
            slotOverrides['vertical-align'] = 'top';
        }
        const cellStyle = inlineStyle({ ...slotStyles, ...slotOverrides, },);
        return { cellStyle, innerTable, };
    },);

    if (direction === 'grid') {
        const cols = layout.columns;
        const widths = groupEmailColumnWidths(items, cols,).map(widthAttrs,);
        const rowsHtml: string[] = [];
        for (let i = 0; i < cellList.length; i += cols) {
            const row = cellList.slice(i, i + cols,).map((c, j,) =>
                `<td${widths[j]!.attr} style="${widths[j]!.style}${c.cellStyle}${j > 0 && gap.col ? `;padding-left:${gap.col}px` : ''}">${c.innerTable}</td>`
            );
            // Pad a short last row so its cells keep the column width.
            for (let k = row.length; k < cols; k++) row.push(`<td${widths[k]!.attr} style="${widths[k]!.style}"></td>`,);
            if (rowsHtml.length && gap.row) rowsHtml.push(spacer(cols,),);
            rowsHtml.push(`<tr>${row.join('',)}</tr>`,);
        }
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">${rowsHtml.join('\n',)}</table>`;
    }

    if (direction === 'vertical') {
        const body = cellList.map((c,) => `<tr><td style="${c.cellStyle}">${c.innerTable}</td></tr>`).join(gap.row ? spacer(1,) : '\n',);
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>`;
    }

    const rowWidths = groupEmailColumnWidths(items, items.length,);
    const fixedLayout = rowWidths.every((w,) => w && /%$/.test(w,));
    const widths = rowWidths.map(widthAttrs,);
    const body = `<tr>${cellList.map((c, j,) => `<td${widths[j]!.attr} style="${widths[j]!.style}${c.cellStyle}${j > 0 && gap.col ? `;padding-left:${gap.col}px` : ''}">${c.innerTable}</td>`).join('\n',)}</tr>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"${fixedLayout ? ' style="table-layout:fixed"' : ''}>${body}</table>`;
};
