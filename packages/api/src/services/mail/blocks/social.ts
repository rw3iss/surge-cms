import {
    resolveSocialDisplay,
    resolveSocialItemBox,
    resolveSocialTitleAlign,
    SOCIAL_THUMB_WIDTH,
} from '@sitesurge/types';
import { escapeHtml, mediaRadius, } from './_util';
import { BlockEmailRenderer, } from './index';

interface SocialItem {
    postUrl?: string;
    postId?: string;
    thumbnailUrl?: string;
    content?: string;
    authorName?: string;
    publishedAt?: string;
}

/** `Sep 20, 2026` — short, unambiguous, and locale-independent so the sent
 *  mail reads the same wherever the worker happens to run. */
function formatPostDate(value: string | undefined,): string {
    if (!value) return '';
    const d = new Date(value,);
    if (Number.isNaN(d.getTime(),)) return '';
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    },);
}

/**
 * Social → a large, clickable media card per item.
 *
 * The public site renders this block as a live provider embed (a YouTube
 * `<iframe>` in an aspect-ratio box). **Email cannot**: every major client
 * strips `<iframe>`, and there is no substitute — so a thumbnail that links to
 * the post is the closest faithful rendering available, not a design choice.
 *
 * What this does NOT do any more is invent its own look. It previously emitted
 * a 120px thumbnail floated left of a truncated excerpt, with hardcoded greys
 * (`#666`, `1px solid #eee`) and a 220-character cut — none of which came from
 * the block, so the email looked nothing like the site and ignored the
 * operator's settings. Now the thumbnail is full width (as the embed is on the
 * site), the colours come from the render context, and the block's own
 * alignment/width/padding arrive via the cell `renderNode` wraps this in.
 *
 * The play badge is a text glyph in a rounded span rather than an image: an
 * image asset would need hosting and would break in clients that block remote
 * images, where the glyph still reads as "video".
 */
export const renderSocial: BlockEmailRenderer = (node, ctx,) => {
    const items: SocialItem[] = Array.isArray(node.settings.items,) ?
        (node.settings.items as SocialItem[]) :
        [];
    const valid = items.filter((i,) => i.postUrl || i.postId);
    if (valid.length === 0) return '';

    // Same settings the web renderer honours, so a block configured as a small
    // thumbnail with no title looks the same in the inbox.
    const { mediaDisplay, showTitle, showAuthor, showDate, } = resolveSocialDisplay(node.settings as never,);
    /*
     * The radius the still image carries.
     *
     * Two settings can ask for one, and the more specific wins:
     *
     *   1. "Item border radius" — the block setting that rounds each POST. On
     *      the web it goes on `.social-embed`, which clips the iframe inside
     *      it; here the still IS the post, so it goes straight on the image.
     *   2. The block's own Border Radius. On the site that rounds the panel and
     *      clips the posts within it; email has no `overflow` on a cell, so the
     *      still has to carry it or the setting appears to do nothing.
     *
     * 4px stays the default for a block that sets neither.
     */
    const box = resolveSocialItemBox(node.settings as never,);
    const radius = box.borderRadius ?? mediaRadius(node, '4px',);
    // `full` is uncapped on the web; in email it still needs a definite pixel
    // width, because Outlook ignores `max-width` on an image.
    const width = SOCIAL_THUMB_WIDTH[mediaDisplay] ?? 600;

    /*
     * "Item width" caps the post, exactly as it does on the site.
     *
     * It wins over the Media size preset because it is the explicit, specific
     * instruction — the preset is a default. The `width` ATTRIBUTE stays the
     * numeric preset either way: Outlook reads the attribute and ignores
     * `max-width`, and an item width like `clamp(200px, 80vw, 800px)` has no
     * integer to give it.
     */
    const maxWidth = box.width ?? `${width}px`;

    /*
     * "Item height" crops the post to a fixed height.
     *
     * `object-fit: cover` is what makes that a crop rather than a squash, and
     * Outlook for Windows does not implement it — so a FIXED height there
     * stretches the image. Emitted anyway, because the operator asked for a
     * height and silently dropping a setting is worse than one client getting
     * it wrong; the common values (`clamp()`, `vw`) are invalid in Word's
     * engine and are dropped there, leaving the image at natural proportions.
     */
    const heightCss = box.height ? `height:${box.height};object-fit:cover` : 'height:auto';

    /*
     * "Item gap" spaces the posts.
     *
     * As bottom padding on each row rather than a `gap`, which no mail client
     * implements on a table. 16px stays the default so an unset block is
     * unchanged; the last row keeps it too, since trimming it would leave the
     * block's own padding to do a job it may not be set up for.
     */
    const gap = box.gap ?? '16px';

    /*
     * Where a post narrower than the block sits.
     *
     * Follows the block's Horizontal Alignment (the same setting that spaces
     * the posts on the web); unset — or a spacing value like `space-between`,
     * which means nothing for one post per row — CENTRES, since an item-width
     * clamp left-aligned by default looked like a layout bug. Emitted twice:
     * `margin` for clients that honour it, and the cell's `align` attribute for
     * Outlook, which ignores auto margins on an image.
     */
    const hAlign = String((node.style as { horizontalAlign?: unknown; } | undefined)?.horizontalAlign ?? '',);
    const side: 'left' | 'center' | 'right' = hAlign === 'start' || hAlign === 'left' ?
        'left' :
        hAlign === 'end' || hAlign === 'right' ?
        'right' :
        'center';
    const imgMargin = side === 'center' ? 'margin:0 auto' : side === 'right' ? 'margin:0 0 0 auto' : 'margin:0';

    /*
     * The title block is held to the SAME width and position as the picture,
     * so it reads as that post's caption rather than spanning the whole column
     * beside it. The text inside it follows the block's own Title alignment
     * (centre by default) — independent of where the post sits.
     */
    const titleAlign = resolveSocialTitleAlign(node.settings as never,);
    const metaMargin = side === 'center' ? '10px auto 0' : side === 'right' ? '10px 0 0 auto' : '10px 0 0';
    const metaBox = `width:100%;max-width:${maxWidth};margin:${metaMargin}`;

    const rows = valid.map((i,) => {
        const url = escapeHtml(i.postUrl ?? '#',);
        const title = escapeHtml(String(i.content ?? '',).trim(),);
        const date = showDate ? escapeHtml(formatPostDate(i.publishedAt,),) : '';

        // The thumbnail links to the post — with no player available in email,
        // the image IS the affordance. A separate "Watch" button was redundant
        // (and read as an advert), so it is gone rather than made optional.
        //
        // `width` as an ATTRIBUTE as well as CSS: Outlook ignores `max-width`
        // on images and otherwise renders at the file's intrinsic size.
        const thumb = i.thumbnailUrl ?
            `<a href="${url}" style="display:block;text-decoration:none">
                   <img src="${escapeHtml(i.thumbnailUrl,)}" alt="${title}" width="${width}"
                        style="display:block;width:100%;max-width:${maxWidth};${heightCss};${imgMargin};border:0;border-radius:${radius}" />
               </a>` :
            '';

        // Title left, date right, on one row — a two-cell table because that is
        // the only layout email clients agree on (no flexbox in Outlook).
        // Emitted only when there is something to put in it.
        const titleCell = showTitle && title ?
            // 17px / 1.35 matches `.social-embed__title` on the web, so the
            // same block reads the same in an inbox as in the editor.
            `<a href="${url}" style="color:${ctx.textColor};text-decoration:none">${title}</a>` :
            '';
        const metaRow = (titleCell || date) ?
            `<table role="presentation" align="${side}" width="100%" cellpadding="0" cellspacing="0" style="${metaBox}">
                   <tr>
                     <td align="${titleAlign}" style="color:${ctx.textColor};font-size:17px;line-height:1.35;font-weight:600;text-align:${titleAlign};vertical-align:top">${titleCell}</td>
                     ${
                date ?
                    `<td style="color:${ctx.textColor};opacity:0.6;font-size:13px;line-height:1.4;text-align:right;white-space:nowrap;padding-left:12px;vertical-align:top">${date}</td>` :
                    ''
            }
                   </tr>
               </table>` :
            '';

        const author = showAuthor && i.authorName ?
            `<div style="color:${ctx.textColor};opacity:0.7;font-size:13px;padding:6px 0 0;${
                metaBox.replace(
                    /margin:[^;]*/,
                    side === 'center' ? 'margin:0 auto' : side === 'right' ? 'margin:0 0 0 auto' : 'margin:0',
                )
            };text-align:${titleAlign}">${escapeHtml(i.authorName,)}</div>` :
            '';

        return `<tr><td align="${side}" style="padding:0 0 ${gap}">${thumb}${metaRow}${author}</td></tr>`;
    },).join('\n',);

    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%">${rows}</table>`;
};
