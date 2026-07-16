import type { SsrBlockRenderer, } from './index';
import { sanitize, } from './_util';

export const renderRichText: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const html = block.content || (settings.content as string) || '';
    if (!html) return '';
    return `<div class="ssr-block ssr-block--${block.type}">${
        block.type === 'html' ? html : sanitize(html,)
    }</div>`;
};
