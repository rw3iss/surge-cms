import { BlockEmailRenderer, renderNode, } from './index';
import { inlineStyle, } from './_util';

/**
 * Group renders as a nested table — the email-safe equivalent of the
 * web's flex layout. Each `group_item` child becomes a `<td>`; the
 * `group_item`'s own children render inside their own inner table so
 * we don't have to mash row-shaped renderer output into cell content
 * directly.
 *
 * Direction: 'horizontal' → children are side-by-side cells in one row.
 *            'vertical'   → children are stacked rows.
 */
export const renderGroup: BlockEmailRenderer = (node, ctx,) => {
    const direction = String(node.settings.direction ?? 'horizontal',);
    const items = node.children.filter((c,) => c.blockType === 'group_item',);
    if (items.length === 0) return '';

    const cells = items.map((item,) => {
        const innerRows = item.children.map((c,) => renderNode(c, ctx,),).join('\n',);
        const innerTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${innerRows}</table>`;
        const cellStyle = inlineStyle({
            width: item.settings.width as string,
            'min-width': item.settings.minWidth as string,
            'max-width': item.settings.maxWidth as string,
            'vertical-align': (item.settings.alignSelf as string) ?? 'top',
            padding: '6px',
        },);
        return `<td style="${cellStyle}">${innerTable}</td>`;
    },).join('\n',);

    const body = direction === 'vertical'
        ? cells.replace(/<td/g, '<tr><td',).replace(/<\/td>/g, '</td></tr>',)
        : `<tr>${cells}</tr>`;

    return `<tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${body}
        </table>
    </td></tr>`;
};
