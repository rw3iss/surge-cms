import type { SsrBlockRenderer, } from './index';
import { siteMediaHref, watchPath, } from '@sitesurge/types';
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
    // Linked to the video's page on this site — never the raw file.
    const mediaId = typeof s.mediaId === 'string' ? s.mediaId : '';
    const url = typeof s.url === 'string' ? s.url : '';
    const href = mediaId ? watchPath(mediaId,) : url ? siteMediaHref(url,) : '';
    const pic = poster ? `<img src="${escapeHtml(poster,)}" alt="${escapeHtml(title || 'Video',)}" />` : '';
    const img = pic && href ? `<a href="${escapeHtml(href,)}">${pic}</a>` : pic;
    const cap = title ? `<figcaption>${escapeHtml(title,)}</figcaption>` : '';
    return `<figure class="ssr-block ssr-block--video">${img}${cap}</figure>`;
};
