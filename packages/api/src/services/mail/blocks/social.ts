import { BlockEmailRenderer, } from './index';
import { escapeHtml, } from './_util';

interface SocialItem {
    postUrl?: string;
    postId?: string;
    thumbnailUrl?: string;
    content?: string;
    authorName?: string;
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
    const items: SocialItem[] = Array.isArray(node.settings.items,)
        ? (node.settings.items as SocialItem[])
        : [];
    const valid = items.filter((i,) => i.postUrl || i.postId);
    if (valid.length === 0) return '';

    // A video kind gets the play affordance; a plain post card doesn't.
    const isVideo = String(node.settings.kind ?? '',) === 'video'
        || String(node.settings.kind ?? '',) === 'short'
        || String(node.settings.provider ?? '',) === 'youtube';

    const rows = valid.map((i,) => {
        const url = escapeHtml(i.postUrl ?? '#',);
        const title = escapeHtml(String(i.content ?? '',).trim(),);
        const author = i.authorName
            ? `<div style="color:${ctx.textColor};opacity:0.7;font-size:13px;padding:0 0 4px">${escapeHtml(i.authorName,)}</div>`
            : '';

        // Full-bleed thumbnail, mirroring the site's embed footprint. `width`
        // as an ATTRIBUTE as well as CSS — Outlook ignores `max-width` on
        // images and will otherwise render at the file's intrinsic size.
        const thumb = i.thumbnailUrl
            ? `<a href="${url}" style="display:block;text-decoration:none">
                   <img src="${escapeHtml(i.thumbnailUrl,)}" alt="${title}" width="600"
                        style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:4px" />
               </a>`
            : '';

        const play = isVideo
            ? `<div style="padding:8px 0 0">
                   <a href="${url}" style="display:inline-block;text-decoration:none;background:${ctx.linkColor};color:#ffffff;font-size:13px;line-height:1;padding:8px 14px;border-radius:999px">&#9654;&nbsp; Watch</a>
               </div>`
            : '';

        const caption = title
            ? `<div style="color:${ctx.textColor};font-size:16px;line-height:1.4;padding:10px 0 0">
                   <a href="${url}" style="color:${ctx.textColor};text-decoration:none">${title}</a>
               </div>`
            : '';

        return `<tr><td style="padding:0 0 16px">${thumb}${author ? `<div style="padding:10px 0 0">${author}</div>` : ''}${caption}${play}</td></tr>`;
    },).join('\n',);

    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%">${rows}</table>`;
};
