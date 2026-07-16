import type { SsrBlockRenderer, } from './index';
import { escapeHtml, } from './_util';

export const renderUrlLink: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const url = (settings.url as string) || '';
    const t = block.title || (settings.title as string) || url;
    if (!url) return '';
    return `<a class="ssr-block ssr-block--url-link" href="${escapeHtml(url,)}">${escapeHtml(t,)}</a>`;
};
