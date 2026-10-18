/**
 * `{{ gallery(...) }}` — ONE mapping from a call to a GalleryQuery + display
 * options, shared by the site, SSR and email runtimes and by the Gallery
 * content block (whose settings are the same GalleryBlockSettings shape).
 *
 *   {{gallery('<item id>')}}                       one item (whole render: the media)
 *   {{gallery('<item id>').media.url}}             a property of it
 *   {{gallery(8)}}  {{gallery('video', 4)}}        the first N items (of a type)
 *   {{gallery(type='image', tag='featured', sort='newest', limit=12,
 *             layout='grid', columns=4, gap='8px', aspect='square')}}
 *   {{gallery(collection='<collection id>')}}       a collection's items (`'root'` = items in no collection)
 *   {{gallery(layout='carousel', itemsPerPage=3, autoplay=true, interval=4)}}
 *   {{gallery(itemRadius='0')}}                    item corners (default: the site radius)
 *   {{for gallery(tag='events', limit=6) as g}} <img src="{{g.media.thumbnailUrl}}"> {{endfor}}
 *
 * Each runtime runs the query its own way (SDK on the site, the service on
 * the server — email: public media only) and returns
 * `entityRef(GALLERY_LIST_KIND, items)` / `entityRef(GALLERY_ITEM_KIND, item, id)`;
 * the call's named args ride on the ref's `options` (evaluator), and
 * `galleryDisplayFrom(options)` turns them into render settings.
 */
import type { GalleryBlockLayout, GalleryBlockLayoutOptions, GalleryBlockSettings, GalleryOpenMode, GalleryQuery, } from '../types/gallery';
import { DEFAULT_GALLERY_BLOCK_SETTINGS, } from '../types/gallery';
import { itemRadiusCss, } from '../utils/blockStyleCss';

export const GALLERY_LIST_KIND = 'galleryList';
export const GALLERY_ITEM_KIND = 'galleryItem';
export const GALLERY_FUNCTION_NAMES = ['gallery',] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown,) => (v === undefined || v === null ? '' : String(v,).trim());
const num = (v: unknown,): number | undefined => {
    const n = Number(v,);
    return Number.isFinite(n,) && str(v,) !== '' ? n : undefined;
};
const bool = (v: unknown,): boolean | undefined => (v === undefined || v === null || v === '' ? undefined : v === true || v === 'true' || v === 1 || v === '1');

/** The call → what to fetch. `single` = one item by id. Null when `name` is not `gallery`. */
export function galleryCallFor(name: string, args: unknown[], named: Record<string, unknown> = {},): { query: GalleryQuery; single: boolean; } | null {
    if (name !== 'gallery') return null;
    const q: GalleryQuery = {};
    let single = false;
    for (const a of args) {
        const s = str(a,);
        if (UUID.test(s,)) {
            q.ids = [...(q.ids ?? []), s,];
        } else if (s === 'image' || s === 'video' || s === 'all') {
            q.type = s;
        } else if (num(a,) !== undefined) {
            q.limit = num(a,);
        } else if (s) {
            q.tag = s;
        }
    }
    if (q.ids?.length === 1 && args.length === 1) single = true;
    const t = str(named.type,);
    if (t === 'image' || t === 'video' || t === 'all') q.type = t;
    if (str(named.tag,)) q.tag = str(named.tag,);
    const coll = str(named.collection ?? named.collectionId,);
    if (coll === 'root' || UUID.test(coll,)) q.collectionId = coll;
    if (str(named.search,)) q.search = str(named.search,);
    const sort = str(named.sort,);
    if (['order', 'newest', 'oldest', 'title', 'random',].includes(sort,)) q.sort = sort as GalleryQuery['sort'];
    if (num(named.limit,) !== undefined) q.limit = num(named.limit,);
    if (num(named.page,) !== undefined) q.page = num(named.page,);
    const ids = str(named.ids,);
    if (ids) q.ids = ids.split(',',).map((x,) => x.trim()).filter((x,) => UUID.test(x,),);
    if (q.limit === undefined && !single) q.limit = 12;
    return { query: q, single, };
}

const LAYOUTS: GalleryBlockLayout[] = ['grid', 'row', 'column', 'carousel', 'stage', 'masonry',];

function layoutOpts(o: Record<string, unknown>, prefix: '' | 'mobile',): GalleryBlockLayoutOptions {
    const k = (base: string,) => (prefix ? `${prefix}${base[0].toUpperCase()}${base.slice(1,)}` : base);
    const out: GalleryBlockLayoutOptions = {};
    const layout = str(o[k('layout',)],);
    if (LAYOUTS.includes(layout as GalleryBlockLayout,)) out.layout = layout as GalleryBlockLayout;
    for (const key of ['columns', 'itemsPerPage', 'scrollBy', 'rows',] as const) {
        const n = num(o[k(key,)],);
        if (n !== undefined) out[key] = Math.max(1, Math.round(n,),);
    }
    for (const key of ['gap', 'itemWidth', 'itemHeight',] as const) {
        const s = str(o[k(key,)],);
        if (s && !/[;{}<>"]/.test(s,)) out[key] = /^\d+(\.\d+)?$/.test(s,) ? `${s}px` : s;
    }
    const aspect = str(o[k('aspect',)],);
    if (['square', '4:3', '3:2', '16:9', 'original',].includes(aspect,)) out.aspect = aspect as GalleryBlockLayoutOptions['aspect'];
    const fit = str(o[k('fit',)],);
    if (fit === 'cover' || fit === 'contain') out.fit = fit;
    return out;
}

/**
 * Render options of a call (`{{gallery(layout='row', columns=3, mobileColumns=1, autoplay=true)}}`)
 * → GalleryBlockSettings (layout knobs per breakpoint + behaviour), on top of the block defaults.
 */
export function galleryDisplayFrom(options: Record<string, unknown> = {},): Omit<GalleryBlockSettings, 'source' | 'itemIds' | 'query'> {
    const d = DEFAULT_GALLERY_BLOCK_SETTINGS;
    const open = str(options.open,);
    return {
        desktop: { ...d.desktop, ...layoutOpts(options, '',), },
        mobile: { ...d.mobile, ...layoutOpts(options, 'mobile',), },
        autoplay: bool(options.autoplay,) ?? d.autoplay,
        autoplayInterval: num(options.interval ?? options.autoplayInterval,) ?? d.autoplayInterval,
        pauseOnHover: bool(options.pauseOnHover,) ?? d.pauseOnHover,
        loop: bool(options.loop,) ?? d.loop,
        showArrows: bool(options.arrows ?? options.showArrows,) ?? d.showArrows,
        showDots: bool(options.dots ?? options.showDots,) ?? d.showDots,
        showTitles: bool(options.titles ?? options.showTitles,) ?? d.showTitles,
        showCaptions: bool(options.captions ?? options.showCaptions,) ?? d.showCaptions,
        open: (['lightbox', 'page', 'none',].includes(open,) ? open : d.open) as GalleryOpenMode,
        thumbStrip: bool(options.thumbs ?? options.thumbStrip,) ?? false,
        itemRadius: itemRadiusCss(options.itemRadius ?? options.radius,),
    };
}
