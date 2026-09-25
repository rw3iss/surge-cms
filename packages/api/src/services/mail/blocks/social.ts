import { resolveSocialDisplay, SOCIAL_THUMB_WIDTH, } from '@sitesurge/types';
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
     * The block's Border Radius, on the thumbnail rather than the cell.
     *
     * On the site this block is an iframe clipped by the block wrapper's radius
     * + overflow. Email has no iframe and no overflow, so the still IS the
     * block's visible box and has to carry the rounding itself, or the setting
     * appears to do nothing. 4px stays the default for blocks that set none.
     */
    const radius = mediaRadius(node, '4px',);
    // `full` is uncapped on the web; in email it still needs a definite pixel
    // width, because Outlook ignores `max-width` on an image.
    const width = SOCIAL_THUMB_WIDTH[mediaDisplay] ?? 600;

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
                        style="display:block;width:100%;max-width:${width}px;height:auto;border:0;border-radius:${radius}" />
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
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:10px 0 0">
                   <tr>
                     <td style="color:${ctx.textColor};font-size:17px;line-height:1.35;font-weight:600;vertical-align:top">${titleCell}</td>
                     ${
                date ?
                    `<td style="color:${ctx.textColor};opacity:0.6;font-size:13px;line-height:1.4;text-align:right;white-space:nowrap;padding-left:12px;vertical-align:top">${date}</td>` :
                    ''
            }
                   </tr>
               </table>` :
            '';

        const author = showAuthor && i.authorName ?
            `<div style="color:${ctx.textColor};opacity:0.7;font-size:13px;padding:6px 0 0">${
                escapeHtml(i.authorName,)
            }</div>` :
            '';

        return `<tr><td style="padding:0 0 16px">${thumb}${metaRow}${author}</td></tr>`;
    },).join('\n',);

    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%">${rows}</table>`;
};
