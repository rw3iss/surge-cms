/**
 * Gallery (`gallery` feature): media published for visitors to view.
 *
 * A gallery item is a 1:1 link to a media library item — "a published media
 * item". Deleting the item never deletes the media (the admin may ask to); if
 * the MEDIA is deleted the item stays but is hidden from the public (404)
 * until an editor removes it.
 *
 * Access is a LEVEL comparable with subscription tier ranks (anonymous = -1,
 * signed in = 0, a subscriber = their tier's rank, staff = ∞): the gallery
 * has a floor, and an item may set its own (`inherit` = the gallery's).
 * That gates the IN-SITE view only. Email and other public renderers use the
 * media's own CDN URL whenever the MEDIA is public, whatever the item's gate.
 */

export type GalleryMediaType = 'image' | 'video';

/** Who may view: everyone, signed-in members, or subscribers from a tier up. */
export type GalleryAccess = 'public' | 'members' | 'tier';
/** An item's own rule; `inherit` follows the gallery settings. */
export type GalleryItemVisibility = 'inherit' | GalleryAccess;
/** Per-item switch that falls back to the gallery setting. */
export type GalleryInheritSwitch = 'inherit' | 'on' | 'off';

export type GalleryLayout = 'grid' | 'masonry' | 'carousel' | 'stage';
/** What clicking an item does on the gallery page. */
export type GalleryOpenMode = 'lightbox' | 'page' | 'none';
export type GalleryAspect = 'square' | '4:3' | '3:2' | '16:9' | 'original';

export interface GalleryAppearance {
    layout: GalleryLayout;
    open: GalleryOpenMode;
    /** Minimum thumbnail column width, px (grid/masonry). */
    thumbSize: number;
    /** CSS length between items. */
    gap: string;
    aspect: GalleryAspect;
    fit: 'cover' | 'contain';
    /** CSS length; '' = the site radius. */
    radius: string;
    /** Page side gutter: the site's (`--site-gutter`) or `customGutter`. */
    gutter: 'site' | 'custom';
    customGutter: string;
    /** Page top/bottom padding: the site's page padding or `customPadding`. */
    padding: 'site' | 'custom';
    customPadding: string;
    /** Content max-width: the site's or `customMaxWidth` ('' = full width). */
    maxWidth: 'site' | 'custom';
    customMaxWidth: string;
    showTitles: boolean;
    showCaptions: boolean;
    /** Slight zoom on hover. */
    hoverZoom: boolean;
    /** Items per page on the gallery page (load more). */
    perPage: number;
    /** Show a play badge on video thumbnails. */
    videoBadge: boolean;
}

export interface GallerySettings {
    title: string;
    description: string;
    /** Public route of the gallery, a single path segment. Default `/gallery`. */
    baseUrl: string;
    access: GalleryAccess;
    /** Required tier when `access = 'tier'` (its rank is compared, so higher tiers pass). */
    minTierId: string | null;
    /** Allow videos in the gallery (and in the media picker). */
    allowVideos: boolean;
    /** Default commenting for items (needs the Comments feature). */
    commentsEnabled: boolean;
    /** Default for guest comments (still subject to `comments:anonymous` + approval). */
    allowAnonymousComments: boolean;
    appearance: GalleryAppearance;
}

export const DEFAULT_GALLERY_APPEARANCE: GalleryAppearance = {
    layout: 'grid',
    open: 'lightbox',
    thumbSize: 240,
    gap: '12px',
    aspect: 'square',
    fit: 'cover',
    radius: '',
    gutter: 'site',
    customGutter: '16px',
    padding: 'site',
    customPadding: '24px',
    maxWidth: 'site',
    customMaxWidth: '',
    showTitles: false,
    showCaptions: false,
    hoverZoom: true,
    perPage: 24,
    videoBadge: true,
};

export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
    title: 'Gallery',
    description: '',
    baseUrl: '/gallery',
    access: 'public',
    minTierId: null,
    allowVideos: true,
    commentsEnabled: false,
    allowAnonymousComments: false,
    appearance: DEFAULT_GALLERY_APPEARANCE,
};

/** The media behind an item (null when the media was deleted). */
export interface GalleryMedia {
    id: string;
    type: GalleryMediaType;
    mimeType: string;
    url: string;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    title: string | null;
    caption: string | null;
    alt: string | null;
    credits: string | null;
    /** `public` media may be shown anywhere (email, feeds) by its CDN URL. */
    accessLevel: 'public' | 'private';
    status: string;
}

export interface GalleryItem {
    id: string;
    mediaId: string | null;
    /** null = the media was deleted: hidden from the public. */
    media: GalleryMedia | null;
    /** Display title / caption: the item's own, else the media's. */
    title: string;
    caption: string;
    /** The item's own overrides (admin; empty = use the media's). */
    titleOverride: string | null;
    captionOverride: string | null;
    tags: string[];
    sortOrder: number;
    visibility: GalleryItemVisibility;
    /** Tier for `visibility = 'tier'`. */
    minTierId: string | null;
    comments: GalleryInheritSwitch;
    anonymousComments: GalleryInheritSwitch;
    /** Public page of the item: `<baseUrl>/<id>`. */
    url: string;
    commentCount: number;
    createdAt: string;
    updatedAt: string;
}

export type GallerySort = 'order' | 'newest' | 'oldest' | 'title' | 'random';

/** One query shape for the API, the SDK, `{{gallery(...)}}` and the Gallery block. */
export interface GalleryQuery {
    /** Specific items, in this order (overrides sort). */
    ids?: string[];
    type?: GalleryMediaType | 'all';
    /** Items carrying this tag (any of, comma list). */
    tag?: string;
    /** Title / caption / media name contains. */
    search?: string;
    sort?: GallerySort;
    limit?: number;
    page?: number;
}

export interface GalleryListResult {
    items: GalleryItem[];
    total: number;
    page: number;
    limit: number;
}

/** What the public gallery page needs (no secrets; viewer-shaped `canView`). */
export interface GalleryPublicConfig {
    title: string;
    description: string;
    baseUrl: string;
    allowVideos: boolean;
    appearance: GalleryAppearance;
    /** May THIS viewer open the gallery. */
    canView: boolean;
    /** Why not (sign in / subscribe), for the page. */
    reason: 'signin' | 'subscribe' | null;
    requiredTier: { id: string; name: string; } | null;
}

// ─── Gallery content block ───────────────────────────────────────────────

export type GalleryBlockLayout = 'grid' | 'row' | 'column' | 'carousel' | 'stage';

/** Per-breakpoint layout knobs (mobile falls back to desktop per key). */
export interface GalleryBlockLayoutOptions {
    layout?: GalleryBlockLayout;
    /** Grid columns (grid). */
    columns?: number;
    /** Items visible at once (row / carousel). */
    itemsPerPage?: number;
    /** Items advanced per step (row / carousel). */
    scrollBy?: number;
    /** CSS lengths. */
    gap?: string;
    itemWidth?: string;
    itemHeight?: string;
    aspect?: GalleryAspect;
    fit?: 'cover' | 'contain';
    /** Rows shown before scrolling/paging (column / grid). */
    rows?: number;
}

export interface GalleryBlockSettings {
    /** `items` = hand-picked ids; `query` = a live query. */
    source: 'items' | 'query';
    itemIds?: string[];
    query?: GalleryQuery;
    desktop?: GalleryBlockLayoutOptions;
    mobile?: GalleryBlockLayoutOptions;
    /** Row / carousel: advance automatically. */
    autoplay?: boolean;
    /** Seconds between steps. */
    autoplayInterval?: number;
    pauseOnHover?: boolean;
    loop?: boolean;
    showArrows?: boolean;
    showDots?: boolean;
    showTitles?: boolean;
    showCaptions?: boolean;
    /** Click: lightbox (default), the item's page, or nothing. */
    open?: GalleryOpenMode;
    radius?: string;
}

export const DEFAULT_GALLERY_BLOCK_SETTINGS: GalleryBlockSettings = {
    source: 'query',
    query: { type: 'all', sort: 'order', limit: 12, },
    desktop: { layout: 'grid', columns: 4, itemsPerPage: 4, scrollBy: 1, gap: '12px', aspect: 'square', fit: 'cover', },
    mobile: { columns: 2, itemsPerPage: 1, },
    autoplay: false,
    autoplayInterval: 5,
    pauseOnHover: true,
    loop: true,
    showArrows: true,
    showDots: true,
    showTitles: false,
    showCaptions: false,
    open: 'lightbox',
};

/** Gallery item media type from a MIME type. */
export function galleryMediaType(mime: string | null | undefined,): GalleryMediaType {
    return String(mime ?? '',).toLowerCase().startsWith('video/',) ? 'video' : 'image';
}

/** `/gallery` + id → item page path. */
export function galleryItemPath(baseUrl: string, id: string,): string {
    return `${(baseUrl || '/gallery').replace(/\/+$/, '',)}/${id}`;
}
