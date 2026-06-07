import { BlockEmailRenderer, } from './index';

/**
 * Operator-authored HTML passed through verbatim. The block editor's
 * Custom-HTML control already trusts the operator; we wrap the result
 * in a cell but don't sanitize (sanitizing would defeat the purpose
 * of a "custom HTML" block).
 */
export const renderHtml: BlockEmailRenderer = (node,) => {
    const html = String(node.settings.content ?? node.settings.html ?? '',);
    return html.trim() ? html : '';
};
