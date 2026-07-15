export interface HeroCarouselSettings {
    items: HeroItem[];
    options: HeroCarouselOptions;
}

export interface HeroItem {
    id: string;
    /**
     * Discriminates the item source. Absent = 'media' (all items saved
     * before posts-carousel support). A 'posts' item holds a post query
     * (`posts`) instead of media; at render time it expands into ONE
     * slide per resolved post.
     */
    type?: 'media' | 'posts';
    // ─── Media item (type='media') ───
    mediaId?: string;
    mediaUrl?: string;
    mediaThumbnailUrl?: string;
    mediaType?: 'image' | 'video';
    objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
    autoplay?: boolean;
    // ─── Posts item (type='posts') ───
    /** Post query spec; each resolved post becomes its own slide. */
    posts?: HeroPostsConfig;
    // ─── Shared slide overlay ───
    header?: HeroTextConfig;
    subheader?: HeroTextConfig;
    action?: HeroActionConfig;
    /** Resolved post metadata to render on a posts-derived slide
     *  (excerpt / date(s) / tags), gated by the item's show-field flags. */
    postMeta?: HeroPostMeta;
    order: number;
}

/** Post fields rendered under the title on a posts-carousel slide. Only
 *  the fields enabled via HeroPostsConfig are populated. */
export interface HeroPostMeta {
    author?: string;
    excerpt?: string;
    /** ISO date string (published/created). */
    dateCreated?: string;
    /** ISO date string (last updated). */
    dateUpdated?: string;
    tags?: string[];
}

/**
 * Query spec for a 'posts' carousel item. Mirrors the subset of the
 * `post_list` block settings relevant to a carousel. Specific posts
 * render first, then query results; each resolved post becomes a slide
 * whose backdrop is the post's banner image and whose overlay shows the
 * title plus any enabled show-fields (excerpt / dates / tags).
 */
export interface HeroPostsConfig {
    /** Hand-picked post IDs, rendered first, in order. */
    pinnedPostIds?: string[];
    /** Whether the dynamic query runs. Default true. */
    queryEnabled?: boolean;
    /** Max query results. Default 5. */
    count?: number;
    /** Show posts older than this many days. */
    afterDaysAgo?: number;
    /** Show posts newer than this many days ago. */
    beforeDaysAgo?: number;
    /** Free-text search across title + body. */
    query?: string;
    /** When true (default), render a single "no posts" slide if the
     *  item resolves to zero posts; when false, render nothing. */
    showEmptyMessage?: boolean;
    // ─── Show fields on each slide (all default off — title only) ───
    showAuthor?: boolean;
    showExcerpt?: boolean;
    showDateCreated?: boolean;
    showDateUpdated?: boolean;
    showTags?: boolean;
}

export interface HeroTextConfig {
    text: string;
    size: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    color: string;
}

export type HeroButtonSize = 'small' | 'normal' | 'large';

export interface HeroActionConfig {
    label: string;
    url: string;
    openInNewTab: boolean;
    size?: HeroButtonSize;
}

export interface HeroCarouselOptions {
    autoScroll: boolean;
    autoScrollInterval: number;
    repeat: boolean;
    customHeight: boolean;
    height: string;
    applyGutter?: boolean;
}
