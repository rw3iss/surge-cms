import { BlockEmailRenderer, } from './index';
import { sanitize, } from '../../../utils/sanitize';

export const renderRichText: BlockEmailRenderer = (node,) => {
    const raw = String(node.settings.content ?? node.settings.html ?? '',);
    const clean = sanitize(raw,);
    // The wrapping <td> applies padding + alignment + color from
    // block.style; we just emit the inner HTML here.
    return { content: clean, cellStyle: { 'line-height': '1.5', }, };
};
