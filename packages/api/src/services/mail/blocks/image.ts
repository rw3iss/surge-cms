import { BlockEmailRenderer, } from './index';
import { escapeHtml, } from './_util';

interface ImageEntry { url?: string; alt?: string; caption?: string; link?: string; }

export const renderImage: BlockEmailRenderer = (node,) => {
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

    // Honor a max-width set on the block's style (the style panel). Without it,
    // the image filled the full 600px column regardless of the configured cap.
    const maxW = typeof node.style?.maxWidth === 'string' ? String(node.style.maxWidth,).trim() : '';
    const pxMatch = maxW.match(/^(\d+)(?:px)?$/,);
    const widthAttr = pxMatch ? pxMatch[1] : '600'; // Outlook ignores max-width; uses this
    const align = String((node.style as Record<string, unknown> | undefined)?.textAlign ?? '',);
    const marginCss = maxW
        ? (align === 'center' ? ';margin:0 auto' : align === 'right' ? ';margin-left:auto' : '')
        : '';
    const imgStyle = maxW
        ? `display:block;width:100%;max-width:${maxW};height:auto;border:0${marginCss}`
        : 'display:block;max-width:100%;height:auto;border:0';

    const renderOne = (img: ImageEntry,): string => {
        const url = escapeHtml(img.url!,);
        const alt = escapeHtml(img.alt ?? '',);
        const tag = `<img src="${url}" alt="${alt}" width="${widthAttr}" style="${imgStyle}" />`;
        const wrapped = img.link
            ? `<a href="${escapeHtml(img.link,)}" style="text-decoration:none">${tag}</a>`
            : tag;
        const cap = img.caption
            ? `<div style="text-align:center;font-size:13px;color:#666;padding-top:6px">${escapeHtml(img.caption,)}</div>`
            : '';
        return wrapped + cap;
    };

    if (valid.length === 1) return renderOne(valid[0],);

    // Multiple images side-by-side via inner table.
    const cells = valid.map((img,) => `<td style="padding:4px;vertical-align:top">${renderOne(img,)}</td>`,).join('',);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>`;
};
