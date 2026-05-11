import { BlockEmailRenderer, } from './index';
import { escapeHtml, } from './_util';

/**
 * Video → fallback. Email clients can't play <video>; we render a
 * poster image with a play-button-style caption linking to the
 * canonical video URL on the public site.
 */
export const renderVideo: BlockEmailRenderer = (node, ctx,) => {
    const poster = String(node.settings.posterUrl ?? node.settings.thumbnailUrl ?? '',);
    const url = String(node.settings.url ?? node.settings.videoUrl ?? '#',);
    const title = String(node.settings.title ?? 'Watch the video',);

    const inner = poster
        ? `<img src="${escapeHtml(poster,)}" alt="${escapeHtml(title,)}" width="600" style="display:block;max-width:100%;border:0" />`
        : `<div style="padding:48px;text-align:center;background:#222;color:#fff;font-size:18px">▶ ${escapeHtml(title,)}</div>`;

    return `
        <a href="${escapeHtml(url,)}" style="text-decoration:none;display:block">${inner}</a>
        <div style="text-align:center;font-size:13px;color:${ctx.linkColor};padding-top:6px">▶ Watch the video</div>
    `;
};
