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
    order: number;
}

/**
 * Query spec for a 'posts' carousel item. Mirrors the subset of the
 * `post_list` block settings relevant to a carousel (no brevity /
 * field toggles — a carousel slide just uses the post's banner image
 * and title). Specific posts render first, then query results.
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
