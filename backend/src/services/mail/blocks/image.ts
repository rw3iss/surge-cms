import { BlockEmailRenderer, } from './index';
import { escapeHtml, } from './_util';

interface ImageEntry { url?: string; alt?: string; caption?: string; link?: string; }

export const renderImage: BlockEmailRenderer = (node, ctx,) => {
    // Support both the multi-image shape (settings.images[]) and the
    // legacy single-image shape (settings.url + sibling fields).
    const imgs: ImageEntry[] = Array.isArray(node.settings.images,)
        ? (node.settings.images as ImageEntry[])
        : node.settings.url
            ? [{
                url: String(node.settings.url,),
                alt: node.settings.alt as string | undefined,
                caption: node.settings.caption as string | undefined,
                link: node.settings.link as string | undefined,
            },]
            : [];

    const valid = imgs.filter((i,) => i.url,);
    if (valid.length === 0) return '';

    const cells = valid.map((img,) => {
        const url = escapeHtml(img.url!,);
        const alt = escapeHtml(img.alt ?? '',);
        const tag = `<img src="${url}" alt="${alt}" width="600" style="display:block;max-width:100%;height:auto;border:0" />`;
        const wrapped = img.link
            ? `<a href="${escapeHtml(img.link,)}" style="text-decoration:none">${tag}</a>`
            : tag;
        const cap = img.caption
            ? `<div style="text-align:center;font-size:13px;color:#666;padding-top:6px">${escapeHtml(img.caption,)}</div>`
            : '';
        return `<td style="padding:8px">${wrapped}${cap}</td>`;
    },).join('',);

    // Single image → one row; multiple → side-by-side cells.
    if (valid.length === 1) return `<tr>${cells}</tr>`;
    return `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`;
};
