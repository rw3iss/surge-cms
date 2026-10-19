import { groupLayoutOf, } from '@sitesurge/types';
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
 *   'grid'       → `columns` equal-width cells per row, filled left→right,
 *                  top→bottom; an empty slot keeps its cell.
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
        const slotStyles = cellStyleFromBlock(item, ctx,);
        const slotOverrides: Record<string, string> = {};
        if (item.settings.width) slotOverrides.width = String(item.settings.width,);
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
        const pct = `${Math.floor(10000 / cols,) / 100}%`;
        const rowsHtml: string[] = [];
        for (let i = 0; i < cellList.length; i += cols) {
            const row = cellList.slice(i, i + cols,).map((c, j,) =>
                `<td width="${pct}" style="width:${pct};${c.cellStyle}${j > 0 && gap.col ? `;padding-left:${gap.col}px` : ''}">${c.innerTable}</td>`
            );
            // Pad a short last row so its cells keep the column width.
            for (let k = row.length; k < cols; k++) row.push(`<td width="${pct}" style="width:${pct}"></td>`,);
            if (rowsHtml.length && gap.row) rowsHtml.push(spacer(cols,),);
            rowsHtml.push(`<tr>${row.join('',)}</tr>`,);
        }
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">${rowsHtml.join('\n',)}</table>`;
    }

    const body = direction === 'vertical'
        ? cellList.map((c,) => `<tr><td style="${c.cellStyle}">${c.innerTable}</td></tr>`).join(gap.row ? spacer(1,) : '\n',)
        : `<tr>${cellList.map((c, j,) => `<td style="${c.cellStyle}${j > 0 && gap.col ? `;padding-left:${gap.col}px` : ''}">${c.innerTable}</td>`).join('\n',)}</tr>`;

    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>`;
};
