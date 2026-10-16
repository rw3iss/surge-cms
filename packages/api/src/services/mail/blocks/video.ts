import { itemRadiusCss, watchPath, } from '@sitesurge/types';
import {
    absUrl,
    DEFAULT_VIDEO_RADIUS,
    EMAIL_CONTENT_WIDTH,
    escapeHtml,
    fitMedia,
    mediaBox,
    mediaRadius,
    siteMediaLink,
    VIDEO_MEDIA_SIZE_KEY,
    VIDEO_MEDIA_TITLE_KEY,
} from './_util';
import { BlockEmailRenderer, EmailBlockNode, EmailRenderCtx, } from './index';
import { WATCH_BAR_HEIGHT, watchBarCell, } from './watchOverlay';

export { VIDEO_MEDIA_SIZE_KEY, VIDEO_MEDIA_TITLE_KEY, } from './_util';

function aspectOf(settings: Record<string, unknown>,): number | null {
    const size = settings[VIDEO_MEDIA_SIZE_KEY] as { width?: unknown; height?: unknown; } | undefined;
    const w = Number(size?.width,);
    const h = Number(size?.height,);
    return w > 0 && h > 0 ? w / h : null;
}

/**
 * Where the email sends a reader: never the raw file. A library video → the
 * site's watch page (`<site>/watch/<mediaId>`); a URL that is a library
 * video's file/CDN path → the same; a YouTube / Vimeo URL → the provider page.
 */
export function videoWatchUrl(node: EmailBlockNode, ctx: EmailRenderCtx,): string {
    const mediaId = typeof node.settings.mediaId === 'string' ? node.settings.mediaId.trim() : '';
    if (mediaId) return absUrl(ctx.siteUrl, watchPath(mediaId,),);
    const url = String(node.settings.url ?? node.settings.videoUrl ?? '',).trim();
    return url ? siteMediaLink(ctx.siteUrl, url,) : '#';
}

/** The title "Show title" prints: the media's own title, else the block's. */
export function videoTitle(node: EmailBlockNode,): string {
    const media = node.settings[VIDEO_MEDIA_TITLE_KEY];
    if (typeof media === 'string' && media.trim()) return media.trim();
    const own = node.settings.title;
    return typeof own === 'string' ? own.trim() : '';
}

/**
 * The poster's corner radius: the block's "Item border radius" (`0` = square)
 * → the block's own Border Radius (email cannot clip a cell, so the block's
 * rounding has to sit on the picture — see `mediaRadius`) → the site's
 * Appearance → Border Radius → `DEFAULT_VIDEO_RADIUS` (the web's fallback).
 */
export function videoRadius(node: EmailBlockNode, ctx: EmailRenderCtx,): string {
    return itemRadiusCss(node.settings.itemRadius,)
        ?? mediaRadius(node,)
        ?? itemRadiusCss(ctx.siteRadius,)
        ?? DEFAULT_VIDEO_RADIUS;
}

/**
 * Video → a poster linked to the video's page. Email clients can't play
 * <video>, so the poster carries a "▶ Watch" bar ON its bottom edge.
 *
 * The overlay: when the poster's size is known (a library video's aspect ratio,
 * from the mail pre-pass), the poster is the BACKGROUND of a fixed-size cell and
 * the bar is the bottom row of a table inside it — layered, in every client
 * that shows background images; Outlook for Windows gets the same through VML.
 * Without a known size a fixed-height cell would crop or stretch, so the bar
 * sits directly UNDER the picture instead, styled the same.
 *
 * The poster fits the block's box: the block's own Max Width / Max Height
 * settings and its style (incl. an assigned style template) cap it, keeping the
 * video's aspect ratio, centred. Corners: `videoRadius`.
 */
export const renderVideo: BlockEmailRenderer = (node, ctx,) => {
    const poster = String(node.settings.posterUrl ?? node.settings.thumbnailUrl ?? '',);
    const href = escapeHtml(videoWatchUrl(node, ctx,),);
    const title = videoTitle(node,);
    const alt = escapeHtml(title || 'Watch the video',);
    const radius = videoRadius(node, ctx,);

    const box = mediaBox(node,);
    const capped = box.maxHeight !== null || box.maxWidth < EMAIL_CONTENT_WIDTH;
    const aspect = aspectOf(node.settings,);

    const heading = node.settings.showTitle === true && title ?
        `<div class="email-video-title" style="text-align:center;font-size:18px;font-weight:bold;line-height:1.3;color:${ctx.textColor};padding-bottom:8px">${
            escapeHtml(title,)
        }</div>` :
        '';

    let inner: string;
    if (poster && aspect) {
        // TRUE OVERLAY — exact size known (fitMedia keeps the max-height /
        // Outlook width+height fixes: both numbers are attributes).
        const fit = fitMedia(box, aspect,);
        const w = fit.width!;
        const h = fit.height!;
        const src = escapeHtml(poster,);
        const spacer = Math.max(0, h - WATCH_BAR_HEIGHT,);
        const rows = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate">`
            + `<tr><td height="${spacer}" style="height:${spacer}px;font-size:0;line-height:0">&nbsp;</td></tr>`
            + `<tr>${watchBarCell(radius,)}</tr></table>`;
        inner = `<table role="presentation" class="email-video" align="center" width="${w}" cellpadding="0" cellspacing="0" border="0" style="width:${w}px;max-width:100%;margin:0 auto;border-collapse:separate">`
            + `<tr><td background="${src}" bgcolor="#000000" width="${w}" height="${h}" valign="bottom" title="${alt}" style="width:${w}px;height:${h}px;padding:0;vertical-align:bottom;background-color:#000000;background-image:url('${src}');background-position:center center;background-size:cover;background-repeat:no-repeat;border-radius:${radius}">`
            + `<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${w}px;height:${h}px;"><v:fill type="frame" src="${src}" color="#000000" /><v:textbox inset="0,0,0,0"><![endif]-->`
            + `<a href="${href}" style="display:block;text-decoration:none;color:#ffffff">${rows}</a>`
            + `<!--[if gte mso 9]></v:textbox></v:rect><![endif]-->`
            + `</td></tr></table>`;
    } else if (poster) {
        // Size unknown → the bar directly under the picture. The shrink-wrapped
        // table makes the bar exactly as wide as the image.
        const fit = capped ? fitMedia(box, null,) : null;
        const attrs = fit ?
            (fit.height !== null ? ` height="${fit.height}"` : '') :
            ` width="${EMAIL_CONTENT_WIDTH}"`;
        const style = [
            'display:block',
            fit ? 'width:auto' : '',
            'max-width:100%',
            'height:auto',
            box.maxHeight !== null ? `max-height:${box.maxHeight}px` : '',
            'border:0',
            `border-radius:${radius} ${radius} 0 0`,
        ].filter(Boolean,).join(';',);
        const img = `<img src="${escapeHtml(poster,)}" alt="${alt}"${attrs} style="${style}" />`;
        inner = `<table role="presentation" class="email-video" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;border-collapse:separate${
            capped ? `;max-width:${box.maxWidth}px` : ''
        }">`
            + `<tr><td style="padding:0"><a href="${href}" style="display:block;text-decoration:none">${img}</a></td></tr>`
            // The bar links too — the whole thing is one destination.
            + `<tr>${watchBarCell(radius, href,)}</tr></table>`;
    } else {
        const capCss = capped ?
            `;box-sizing:border-box;margin:0 auto;max-width:${box.maxWidth}px${
                box.maxHeight !== null ? `;max-height:${box.maxHeight}px;overflow:hidden` : ''
            }` :
            '';
        inner = `<a href="${href}" style="text-decoration:none;display:block"><div style="padding:48px;text-align:center;background:#222;color:#fff;font-size:18px;border-radius:${radius}${capCss}">&#9654;&nbsp;&nbsp;Watch</div></a>`;
    }

    return `${heading}${inner}`;
};
