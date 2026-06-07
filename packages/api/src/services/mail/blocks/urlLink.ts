import { BlockEmailRenderer, } from './index';
import { escapeHtml, } from './_util';

export const renderUrlLink: BlockEmailRenderer = (node, ctx,) => {
    const url = String(node.settings.url ?? '#',);
    const text = String(node.settings.text ?? node.settings.label ?? node.settings.url ?? 'Link',);
    return `<a href="${escapeHtml(url,)}" style="color:${ctx.linkColor};text-decoration:underline">${escapeHtml(text,)}</a>`;
};
