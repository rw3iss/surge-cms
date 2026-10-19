import { groupLayoutOf, } from '@sitesurge/types';
import { BlockEmailRenderer, renderNode, } from './index';
import { cellStyleFromBlock, inlineStyle, } from './_util';

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
 */
export const renderGroup: BlockEmailRenderer = (node, ctx,) => {
    const layout = groupLayoutOf(node.settings,);
    const direction = layout.layout;
    const items = node.children.filter((c,) => c.blockType === 'group_item',);
    if (items.length === 0) return '';

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
            const row = cellList.slice(i, i + cols,).map((c,) =>
                `<td width="${pct}" style="width:${pct};${c.cellStyle}">${c.innerTable}</td>`
            );
            // Pad a short last row so its cells keep the column width.
            for (let k = row.length; k < cols; k++) row.push(`<td width="${pct}" style="width:${pct}"></td>`,);
            rowsHtml.push(`<tr>${row.join('',)}</tr>`,);
        }
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">${rowsHtml.join('\n',)}</table>`;
    }

    const cells = cellList.map((c,) => `<td style="${c.cellStyle}">${c.innerTable}</td>`).join('\n',);

    const body = direction === 'vertical'
        ? cells.replace(/<td/g, '<tr><td',).replace(/<\/td>/g, '</td></tr>',)
        : `<tr>${cells}</tr>`;

    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>`;
};
