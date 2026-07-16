import type { SsrBlockRenderer, } from './index';
import { escapeHtml, } from './_util';

export const renderDocument: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const url = (settings.url as string) || '';
    const name = (settings.fileName as string) || block.title || 'Download';
    if (!url) return '';
    return `<a class="ssr-block ssr-block--document" href="${escapeHtml(url,)}">${escapeHtml(name,)}</a>`;
};
