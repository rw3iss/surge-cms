import { EMAIL_CONTENT_WIDTH, escapeHtml, fitMedia, mediaBox, mediaRadiusCss, VIDEO_MEDIA_SIZE_KEY, } from './_util';
import { BlockEmailRenderer, } from './index';

export { VIDEO_MEDIA_SIZE_KEY, } from './_util';

function aspectOf(settings: Record<string, unknown>,): number | null {
    const size = settings[VIDEO_MEDIA_SIZE_KEY] as { width?: unknown; height?: unknown; } | undefined;
    const w = Number(size?.width,);
    const h = Number(size?.height,);
    return w > 0 && h > 0 ? w / h : null;
}

/**
 * Video → fallback. Email clients can't play <video>; we render a
 * poster image with a play-button-style caption linking to the
 * canonical video URL on the public site.
 *
 * The poster fits the block's box: the block's own Max Width / Max Height
 * settings and its style (incl. an assigned style template) cap it, keeping the
 * video's aspect ratio, centred. Without any cap the output is unchanged.
 */
export const renderVideo: BlockEmailRenderer = (node, ctx,) => {
    const poster = String(node.settings.posterUrl ?? node.settings.thumbnailUrl ?? '',);
    const url = String(node.settings.url ?? node.settings.videoUrl ?? '#',);
    const title = String(node.settings.title ?? 'Watch the video',);

    // Both arms take the block's radius — the poster and the no-poster
    // placeholder are equally "the block's visible box".
    const radiusCss = mediaRadiusCss(node,);
    const box = mediaBox(node,);
    const capped = box.maxHeight !== null || box.maxWidth < EMAIL_CONTENT_WIDTH;

    let inner: string;
    if (poster && capped) {
        const fit = fitMedia(box, aspectOf(node.settings,),);
        // Attributes for Outlook (it ignores max-height and max-width); the
        // inline max-* keep it inside the box everywhere else, and
        // `height:auto` keeps the ratio when a narrow screen shrinks it.
        const attrs = `${fit.width !== null ? ` width="${fit.width}"` : ''}${fit.height !== null ? ` height="${fit.height}"` : ''}`;
        const style = [
            'display:block',
            'margin:0 auto',
            fit.width !== null ? `width:${fit.width}px` : 'width:auto',
            'max-width:100%',
            'height:auto',
            box.maxHeight !== null ? `max-height:${box.maxHeight}px` : '',
            'border:0',
        ].filter(Boolean,).join(';',);
        inner = `<img src="${escapeHtml(poster,)}" alt="${escapeHtml(title,)}"${attrs} style="${style}${radiusCss}" />`;
    } else if (poster) {
        inner = `<img src="${escapeHtml(poster,)}" alt="${
            escapeHtml(title,)
        }" width="600" style="display:block;max-width:100%;border:0${radiusCss}" />`;
    } else {
        const capCss = capped
            ? `;box-sizing:border-box;margin:0 auto;max-width:${box.maxWidth}px${
                box.maxHeight !== null ? `;max-height:${box.maxHeight}px;overflow:hidden` : ''
            }`
            : '';
        inner = `<div style="padding:48px;text-align:center;background:#222;color:#fff;font-size:18px${radiusCss}${capCss}">▶ ${
            escapeHtml(title,)
        }</div>`;
    }

    // The link wraps the picture only, so the clickable area matches it.
    const linkStyle = capped ? 'text-decoration:none;display:block;text-align:center' : 'text-decoration:none;display:block';
    return `
        <a href="${escapeHtml(url,)}" style="${linkStyle}">${inner}</a>
        <div style="text-align:center;font-size:13px;color:${ctx.linkColor};padding-top:6px">▶ Watch the video</div>
    `;
};
