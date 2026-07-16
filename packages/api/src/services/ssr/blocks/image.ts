import type { SsrBlockRenderer, } from './index';
import { escapeHtml, } from './_util';

export const renderImage: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const url = block.content || (settings.url as string) || '';
    const alt = (settings.alt as string) || block.title || '';
    if (!url) return '';
    return `<img class="ssr-block ssr-block--image" src="${escapeHtml(url,)}" alt="${escapeHtml(alt,)}" />`;
};
