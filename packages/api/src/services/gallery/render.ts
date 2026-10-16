/**
 * Server-side gallery HTML — shared by the `{{gallery(...)}}` function and the
 * Gallery block, in both server renderers:
 *
 *   SSR    `galleryFiguresHtml`: indexable <figure> list (image or the video
 *          poster, alt text, a caption, a link to the item page). Crawlers
 *          care about words and links, not layout.
 *   Email  `galleryEmailHtml`: tables only (no CSS layout in mail clients).
 *          Two shapes: a GRID (`grid` → its columns, `column` → one per
 *          row) or a centred WRAPPED grid (`row` / `carousel` / `stage` —
 *          thumbnails flow left-to-right, each row centred). Every item links
 *          to its gallery item page (the block's on-click option is ignored —
 *          an inbox has no lightbox); a video keeps the "▶ Watch" bar.
 *
 * Every URL is absolutised against `base` (an inbox has no origin), and the
 * caller passes items already filtered for its audience (SSR: anonymous site
 * view; email: public media only).
 */
import { galleryItemRadius, itemRadiusCss, } from '@sitesurge/types';
import type { GalleryAspect, GalleryBlockSettings, GalleryItem, } from '@sitesurge/types';
import { EMAIL_CONTENT_WIDTH, pxValue, } from '../mail/blocks/_util';
import { WATCH_BAR_HEIGHT, watchBarCell, } from '../mail/blocks/watchOverlay';

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
}

/** The pixel geometry of one email gallery. Pure — unit-tested. */
export interface GalleryEmailPlan {
    /** `grid`: rows full width, left-aligned (last row padded); `wrap`: every row centred. */
    mode: 'grid' | 'wrap';
    columns: number;
    /** Width of one column slot, px (item + its padding). */
    slotWidth: number;
    /** Padding around each item, px (half the gap). */
    pad: number;
    /** The item box, px. `itemHeight` null = the picture's natural height. */
    itemWidth: number;
    itemHeight: number | null;
    fit: 'cover' | 'contain';
    radius: string;
}

/** A px length (`12px` / `12`), `0` allowed; anything else → null. */
const px0 = (v: unknown,): number | null => (String(v ?? '',).trim().match(/^0+(\.0+)?(px)?$/i,) ? 0 : pxValue(v,));

/**
 * Settings → email geometry. Only the DESKTOP options apply (an email has one
 * width). Columns: `grid` → `columns`, `column` → 1, `row` → `itemsPerPage`,
 * `carousel` / `stage` → `columns`, else `itemsPerPage`; a px `itemWidth`
 * instead fits as many as the width allows. Default 3, at most 6.
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
    const raw = layout === 'column'
        ? 1
        : layout === 'grid'
            ? (n(d.columns,) ?? fromWidth ?? 3)
            : (fromWidth ?? (layout === 'row' ? n(d.itemsPerPage,) : (n(d.columns,) ?? n(d.itemsPerPage,))) ?? 3);
    const columns = Math.min(6, Math.max(1, raw,),);
    const slotWidth = Math.floor(width / columns,);
    const inner = Math.max(1, slotWidth - 2 * pad,);
    const itemWidth = fixedW ? Math.min(fixedW, inner,) : inner;
    const ratio = ASPECT_RATIOS[d.aspect ?? 'square'] ?? null;
    const fixedH = pxValue(d.itemHeight,);
    return {
        mode: layout === 'grid' || layout === 'column' ? 'grid' : 'wrap',
        columns,
        slotWidth,
        pad,
        itemWidth,
        itemHeight: fixedH ?? (ratio ? Math.round(itemWidth / ratio,) : null),
        fit: d.fit === 'contain' ? 'contain' : 'cover',
        radius: galleryItemRadius(s,) ?? itemRadiusCss(env.siteRadius,) ?? GALLERY_EMAIL_FALLBACK_RADIUS,
    };
}

/**
 * Email gallery. Items must already be public-media only. Each item is a
 * link to its gallery item page; a fixed box (aspect or Item height) is a
 * background-image cell of that size (background-size = the Fit setting,
 * VML for Outlook) so the crop matches the site; `original` aspect with no
 * height shows the picture at its natural height.
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
    const align = plan.mode === 'wrap' ? 'center' : 'left';

    const visualOf = (i: GalleryItem,): string => {
        const href = esc(absUrl(i.url, base,),);
        const src = esc(absUrl(previewUrl(i,), base,),);
        const isVideo = i.media?.type === 'video';
        const alt = esc(i.media?.alt || i.title || (isVideo ? 'Video' : 'Image'),);
        const box = `role="presentation" align="center" width="${w}" cellpadding="0" cellspacing="0" border="0" style="width:${w}px;max-width:100%;margin:0 auto;border-collapse:separate"`;
        if (!src) {
            // No picture (a video without a poster): a dark tile that still links to the item.
            const hCss = h ? `height:${h}px;box-sizing:border-box;line-height:${Math.max(0, h - 16,)}px;padding:8px;` : 'padding:40px 8px;';
            return `<a href="${href}" style="display:block;background:#111111;color:#ffffff;text-align:center;${hCss}text-decoration:none;font-weight:bold;border-radius:${r};">&#9654; ${isVideo ? 'Watch video' : 'View'}</a>`;
        }
        if (h) {
            // Fixed box: the picture is the cell BACKGROUND, cropped (cover) or
            // letterboxed (contain) exactly like the site's object-fit.
            const bg = isVideo ? '#000000' : '#f1f1f1';
            const vml = `<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${w}px;height:${h}px;"><v:fill type="frame" src="${src}" color="${bg}" aspect="${plan.fit === 'cover' ? 'atleast' : 'atmost'}" /><v:textbox inset="0,0,0,0"><![endif]-->`;
            const content = isVideo
                ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate"><tr><td height="${Math.max(0, h - WATCH_BAR_HEIGHT,)}" style="height:${Math.max(0, h - WATCH_BAR_HEIGHT,)}px;font-size:0;line-height:0">&nbsp;</td></tr><tr>${watchBarCell(radius,)}</tr></table>`
                : `<span style="display:block;height:${h}px;font-size:0;line-height:0">&nbsp;</span>`;
            return `<table ${box}><tr><td background="${src}" bgcolor="${bg}" width="${w}" height="${h}" valign="bottom" role="img" aria-label="${alt}" title="${alt}" style="width:${w}px;height:${h}px;padding:0;vertical-align:bottom;background-color:${bg};background-image:url('${src}');background-position:center center;background-size:${plan.fit};background-repeat:no-repeat;border-radius:${r}">`
                + `${vml}<a href="${href}" title="${alt}" style="display:block;text-decoration:none;color:#ffffff">${content}</a><!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr></table>`;
        }
        // Natural height: the picture itself, scaled to the item width.
        const imgStyle = `display:block;width:100%;max-width:${w}px;height:auto;border:0;outline:none;text-decoration:none;`;
        if (isVideo) {
            // A video's poster gets the "▶ Watch" bar right under it (no fixed
            // height to layer on): square bottom corners on the picture, rounded ones on the bar.
            return `<table ${box}><tr><td style="padding:0"><a href="${href}" style="text-decoration:none;"><img src="${src}" alt="${alt}" width="${w}" style="${imgStyle}border-radius:${r} ${r} 0 0;" /></a></td></tr><tr>${watchBarCell(radius, href,)}</tr></table>`;
        }
        return `<a href="${href}" style="display:block;text-decoration:none;"><img src="${src}" alt="${alt}" width="${w}" style="${imgStyle}margin:0 auto;border-radius:${r};" /></a>`;
    };

    const cell = (i: GalleryItem, pct: string,): string => {
        const title = settings.showTitles && i.title ? `<div style="padding-top:4px;font-size:14px;font-weight:bold;color:${text};text-align:${align};">${esc(i.title,)}</div>` : '';
        const caption = settings.showCaptions && i.caption ? `<div style="padding-top:2px;font-size:13px;color:${text};text-align:${align};">${esc(i.caption,)}</div>` : '';
        return `<td width="${slotWidth}" align="center" valign="top" style="width:${pct};padding:${pad}px;vertical-align:top;">${visualOf(i,)}${title}${caption}</td>`;
    };

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
            `<tr><td align="center" style="padding:0;"><table role="presentation" align="center" width="${rowW}" cellpadding="0" cellspacing="0" border="0" style="width:${rowW}px;max-width:100%;margin:0 auto;border-collapse:collapse;"><tr>${cells.join('',)}</tr></table></td></tr>`,
        );
    }
    return `<table role="presentation" class="gallery-grid gallery-grid--${plan.mode}" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows.join('',)}</table>`;
}
