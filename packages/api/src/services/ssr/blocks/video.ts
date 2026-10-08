import type { SsrBlockRenderer, } from './index';
import { escapeHtml, } from './_util';

/**
 * Video → poster + title for crawlers. The player itself is client-side
 * (HLS via hls.js); a bot gets the picture and the name, and private videos
 * leak nothing beyond what the public teaser already shows.
 */
export const renderVideo: SsrBlockRenderer = (block,) => {
    const s = (block.settings || {}) as Record<string, unknown>;
    const poster = String(s.posterUrl ?? s.thumbnailUrl ?? '',);
    const title = String(s.title ?? block.title ?? '',).trim();
    if (!poster && !title) return '';
    const img = poster ? `<img src="${escapeHtml(poster,)}" alt="${escapeHtml(title || 'Video',)}" />` : '';
    const cap = title ? `<figcaption>${escapeHtml(title,)}</figcaption>` : '';
    return `<figure class="ssr-block ssr-block--video">${img}${cap}</figure>`;
};
