/**
 * Server-side gallery HTML — shared by the `{{gallery(...)}}` function and the
 * Gallery block, in both server renderers:
 *
 *   SSR    `galleryFiguresHtml`: indexable <figure> list (image or the video
 *          poster, alt text, a caption, a link to the item page). Crawlers
 *          care about words and links, not layout.
 *   Email  `galleryEmailHtml`: a table grid (no CSS layout in mail clients),
 *          images width-constrained with inline styles; a video becomes its
 *          poster linked to the item page with a "▶ Watch" line.
 *
 * Every URL is absolutised against `base` (an inbox has no origin), and the
 * caller passes items already filtered for its audience (SSR: anonymous site
 * view; email: public media only).
 */
import type { GalleryItem, } from '@sitesurge/types';
import { watchBarCell, } from '../mail/blocks/watchOverlay';

const esc = (s: unknown,): string =>
    String(s ?? '',).replace(/&/g, '&amp;',).replace(/</g, '&lt;',).replace(/>/g, '&gt;',).replace(/"/g, '&quot;',);

/** `/uploads/x.jpg` → `https://site/uploads/x.jpg`; absolute URLs unchanged. */
export function absUrl(u: string | null | undefined, base: string,): string {
    const s = String(u ?? '',).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s,)) return s;
    if (s.startsWith('//',)) return `https:${s}`;
    return `${base.replace(/\/+$/, '',)}${s.startsWith('/',) ? '' : '/'}${s}`;
}

/** The image to SHOW for an item: the picture itself, or a video's poster. */
export function previewUrl(item: GalleryItem,): string {
    const m = item.media;
    if (!m) return '';
    return m.type === 'video' ? (m.thumbnailUrl ?? '') : (m.url || m.thumbnailUrl || '');
}

export interface GalleryHtmlOptions {
    showTitles?: boolean;
    showCaptions?: boolean;
}

/** Indexable SSR HTML: one <figure> per item, linked to its page. */
export function galleryFiguresHtml(items: GalleryItem[] | null | undefined, base = '', opts: GalleryHtmlOptions = {},): string {
    if (!Array.isArray(items,) || !items.length) return '';
    const figs = items.filter((i,) => i.media,).map((i,) => {
        const src = absUrl(previewUrl(i,), base,);
        const alt = i.media?.alt || i.title || '';
        const href = absUrl(i.url, base,);
        const img = src
            ? `<img src="${esc(src,)}" alt="${esc(alt,)}" loading="lazy"${i.media?.width ? ` width="${i.media.width}"` : ''}${i.media?.height ? ` height="${i.media.height}"` : ''} />`
            : '';
        const label = i.media?.type === 'video' ? `${i.title || 'Video'} (video)` : i.title;
        // Titles/captions are always emitted for SEO unless explicitly turned off.
        const showTitle = opts.showTitles !== false && Boolean(label,);
        const showCaption = opts.showCaptions !== false && Boolean(i.caption,);
        const cap = showTitle || showCaption
            ? `<figcaption>${showTitle ? `<strong>${esc(label,)}</strong>` : ''}${showTitle && showCaption ? ' — ' : ''}${showCaption ? esc(i.caption,) : ''}</figcaption>`
            : '';
        return `<figure class="ssr-gallery__item"><a href="${esc(href,)}">${img}</a>${cap}</figure>`;
    },).join('',);
    return figs ? `<div class="ssr-gallery">${figs}</div>` : '';
}

/** A single item for SSR (the figure, no wrapper list). */
export function galleryItemHtml(item: GalleryItem | null, base = '',): string {
    return item ? galleryFiguresHtml([item,], base,) : '';
}

export interface GalleryEmailOptions extends GalleryHtmlOptions {
    /** Grid columns (1–6). Default 3. */
    columns?: number;
    /** Corner radius on images (CSS length). */
    radius?: string;
    /** Gap between cells, px. Default 6. */
    gapPx?: number;
    /** Text colour for titles/captions. */
    textColor?: string;
}

const safeCss = (v: string | undefined,) => (v && !/[;{}<>"]/.test(v,) ? v : '');

/** Email table grid. Items must already be public-media only. */
export function galleryEmailHtml(items: GalleryItem[] | null | undefined, base: string, opts: GalleryEmailOptions = {},): string {
    const list = (items ?? []).filter((i,) => i.media,);
    if (!list.length) return '';
    const cols = Math.min(6, Math.max(1, Math.round(opts.columns ?? 3,),),);
    const pad = Math.max(0, Math.min(24, Math.round(opts.gapPx ?? 6,),),);
    const width = `${Math.floor(100 / cols,)}%`;
    const radius = safeCss(opts.radius,);
    const text = safeCss(opts.textColor,) || '#333333';
    const imgStyle = `display:block;width:100%;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;${radius ? `border-radius:${radius};` : ''}`;

    const cell = (i: GalleryItem,): string => {
        const href = esc(absUrl(i.url, base,),);
        const src = absUrl(previewUrl(i,), base,);
        const isVideo = i.media?.type === 'video';
        const alt = esc(i.media?.alt || i.title || (isVideo ? 'Video' : 'Image'),);
        // A video's poster gets the "▶ Watch" bar right under it (a grid cell
        // has no fixed height, so a layered overlay would crop or stretch):
        // square bottom corners on the picture, rounded ones on the bar.
        const videoVisual = isVideo && src
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;"><tr><td style="padding:0;"><a href="${href}" style="text-decoration:none;"><img src="${esc(src,)}" alt="${alt}" width="100%" style="${imgStyle.replace(/border-radius:[^;]*;/, '',)}${radius ? `border-radius:${radius} ${radius} 0 0;` : ''}" /></a></td></tr><tr>${watchBarCell(radius || undefined, href,)}</tr></table>`
            : '';
        const visual = videoVisual || (src
            ? `<a href="${href}" style="text-decoration:none;"><img src="${esc(src,)}" alt="${alt}" width="100%" style="${imgStyle}" /></a>`
            // A video with no poster: a dark tile that still links to the player.
            : `<a href="${href}" style="display:block;background:#111111;color:#ffffff;text-align:center;padding:40px 8px;text-decoration:none;font-weight:bold;${radius ? `border-radius:${radius};` : ''}">&#9654; Watch video</a>`);
        const title = opts.showTitles && i.title ? `<div style="padding-top:4px;font-size:14px;font-weight:bold;color:${text};">${esc(i.title,)}</div>` : '';
        const caption = opts.showCaptions && i.caption ? `<div style="padding-top:2px;font-size:13px;color:${text};">${esc(i.caption,)}</div>` : '';
        return `<td width="${width}" valign="top" style="width:${width};padding:${pad}px;vertical-align:top;">${visual}${title}${caption}</td>`;
    };

    const rows: string[] = [];
    for (let r = 0; r < list.length; r += cols) {
        const slice = list.slice(r, r + cols,);
        const cells = slice.map(cell,);
        // Pad the last row so every column keeps its width.
        while (cells.length < cols) cells.push(`<td width="${width}" style="width:${width};padding:${pad}px;"></td>`,);
        rows.push(`<tr>${cells.join('',)}</tr>`,);
    }
    return `<table role="presentation" class="gallery-grid" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows.join('',)}</table>`;
}
