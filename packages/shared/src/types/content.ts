export type ContentAccessLevel = 'public' | 'member' | 'patron';

export type PageStatus = 'draft' | 'published' | 'archived';

export interface Page {
    id: string;
    slug: string;
    title: string;
    /** Alignment of the auto-printed `<h1>` title (when showTitle). */
    titleAlignment?: 'left' | 'center' | 'right';
    description?: string;
    metaTitle?: string;
    metaDescription?: string;
    metaKeywords?: string[];
    ogImage?: string;
    status: PageStatus;
    isHomepage: boolean;
    showInNav: boolean;
    navOrder: number;
    isPrivate: boolean;
    accessLevel?: ContentAccessLevel;
    blocks: Block[];
    /** When true (default), the public renderer prints the page title
     *  as an `<h1>` above the content blocks. When false, the title
     *  is suppressed and only the blocks render — useful when an
     *  operator wants their first content block (e.g. a hero) to be
     *  the visual headline instead. */
    showTitle: boolean;
    /** When true (default), the page renderer applies the site's Page Padding
     *  (top/bottom) to this page. Turn off to remove vertical padding. */
    applyPagePadding?: boolean;
    /** When true (default), the page renderer applies the site gutter
     *  (left/right padding) to this page. */
    applySiteGutter?: boolean;
    /** Which Site Header color style this page renders the header in:
     *  `default` (regular header bg/text) or `alt` (the alternate colors).
     *  Empty/undefined → `default`. */
    headerStyle?: 'default' | 'alt';
    /** Header position for this page: `static` (in flow) or `float` (overlays
     *  content). Empty/undefined → inherit the site's `headerPosition`. */
    headerPosition?: 'static' | 'float';
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export type BlockType =
    | 'rich_text'
    | 'text'
    | 'post'
    | 'post_list'
    | 'form'
    | 'image'
    | 'video'
    | 'gallery'
    | 'social'
    | 'campaign'
    | 'hero'
    | 'html'
    | 'document'
    | 'url_link'
    | 'carousel'
    | 'spacer'
    | 'group'
    | 'group_item';

export interface Block {
    id: string;
    pageId: string;
    /** Parent block id; null for top-level blocks. Children of a group/group_item
     *  reference the parent via this field. */
    parentBlockId: string | null;
    type: BlockType;
    title?: string;
    content?: string;
    settings: BlockSettings;
    order: number;
    isVisible: boolean;
    /** Per-block style. Either a hydrated style-template object, a
     *  `{ id }` reference (the unhydrated form), or a bag of inline
     *  CSS-token overrides (`backgroundColor`, `padding`, etc.) the
     *  renderer applies directly. `null` means "explicitly cleared";
     *  `undefined` means "inherit from site defaults". */
    style?: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
    /** In-memory tree assembly. Populated by `buildBlockTree()`; not stored. */
    children?: Block[];
}

export interface BlockSettings {
    postId?: string;
    formId?: string;
    campaignId?: string;
    socialPlatform?: SocialPlatform;
    socialPostIds?: string[];
    mediaIds?: string[];
    layout?: 'full' | 'contained' | 'wide';
    backgroundColor?: string;
    textColor?: string;
    padding?: string;
    customClasses?: string;
    [key: string]: unknown;
}

export type PostStatus = 'draft' | 'published' | 'archived';

export interface Post {
    id: string;
    slug: string;
    title: string;
    excerpt?: string;
    content: string;
    featuredImage?: string;
    author: string;
    authorId: string;
    status: PostStatus;
    isPrivate: boolean;
    accessLevel?: ContentAccessLevel;
    tags: string[];
    categories: string[];
    metaTitle?: string;
    metaDescription?: string;
    publishedAt?: Date;
    publishAt?: string | null;
    /** When true (default), the post renderer applies the site's Post Padding
     *  (primarily top/bottom) to this post. */
    applyPostPadding?: boolean;
    /** When true (default), the post renderer applies the site gutter
     *  (left/right padding) to this post. */
    applySiteGutter?: boolean;
    /** Which Site Header color style this post renders the header in:
     *  `default` | `alt`. Empty/undefined → inherit the site's
     *  `defaultPostHeaderStyle`. */
    headerStyle?: 'default' | 'alt';
    /** Header position for this post: `static` | `float`. Empty/undefined →
     *  inherit the site's `headerPosition`. */
    headerPosition?: 'static' | 'float';
    /** How the banner/featured image + title/meta header renders on the post
     *  page: `standalone` (default — image below the title), `hero` (full-width
     *  image with the title/meta overlaid), `hero-full` (like hero but the
     *  banner background spans the ENTIRE page width edge-to-edge while the
     *  title/meta stay in the centered content column), or `thumbnail` (small
     *  image beside the title/meta). Only meaningful when `featuredImage` is
     *  set. */
    bannerLayout?: 'hero' | 'hero-full' | 'standalone' | 'thumbnail';
    /** Vertical anchor of the banner image (background-position / object-position):
     *  `start` (top), `center` (default), or `end` (bottom). */
    bannerImagePosition?: 'start' | 'center' | 'end';
    createdAt: Date;
    updatedAt: Date;
}

export type SocialPlatform =
    | 'patreon'
    | 'youtube'
    | 'instagram'
    | 'facebook'
    | 'twitter'
    | 'tiktok';

export interface SocialPost {
    id: string;
    platform: SocialPlatform;
    externalId: string;
    content?: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    authorName?: string;
    authorAvatar?: string;
    likes?: number;
    comments?: number;
    shares?: number;
    publishedAt: Date;
    fetchedAt: Date;
    rawData: Record<string, unknown>;
    /** How the row entered the cache. Defaults to 'sync' for provider pulls. */
    source?: 'sync' | 'manual' | 'posse';
    /** Canonical permalink (e.g. the X tweet URL) for re-hydrate / oEmbed. */
    postUrl?: string | null;
    /** Admin-hidden from the public feed without deleting. */
    isHidden?: boolean;
    /** Manual ordering within a platform's feed (lower = earlier). */
    sortOrder?: number;
}

export interface Media {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
    thumbnailUrl?: string;
    alt?: string;
    caption?: string;
    uploadedBy: string;
    createdAt: Date;
}

export interface NavigationItem {
    id: string;
    label: string;
    slug: string;
    isExternal: boolean;
    url?: string;
    order: number;
    isVisible: boolean;
    requiresAuth: boolean;
}

export interface AppearanceSettings {
    // Colors
    backgroundColor?: string;
    textColor?: string;
    primaryColor?: string;
    linkColor?: string;
    headingColor?: string;
    borderColor?: string;
    // Typography
    fontFamily?: string;
    headingFontFamily?: string;
    fontSize?: number;
    headingWeight?: string;
    lineHeight?: string;
    // Layout
    gutterWidth?: string;
    borderRadius?: string;
    maxContentWidth?: string;
    blockPadding?: string;
    /** Default vertical padding (top/bottom) applied to pages that opt in
     *  via their `applyPagePadding` flag. Empty/undefined → 0. Kept separate
     *  from the gutter so a page can take left/right gutter without vertical
     *  padding (or vice-versa). Exposed as `--site-page-padding`. */
    pagePadding?: string;
    /** Default padding applied to post pages that opt in via their
     *  `applyPostPadding` flag. Primarily vertical (the gutter overrides
     *  left/right). Empty/undefined → 0. Exposed as `--site-post-padding`. */
    postPadding?: string;
}

export interface SiteSettings {
    siteName: string;
    /**
     * Optional short tagline shown in the footer and other surfaces
     * below the site name. When empty/undefined, callers must hide the
     * rendering — never substitute a default.
     */
    siteTagline?: string;
    siteDescription: string;
    logo?: string;
    favicon?: string;
    socialLinks: Record<SocialPlatform, string>;
    contactEmail: string;
    analytics?: {
        googleAnalyticsId?: string;
        facebookPixelId?: string;
    };
    theme?: {
        primaryColor: string;
        secondaryColor: string;
        accentColor: string;
    };
    appearance?: AppearanceSettings;
    /**
     * Server-computed feature flags. Each flag is the AND of an admin
     * toggle (in `site_settings`) and the runtime conditions required
     * for the feature to actually work (e.g. a connected provider).
     * The frontend only reads these — it does NOT recompute the
     * underlying conditions, so future provider additions only need to
     * touch the backend.
     */
    features?: SiteFeatures;
}

/**
 * Each feature carries an `enabled` boolean computed server-side. UI
 * (sidebar nav, public page links, dashboard panel) reads these flags
 * verbatim — never recomputes.
 *
 * Module flags (posts / campaigns / forms / messages) default to
 * `true` on a fresh install — they're core CMS features the operator
 * can turn off if they don't want them in the sidebar. Provider flags
 * (patreon, etc.) default to `false` and require both an admin opt-in
 * AND a connected account before they flip on. The shape is the same
 * for both kinds so consumer code stays uniform.
 */
export interface SiteFeatures {
    patreon: { enabled: boolean; };
    posts: { enabled: boolean; };
    campaigns: { enabled: boolean; };
    forms: { enabled: boolean; };
    messages: { enabled: boolean; };
    /**
     * Social feed hub. When enabled, the admin sidebar exposes the Social
     * area (Posts capture, Compose/cross-post, provider Connections config).
     * Module flag, enabled by default.
     */
    social: { enabled: boolean; };
    /**
     * Custom user registration & login. When enabled, the public
     * login page shows its sign-in form expanded by default and a
     * register/join link, the public /join page accepts new
     * registrations, and the admin sidebar exposes the Users
     * management area. Admins can always sign in regardless — this
     * only gates user-facing registration UI.
     */
    users: { enabled: boolean; };
    /**
     * Mailing Lists feature module. When enabled, the admin sidebar
     * exposes the Mailing Lists area, the public subscribe endpoint
     * accepts new subscribers, and the SMTP provider abstraction
     * routes outbound transactional mail through the same pipeline
     * the mailing-list sends use. Requires `users`.
     */
    mailing_lists: { enabled: boolean; };
    /**
     * Shop ecommerce feature module. When enabled, the admin sidebar
     * exposes the Shop area (products, categories, collections, orders,
     * reviews, settings) and the public `/shop/*` storefront routes
     * activate. Requires `users`. Disabled by default.
     */
    shop: { enabled: boolean; };
    /**
     * Plugins system. When enabled, the admin sidebar exposes the Plugins
     * area (install / enable / configure external plugins) and the running
     * site loads enabled plugins' public widgets. Disabled by default.
     */
    plugins: { enabled: boolean; };
}

/** The keys that correspond to a `<x>_enabled` row in `site_settings`. */
export type SiteFeatureKey = keyof SiteFeatures;

// ─── Site Header / Footer item ───

/**
 * A single piece of content inside the header bar or a footer column.
 * The same shape powers both surfaces so the field-level editing UI
 * can be reused (the field set — image / text / link / button / spacer
 * — is the same regardless of where the item lives).
 */
export type SiteLayoutItemType = 'image' | 'image_link' | 'text' | 'text_link' | 'button' | 'menu' | 'gap' | 'flex_spacer';

export interface SiteLayoutItem {
    id: string;
    type: SiteLayoutItemType;
    text?: string;
    url?: string;
    imageUrl?: string;
    mediaId?: string;
    openInNewTab?: boolean;
    buttonColor?: string;
    /** Font for this item — a font `customId` from the Font manager. Empty
     *  inherits the header/footer default (or the site font). Only meaningful
     *  for text-rendering items (text / text_link / button / menu). */
    fontFamily?: string;
    fontSize?: string;
    /** CSS font-weight value: numeric strings ('100'..'900') or named
     *  keywords ('normal', 'bold'). Optional — falls through to the
     *  inherited site font weight when unset. */
    fontWeight?: string;
    textColor?: string;
    width?: string;
    alignment?: string;
    verticalAlignment?: string;
    margin?: string;
    padding?: string;
    order: number;
}

// ─── Site Footer ───

/** A single column inside a footer row. Columns flex-grow proportionally
 * to their `flex` value (default 1 — even split). */
export interface SiteFooterColumn {
    id: string;
    /** flex-grow factor. Defaults to 1 on the renderer if absent. */
    flex?: number;
    /** Inner item layout direction. */
    direction?: 'row' | 'column';
    /** Spacing between items in the column. e.g. "8px". */
    gap?: string;
    padding?: string;
    margin?: string;
    /** main-axis alignment of items inside the column (justify-content). */
    alignment?: 'start' | 'center' | 'end' | 'space-between' | 'space-around';
    /** cross-axis alignment of items (align-items). */
    verticalAlignment?: 'start' | 'center' | 'end' | 'stretch';
    items: SiteLayoutItem[];
}

/** A horizontal row in the footer. Rows stack vertically. */
export interface SiteFooterRow {
    id: string;
    /** When true, the row is constrained to the site's container width
     * via the configured gutter (matches main content alignment). */
    useGutter?: boolean;
    /** Spacing between columns in this row. e.g. "16px". */
    gap?: string;
    padding?: string;
    margin?: string;
    backgroundColor?: string;
    columns: SiteFooterColumn[];
}

export interface SiteFooterSettings {
    /** Master switch — when false, the footer is not rendered at all. */
    enabled: boolean;
    rows: SiteFooterRow[];
    /** Optional global background applied to the outer footer element. */
    backgroundColor?: string;
    /** Default text color for the whole footer. Individual items override it. */
    textColor?: string;
    /** Default font for the whole footer — a font `customId` from the Font
     *  manager. Individual items override it. */
    defaultFont?: string;
    padding?: string;
    margin?: string;
}

// ─── Site colors / swatches ───

/**
 * A named entry in the site's reusable color palette. Anywhere a color
 * value appears in the admin UI (block styles, page backgrounds, header
 * / footer settings, admin-appearance tokens), the user can either
 * enter a raw hex string or pick a swatch — picking a swatch stores the
 * reference `swatch:{id}` instead of the resolved hex, so updating the
 * swatch later cascades to every consumer.
 *
 *   id   — stable identifier. Defaults to a short random string;
 *          users can override with a custom slug (lowercase, digits,
 *          dash, underscore). Must be unique within the swatch list.
 *   hex  — concrete color value: a 3-, 6-, or 8-digit hex string. The
 *          8-digit form (`#rrggbbaa`) carries an alpha channel for
 *          translucent swatches; 3/6-digit are fully opaque.
 *   name — optional human-friendly label shown in pickers next to
 *          the swatch and ID (e.g. "Brand Red", "Background").
 */
export interface SiteSwatch {
    id: string;
    hex: string;
    name?: string;
}

// ─── Revision history ───

export type RevisionEntityType = 'post' | 'page';

export interface Revision {
    id: string;
    entityType: RevisionEntityType;
    entityId: string;
    version: number;
    snapshot: Record<string, unknown>;
    authorId: string | null;
    authorName?: string | null;
    summary: string | null;
    createdAt: string;
}
