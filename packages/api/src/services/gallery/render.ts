/**
 * Server-side gallery HTML — shared by the `{{gallery(...)}}` function and the
 * Gallery block, in both server renderers:
 *
 *   SSR    `galleryFiguresHtml`: indexable <figure> list (image or the video
 *          poster, alt text, a caption, a link to the item page). Crawlers
 *          care about words and links, not layout.
 *   Email  `galleryEmailHtml`: tables only (no CSS layout in mail clients).
 *          Three shapes: a GRID (`grid` → its columns, `column` → one per
 *          row), a centred WRAPPED grid (`row` / `carousel` / `stage` —
 *          thumbnails flow left-to-right, each row centred) or MASONRY (one
 *          row of N column cells, each a vertical stack of items at their
 *          natural aspect, every item placed in the shortest column). Every item links
 *          to its gallery item page (the block's on-click option is ignored —
 *          an inbox has no lightbox); a video keeps the "▶ Watch" bar.
 *          Rows are placed by the block's Horizontal Alignment (`env.align`,
 *          default centre) — visible when the gallery is narrower than the
 *          body (a block width / max-width, or a fixed Item width, which
 *          shrinks each slot to the item); titles follow its Text Align.
 *
 * Every URL is absolutised against `base` (an inbox has no origin), and the
 * caller passes items already filtered for its audience (SSR: anonymous site
 * view; email: public media only).
 */
import { galleryItemRadius, galleryMasonryColumns, galleryTitlePlacement, itemRadiusCss, } from '@sitesurge/types';
import type { GalleryAspect, GalleryBlockSettings, GalleryFit, GalleryItem, } from '@sitesurge/types';
import { EMAIL_CONTENT_WIDTH, pxValue, } from '../mail/blocks/_util';
import { escapeHtml, } from '../../utils/html';
import { WATCH_BAR_HEIGHT, watchBarCell, } from '../mail/blocks/watchOverlay';

/** The shared HTML escaper (escapes `'` too — the local copy did not). */
const esc = escapeHtml;

/**
 * A URL for a CSS `url('…')` inside an HTML attribute: `'`, `(`, `)` and
 * whitespace are percent-encoded so the value can never close the CSS string
 * or the `url()` — HTML-escaping alone is not enough there, since the
 * attribute is DECODED (`&#39;` → `'`) before the CSS is parsed.
 */
export function cssUrl(u: string,): string {
    return u.replace(/['()\s\\]/g, (c,) => `%${c.charCodeAt(0,).toString(16,).toUpperCase().padStart(2, '0',)}`,);
}

/**
 * `/uploads/x.jpg` → `https://site/uploads/x.jpg`; absolute URLs unchanged.
 * NOTE the argument order (url, base) — the reverse of `mail/blocks/_util`
 * `absUrl(siteUrl, link)`; hence the distinct name.
 */
export function absoluteGalleryUrl(u: string | null | undefined, base: string,): string {
    const s = String(u ?? '',).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s,)) return s;
    if (s.startsWith('//',)) return `https:${s}`;
    return `${base.replace(/\/+$/, '',)}${s.startsWith('/',) ? '' : '/'}${s}`;
}

/** @deprecated Use `absoluteGalleryUrl` (same arguments) — kept for existing importers. */
export const absUrl = absoluteGalleryUrl;

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
        const src = absoluteGalleryUrl(previewUrl(i,), base,);
        const alt = i.media?.alt || i.title || '';
        const href = absoluteGalleryUrl(i.url, base,);
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

const safeCss = (v: string | undefined,) => (v && !/[;{}<>"]/.test(v,) ? v : '');

/** Corner radius when neither the block nor the site sets one — the web tile's own fallback (`var(--site-radius, 8px)`). */
export const GALLERY_EMAIL_FALLBACK_RADIUS = '8px';

const ASPECT_RATIOS: Partial<Record<GalleryAspect, number>> = { square: 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, };

/** Where the email renderer gets what the web gets from the cascade. */
export interface GalleryEmailEnv {
    /** Settings → Appearance → Border Radius — the default item radius. */
    siteRadius?: string;
    /** Text colour for titles / captions. */
    textColor?: string;
    /** Width (px) the gallery may use: the email body minus the block's padding. Default 600. */
    width?: number;
    /** Where rows sit when narrower than `width` (block Horizontal Alignment). Default centre. */
    align?: GalleryEmailAlign;
    /** Title / caption alignment (block Text Align). Default: left for a grid, centre when wrapped. */
    textAlign?: string;
}

export type GalleryEmailAlign = 'left' | 'center' | 'right';

/**
 * A block's alignment for email, from its style: Horizontal Alignment, else
 * Text Align, else centre — the same order the web view reads
 * (`--block-h-align` → `--block-align-items` → centre).
 */
export function galleryEmailAlign(style: { horizontalAlign?: unknown; textAlign?: unknown; } | null | undefined,): GalleryEmailAlign {
    const map = (v: unknown,): GalleryEmailAlign | null => {
        switch (String(v ?? '',).trim()) {
            case 'left': case 'start': case 'flex-start': return 'left';
            case 'right': case 'end': case 'flex-end': return 'right';
            case 'center': return 'center';
            default: return null;
        }
    };
    return map(style?.horizontalAlign,) ?? map(style?.textAlign,) ?? 'center';
}

/** The pixel geometry of one email gallery. Pure — unit-tested. */
export interface GalleryEmailPlan {
    /** `grid`: rows full width, left-aligned (last row padded); `wrap`: every row centred;
     *  `masonry`: one row of `columns` stacks, items at their natural aspect. */
    mode: 'grid' | 'wrap' | 'masonry';
    columns: number;
    /** Width of one column slot, px (item + its padding). */
    slotWidth: number;
    /** Width of a full row, px (`columns × slotWidth`) — may be narrower than the body. */
    width: number;
    /** Padding around each item, px (half the gap). */
    pad: number;
    /** The item box, px. `itemHeight` null = the picture's natural height. */
    itemWidth: number;
    itemHeight: number | null;
    fit: GalleryFit;
    radius: string;
}

/** A media item's own aspect ratio (width / height), when known. */
export function mediaAspect(i: GalleryItem,): number | null {
    const w = Number(i.media?.width,);
    const h = Number(i.media?.height,);
    return w > 0 && h > 0 ? w / h : null;
}

/**
 * The size, px, of media with aspect `ar` fitted INSIDE a `maxW`×`maxH` box
 * (Fit = contain): as wide as the box allows without exceeding its height.
 * The item then hugs its media instead of letterboxing it in the box.
 */
export function galleryContainSize(maxW: number, maxH: number, ar: number,): { width: number; height: number; } {
    const width = Math.max(1, Math.min(maxW, Math.floor(maxH * ar,),),);
    return { width, height: Math.max(1, Math.round(width / ar,),), };
}

/** A px length (`12px` / `12`), `0` allowed; anything else → null. */
const px0 = (v: unknown,): number | null => (String(v ?? '',).trim().match(/^0+(\.0+)?(px)?$/i,) ? 0 : pxValue(v,));

/** Most masonry columns in an email: keeps each item ≥ ~130px on a 600px body. */
export const GALLERY_EMAIL_MASONRY_MAX_COLUMNS = 4;

/**
 * Settings → email geometry. Only the DESKTOP options apply (an email has one
 * width). Columns: `grid` → `columns`, `column` → 1, `row` → `itemsPerPage`,
 * `carousel` / `stage` → `columns`, else `itemsPerPage`; a px `itemWidth`
 * instead fits as many as the width allows. Default 3, at most 6.
 * `masonry`: `columns`, else as many px `itemWidth` columns as fit, else 3 —
 * at most 4; items keep their natural aspect (no box: `itemHeight` null).
 */
export function galleryEmailPlan(s: Partial<GalleryBlockSettings>, env: GalleryEmailEnv = {},): GalleryEmailPlan {
    const d = s.desktop ?? {};
    const width = Math.max(120, Math.min(EMAIL_CONTENT_WIDTH, Math.round(env.width ?? EMAIL_CONTENT_WIDTH,),),);
    const layout = d.layout ?? 'grid';
    const gap = px0(d.gap,) ?? 12;
    const pad = Math.max(0, Math.min(24, Math.round(gap / 2,),),);
    const fixedW = pxValue(d.itemWidth,);
    const fromWidth = fixedW ? Math.floor((width + gap) / (fixedW + gap),) : null;
    const n = (v: unknown,): number | null => (Number(v,) >= 1 ? Math.round(Number(v,),) : null);
    const masonry = layout === 'masonry';
    const raw = layout === 'column'
        ? 1
        : layout === 'grid' || masonry
            ? (n(d.columns,) ?? fromWidth ?? 3)
            : (fromWidth ?? (layout === 'row' ? n(d.itemsPerPage,) : (n(d.columns,) ?? n(d.itemsPerPage,))) ?? 3);
    const columns = Math.min(masonry ? GALLERY_EMAIL_MASONRY_MAX_COLUMNS : 6, Math.max(1, raw,),);
    // A fixed Item width shrinks the slot to the item (+ its padding), so a
    // column / grid of fixed-width items is a narrower box the alignment places.
    const slotWidth = Math.min(Math.floor(width / columns,), fixedW ? fixedW + 2 * pad : Infinity,);
    const inner = Math.max(1, slotWidth - 2 * pad,);
    const itemWidth = fixedW ? Math.min(fixedW, inner,) : inner;
    const ratio = ASPECT_RATIOS[d.aspect ?? 'square'] ?? null;
    const fixedH = pxValue(d.itemHeight,);
    return {
        mode: masonry ? 'masonry' : layout === 'grid' || layout === 'column' ? 'grid' : 'wrap',
        columns,
        slotWidth,
        width: columns * slotWidth,
        pad,
        itemWidth,
        itemHeight: masonry ? null : fixedH ?? (ratio ? Math.round(itemWidth / ratio,) : null),
        fit: masonry ? 'cover' : d.fit === 'contain' || d.fit === 'hug' ? d.fit : 'cover',
        radius: galleryItemRadius(s,) ?? itemRadiusCss(env.siteRadius,) ?? GALLERY_EMAIL_FALLBACK_RADIUS,
    };
}

/**
 * Email gallery. Items must already be public-media only. Each item is a
 * link to its gallery item page. With a fixed box (aspect or Item height):
 *   cover    a background-image cell of the box's size, cropped (VML for Outlook);
 *   contain  the whole picture centred in a cell of the box's size (every
 *            item the same size);
 *   hug      the item HUGS its media — sized from the media's own aspect,
 *            fitted inside the box, placed per the alignment (unknown aspect:
 *            the picture scaled down inside the limits).
 * Titles / captions go below (default) or above the picture, or ON it
 * (`overlay-top` / `overlay-bottom`: white text on a dark gradient, inside the
 * picture cell) — an item whose size is unknown falls back to below.
 * `original` aspect with no height shows the picture at its natural height.
 * Never a background colour; the item radius is on the visible media, and a
 * video's "▶ Watch" bar spans the media's width.
 */
export function galleryEmailHtml(
    items: GalleryItem[] | null | undefined, base: string, settings: Partial<GalleryBlockSettings> = {}, env: GalleryEmailEnv = {},
): string {
    const list = (items ?? []).filter((i,) => i.media,);
    if (!list.length) return '';
    const plan = galleryEmailPlan(settings, env,);
    const { itemWidth: w, itemHeight: h, radius, pad, slotWidth, } = plan;
    const r = esc(radius,);
    const text = safeCss(env.textColor,) || '#333333';
    const place = galleryTitlePlacement(settings,);
    const ta = place.align ?? String(env.textAlign ?? '',).trim();
    const align = ['left', 'center', 'right', 'justify',].includes(ta,) ? ta : plan.mode === 'wrap' ? 'center' : 'left';
    const rowAlign: GalleryEmailAlign = env.align ?? 'center';
    const rowMargin = rowAlign === 'left' ? '0 auto 0 0' : rowAlign === 'right' ? '0 0 0 auto' : '0 auto';

    // Where an item narrower than its slot sits (a contain item hugging its media).
    const placeMargin = rowMargin;

    /**
     * The picture as the BACKGROUND of a `bw`×`bh` cell (VML for Outlook), the
     * radius on that cell, a video's "▶ Watch" bar laid ON its bottom edge.
     * No background colour: a cell exactly the media's size (contain) has
     * nothing to fill, and a cover crop fills itself — the block's own
     * background is all that may show.
     */
    const bgCell = (
        src: string, href: string, alt: string, isVideo: boolean, bw: number, bh: number, size: 'cover' | 'contain', cssSrc = src, over = '',
    ): string => {
        const vml = `<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${bw}px;height:${bh}px;"><v:fill type="frame" src="${src}" aspect="${size === 'cover' ? 'atleast' : 'atmost'}" /><v:textbox inset="0,0,0,0"><![endif]-->`;
        let content: string;
        if (over) {
            // Title ON the picture: a full-height table, the text row at the top
            // or the bottom (above a video's Watch bar), a flexible spacer between.
            const spacer = '<tr><td style="font-size:0;line-height:0">&nbsp;</td></tr>';
            const textRow = `<tr><td valign="${place.position === 'overlay-top' ? 'top' : 'bottom'}" style="padding:0">${over}</td></tr>`;
            const bar = isVideo ? `<tr>${watchBarCell(radius,)}</tr>` : '';
            const rows = place.position === 'overlay-top' ? textRow + spacer + bar : spacer + textRow + bar;
            content = `<table role="presentation" width="100%" height="${bh}" cellpadding="0" cellspacing="0" border="0" style="width:100%;height:${bh}px;border-collapse:separate">${rows}</table>`;
        } else {
            content = isVideo
                ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate"><tr><td height="${Math.max(0, bh - WATCH_BAR_HEIGHT,)}" style="height:${Math.max(0, bh - WATCH_BAR_HEIGHT,)}px;font-size:0;line-height:0">&nbsp;</td></tr><tr>${watchBarCell(radius,)}</tr></table>`
                : `<span style="display:block;height:${bh}px;font-size:0;line-height:0">&nbsp;</span>`;
        }
        return `<table role="presentation" width="${bw}" cellpadding="0" cellspacing="0" border="0" style="width:${bw}px;max-width:100%;margin:${placeMargin};border-collapse:separate"><tr><td class="gallery-item-media" background="${src}" width="${bw}" height="${bh}" valign="bottom" role="img" aria-label="${alt}" title="${alt}" style="width:${bw}px;height:${bh}px;padding:0;vertical-align:bottom;background-image:url('${cssSrc}');background-position:center center;background-size:${size};background-repeat:no-repeat;border-radius:${r}">`
            + `${vml}<a href="${href}" title="${alt}" style="display:block;text-decoration:none;color:#ffffff">${content}</a><!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr></table>`;
    };

    /** Set by `visualOf` when it placed the title ON the picture. */
    let overlaid = false;
    const visualOf = (i: GalleryItem, over = '',): string => {
        overlaid = false;
        /** A background cell carrying the overlay (when there is one). */
        const cellOf = (src: string, href: string, alt: string, isVideo: boolean, bw: number, bh: number, size: 'cover' | 'contain', cssSrc: string,) => {
            if (over) overlaid = true;
            return bgCell(src, href, alt, isVideo, bw, bh, size, cssSrc, over,);
        };
        const href = esc(absoluteGalleryUrl(i.url, base,),);
        const rawSrc = absoluteGalleryUrl(previewUrl(i,), base,);
        const src = esc(rawSrc,);
        const cssSrc = esc(cssUrl(rawSrc,),);
        const isVideo = i.media?.type === 'video';
        const alt = esc(i.media?.alt || i.title || (isVideo ? 'Video' : 'Image'),);
        if (!src) {
            // No picture (a video without a poster): a dark tile that still links to the item.
            const hCss = h ? `height:${h}px;box-sizing:border-box;line-height:${Math.max(0, h - 16,)}px;padding:8px;` : 'padding:40px 8px;';
            return `<a href="${href}" style="display:block;background:#111111;color:#ffffff;text-align:center;${hCss}text-decoration:none;font-weight:bold;border-radius:${r};">&#9654; ${isVideo ? 'Watch video' : 'View'}</a>`;
        }
        if (h && plan.fit === 'cover') {
            // Cover: the fixed box, the picture cropped to fill it (the site's object-fit: cover).
            return cellOf(src, href, alt, isVideo, w, h, 'cover', cssSrc,);
        }
        /** The picture scaled to `width` (never stretched), its corners `corners`. */
        const plain = (width: number, corners: string, height?: number,) =>
            `<img class="gallery-item-media" src="${src}" alt="${alt}" width="${width}"${height ? ` height="${height}"` : ''} style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;margin:${placeMargin};border-radius:${corners};" />`;
        if (h && plan.fit === 'contain') {
            // Contain: the whole picture centred in the item box — every item the same size.
            const ar = mediaAspect(i,);
            if (isVideo || over) return cellOf(src, href, alt, isVideo, w, h, 'contain', cssSrc,);
            const inner = ar
                ? (() => { const f = galleryContainSize(w, h, ar,); return plain(f.width, r, f.height,).replace(`margin:${placeMargin};`, 'margin:0 auto;',); })()
                : `<img class="gallery-item-media" src="${src}" alt="${alt}" width="${w}" style="display:block;width:auto;max-width:${w}px;height:auto;max-height:${h}px;border:0;outline:none;text-decoration:none;margin:0 auto;border-radius:${r};" />`;
            return `<table role="presentation" width="${w}" cellpadding="0" cellspacing="0" border="0" style="width:${w}px;max-width:100%;margin:${placeMargin};border-collapse:collapse"><tr><td align="center" valign="middle" height="${h}" style="height:${h}px;padding:0;text-align:center;vertical-align:middle"><a href="${href}" style="display:block;text-decoration:none;">${inner}</a></td></tr></table>`;
        }
        if (h) {
            // Hug: the item IS the media at its own aspect, fitted inside the box.
            const ar = mediaAspect(i,);
            if (ar) {
                const fit = galleryContainSize(w, h, ar,);
                if (isVideo || over) return cellOf(src, href, alt, isVideo, fit.width, fit.height, 'cover', cssSrc,);
                return `<a href="${href}" style="display:block;text-decoration:none;">${plain(fit.width, r, fit.height,)}</a>`;
            }
            // Unknown aspect: the picture scaled down inside the limits (no box to letterbox in).
            const img = `<img class="gallery-item-media" src="${src}" alt="${alt}" width="${w}" style="display:block;width:auto;max-width:${w}px;height:auto;max-height:${h}px;border:0;outline:none;text-decoration:none;`;
            if (!isVideo) return `<a href="${href}" style="display:block;text-decoration:none;">${img}margin:${placeMargin};border-radius:${r};" /></a>`;
            // A shrink-wrapped table: the Watch bar is as wide as the picture above it.
            return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${placeMargin};border-collapse:separate"><tr><td style="padding:0"><a href="${href}" style="text-decoration:none;">${img}border-radius:${r} ${r} 0 0;" /></a></td></tr><tr>${watchBarCell(radius, href,)}</tr></table>`;
        }
        // Masonry: the item at its natural aspect, width = the column width,
        // the height known up front (width/height attributes for Outlook).
        const ar = plan.mode === 'masonry' ? mediaAspect(i,) : null;
        if (ar) {
            const nh = Math.max(1, Math.round(w / ar,),);
            if (isVideo || over) return cellOf(src, href, alt, isVideo, w, nh, 'cover', cssSrc,);
            return `<a href="${href}" style="display:block;text-decoration:none;">${plain(w, r, nh,)}</a>`;
        }
        // Natural height: the picture itself, scaled to the item width.
        if (isVideo) {
            // A video's poster gets the "▶ Watch" bar right under it (no fixed
            // height to layer on): square bottom corners on the picture, rounded ones on the bar.
            return `<table role="presentation" width="${w}" cellpadding="0" cellspacing="0" border="0" style="width:${w}px;max-width:100%;margin:${placeMargin};border-collapse:separate"><tr><td style="padding:0"><a href="${href}" style="text-decoration:none;">${plain(w, `${r} ${r} 0 0`,)}</a></td></tr><tr>${watchBarCell(radius, href,)}</tr></table>`;
        }
        return `<a href="${href}" style="display:block;text-decoration:none;">${plain(w, r,)}</a>`;
    };

    /** Title + caption lines; `on` = white on the picture's gradient. */
    const textOf = (i: GalleryItem, on = false,): string => {
        const color = on ? '#ffffff' : text;
        const title = settings.showTitles && i.title ? `<div style="padding-top:${on ? 0 : 4}px;font-size:14px;font-weight:bold;color:${color};text-align:${align};">${esc(i.title,)}</div>` : '';
        const caption = settings.showCaptions && i.caption ? `<div style="padding-top:2px;font-size:13px;color:${color};text-align:${align};">${esc(i.caption,)}</div>` : '';
        if (!title && !caption) return '';
        if (on) {
            const dir = place.position === 'overlay-top' ? 'to bottom' : 'to top';
            // Solid fallback colour first (Outlook ignores gradients).
            return `<div style="padding:12px 14px;background-color:rgba(0,0,0,0.45);background-image:linear-gradient(${dir},rgba(0,0,0,0.75),rgba(0,0,0,0));border-radius:${place.position === 'overlay-top' ? `${r} ${r} 0 0` : `0 0 ${r} ${r}`};">${title}${caption}</div>`;
        }
        if (place.position === 'above') return `<div style="padding-bottom:4px;">${title.replace('padding-top:4px;', '',)}${caption}</div>`;
        return title + caption;
    };

    /** The picture with its title + caption, per the title position. */
    const itemOf = (i: GalleryItem,): string => {
        if (place.overlay) {
            const html = visualOf(i, textOf(i, true,),);
            return overlaid ? html : html + textOf(i,);
        }
        const visual = visualOf(i,);
        return place.position === 'above' ? textOf(i,) + visual : visual + textOf(i,);
    };

    const cell = (i: GalleryItem, pct: string,): string =>
        `<td width="${slotWidth}" align="${rowAlign}" valign="top" style="width:${pct};padding:${pad}px;vertical-align:top;">${itemOf(i,)}</td>`;

    if (plan.mode === 'masonry') {
        // One row of column cells; each a stack of items, every item in the
        // currently-shortest column (estimated px: the media at the column
        // width + the title / caption lines + the padding).
        const est = (i: GalleryItem,): number => {
            const ar = mediaAspect(i,) ?? 1;
            return w / ar + 2 * pad + (place.overlay ? 0 : (settings.showTitles && i.title ? 22 : 0) + (settings.showCaptions && i.caption ? 20 : 0));
        };
        const cols = galleryMasonryColumns(list, plan.columns, est,);
        const pct = `${Math.floor(10000 / plan.columns,) / 100}%`;
        const cells = cols.map((idx,) => {
            const stack = idx.map((k,) => {
                const i = list[k]!;
                return `<tr><td align="${rowAlign}" style="padding:${pad}px;vertical-align:top;">${itemOf(i,)}</td></tr>`;
            },).join('',);
            return `<td class="gallery-masonry-col" width="${slotWidth}" valign="top" style="width:${pct};padding:0;vertical-align:top;">`
                + (stack ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${stack}</table>` : '')
                + '</td>';
        },);
        return `<table role="presentation" class="gallery-grid gallery-grid--masonry" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td align="${rowAlign}" style="padding:0;">`
            + `<table role="presentation" align="${rowAlign}" width="${plan.width}" cellpadding="0" cellspacing="0" border="0" style="width:${plan.width}px;max-width:100%;margin:${rowMargin};border-collapse:collapse;"><tr>${cells.join('',)}</tr></table>`
            + '</td></tr></table>';
    }

    const rows: string[] = [];
    for (let at = 0; at < list.length; at += plan.columns) {
        const slice = list.slice(at, at + plan.columns,);
        // A grid keeps every column (the last row padded, left-aligned like the site);
        // a wrapped row is only as wide as its items, centred.
        const n = plan.mode === 'grid' ? plan.columns : slice.length;
        const pct = `${Math.floor(10000 / n,) / 100}%`;
        const cells = slice.map((i,) => cell(i, pct,),);
        while (cells.length < n) cells.push(`<td width="${slotWidth}" style="width:${pct};padding:${pad}px;"></td>`,);
        const rowW = n * slotWidth;
        rows.push(
            `<tr><td align="${rowAlign}" style="padding:0;"><table role="presentation" align="${rowAlign}" width="${rowW}" cellpadding="0" cellspacing="0" border="0" style="width:${rowW}px;max-width:100%;margin:${rowMargin};border-collapse:collapse;"><tr>${cells.join('',)}</tr></table></td></tr>`,
        );
    }
    return `<table role="presentation" class="gallery-grid gallery-grid--${plan.mode}" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows.join('',)}</table>`;
}
