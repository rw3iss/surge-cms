import { BlockEmailRenderer, } from './index';
import { sanitize, } from '../../../utils/sanitize';

export const renderRichText: BlockEmailRenderer = (node,) => {
    const raw = String(node.settings.content ?? node.settings.html ?? '',);
    const clean = sanitize(raw,);
    return `<tr><td style="padding:16px;line-height:1.5">${clean}</td></tr>`;
};
