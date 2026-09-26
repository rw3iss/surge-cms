/**
 * How a social post's media is presented — shared by the web renderer, the
 * admin preview and the email renderer so all three agree.
 *
 * The block previously had no say in this: a YouTube post ALWAYS rendered as a
 * full embedded player, and every other provider always rendered as a card.
 * That is the right default, but it is not always what the operator wants — a
 * "latest video" tout in a sidebar or an entity template wants a thumbnail, not
 * a 16:9 player that dictates the column's height.
 */

/** Presentation size for a post's media. */
export type SocialMediaDisplay = 'full' | 'medium' | 'small';

export const SOCIAL_MEDIA_DISPLAYS: readonly SocialMediaDisplay[] = ['full', 'medium', 'small',];

/**
 * Defaults preserve the previous behaviour exactly: a full player (or
 * full-width card) with the post's title shown.
 *
 * `showTitle` defaults TRUE — the title is how a reader knows what the video
 * is before deciding to play it, and every existing block was already
 * rendering the caption.
 */
export const SOCIAL_DISPLAY_DEFAULTS: {
    mediaDisplay: SocialMediaDisplay;
    showTitle: boolean;
    showAuthor: boolean;
    showDate: boolean;
} = {
    mediaDisplay: 'full',
    showTitle: true,
    // Author and date default OFF: a post card is the video, and the channel
    // name under every item is noise when the whole email comes from that
    // channel. Both were previously rendered unconditionally.
    showAuthor: false,
    showDate: false,
};

/**
 * Max thumbnail width per size, for the renderers that need a number.
 *
 * `full` is `null` — "no cap, fill the container" — rather than a large number,
 * so the full size keeps behaving like a fluid element instead of becoming a
 * very wide fixed one.
 */
export const SOCIAL_THUMB_WIDTH: Record<SocialMediaDisplay, number | null> = {
    full: null,
    medium: 320,
    small: 160,
};

/** What a social post renders around its media. */
export interface SocialDisplay {
    mediaDisplay: SocialMediaDisplay;
    showTitle: boolean;
    showAuthor: boolean;
    showDate: boolean;
}

/** Resolve the display settings off a block's settings bag. */
export function resolveSocialDisplay(
    settings:
        | { mediaDisplay?: unknown; showTitle?: unknown; showAuthor?: unknown; showDate?: unknown; }
        | null
        | undefined,
): SocialDisplay {
    const raw = settings ?? {};
    const size = raw.mediaDisplay;
    return {
        mediaDisplay: SOCIAL_MEDIA_DISPLAYS.includes(size as SocialMediaDisplay,) ?
            (size as SocialMediaDisplay) :
            SOCIAL_DISPLAY_DEFAULTS.mediaDisplay,
        // Explicit `false` turns it off; anything else (including an absent
        // key on every pre-existing block) keeps the title.
        showTitle: raw.showTitle !== false,
        // Opt-IN, so an absent key on an existing block means off.
        showAuthor: raw.showAuthor === true,
        showDate: raw.showDate === true,
    };
}

/**
 * Should this post render as an interactive PLAYER rather than a thumbnail?
 *
 * Only at `full`, and only for providers with a usable embed. At `medium` /
 * `small` a player is the wrong element — it would still load an iframe, still
 * claim a 16:9 box, and still be unusable at 160px.
 *
 * Email always gets `false`: every major client strips `<iframe>`.
 */
export function usesPlayer(
    platform: string,
    mediaDisplay: SocialMediaDisplay,
    opts: { email?: boolean; } = {},
): boolean {
    if (opts.email) return false;
    if (mediaDisplay !== 'full') return false;
    return platform === 'youtube';
}

/**
 * Default number of posts an auto-feed social block shows.
 *
 * 6 preserves what the renderer has always used; the admin panel used to
 * display `1` for an unset block instead, which made the setting impossible to
 * change through the UI — the field already showed the value the operator
 * wanted, so typing it fired no change event, nothing was written, and the
 * renderer went on using 6.
 */
export const SOCIAL_DEFAULT_COUNT = 6;

/**
 * How many posts a social block should show.
 *
 * ONE resolution, shared by the renderer and the admin panel, because those two
 * disagreeing is exactly the bug above. `limit` is the legacy key and still
 * wins where present; `count` is what the panel writes.
 */
export function resolveSocialCount(
    settings: { limit?: unknown; count?: unknown; items?: unknown; } | null | undefined,
): number {
    const raw = settings ?? {};
    const explicit = Number(raw.limit ?? raw.count,);
    if (Number.isFinite(explicit,) && explicit > 0) return Math.min(50, Math.floor(explicit,),);
    // A pinned block with slots implies its own count.
    const pinned = Array.isArray(raw.items,) ? raw.items.length : 0;
    if (pinned > 0) return Math.min(50, pinned,);
    return SOCIAL_DEFAULT_COUNT;
}

/**
 * Is this social block showing an AUTO-FEED (recent posts) rather than pinned
 * slots?
 *
 * Shared so the web renderer, the admin panel and the email expansion agree.
 * The rule has a legacy arm: `usePinned` is explicit now, but blocks predating
 * the flag imply pinning from having filled slots — without that, an existing
 * hand-curated block would silently start auto-feeding.
 */
export function isSocialAutoFeed(
    settings: { usePinned?: unknown; items?: unknown; } | null | undefined,
): boolean {
    const raw = settings ?? {};
    if (raw.usePinned !== undefined) return !raw.usePinned;
    const filled = Array.isArray(raw.items,) ?
        (raw.items as Array<{ postId?: unknown; postUrl?: unknown; }>)
            .filter((i,) => i && (i.postId || i.postUrl)).length :
        0;
    return filled === 0;
}

/**
 * Navigation affordance for the Horizontal Row layout.
 *
 * The row is a scroll container, so on a touchpad or phone it is already
 * navigable by dragging — this adds a visible, clickable control for everyone
 * else, which is also the only affordance that tells a visitor there is more
 * content off the edge.
 *
 * `none` is the default so existing row blocks are unchanged.
 */
export type SocialNavigation =
    /** No control; the row scrolls by drag/wheel only. */
    | 'none'
    /** One dot per page, under the row. */
    | 'dots'
    /** A left/right pair under the row, where the dots would be. */
    | 'bottom-arrows'
    /** A left/right pair overlaid on the row's own left and right edges. */
    | 'side-arrows';

export const SOCIAL_NAVIGATIONS: readonly SocialNavigation[] = [
    'none',
    'dots',
    'bottom-arrows',
    'side-arrows',
];

/** Admin-facing labels, so the panel and any docs cannot drift. */
export const SOCIAL_NAVIGATION_LABELS: Record<SocialNavigation, string> = {
    'none': 'None',
    'dots': 'Dots',
    'bottom-arrows': 'Bottom arrows',
    'side-arrows': 'Side arrows',
};

/**
 * Resolve a block's navigation setting.
 *
 * Only the Row layout scrolls, so navigation is meaningless anywhere else and
 * resolves to `none` regardless of what is stored — a block switched from Row
 * to Grid must not keep painting arrows over a static grid.
 */
export function resolveSocialNavigation(
    settings: { navigation?: unknown; layout?: unknown; } | null | undefined,
): SocialNavigation {
    const raw = settings ?? {};
    if ((raw.layout ?? 'grid') !== 'row') return 'none';
    const v = String(raw.navigation ?? '',);
    return (SOCIAL_NAVIGATIONS as readonly string[]).includes(v,) ?
        (v as SocialNavigation) :
        'none';
}

/**
 * Padding applied to the navigation control, so dots/arrows can be nudged
 * clear of the cards.
 *
 * For an arrow PAIR the same value applies to both, mirrored — the operator is
 * positioning one control that happens to have two halves, and asking them to
 * keep two values in sync to keep it symmetrical would be a trap.
 */
export function resolveSocialNavPadding(
    settings: { navPadding?: unknown; } | null | undefined,
): string | undefined {
    const v = String(settings?.navPadding ?? '',).trim();
    return v || undefined;
}

/**
 * Corner radius for each POST, distinct from the block's own Border Radius.
 *
 * The two are different boxes and an operator wants them separately: the block
 * radius rounds the panel the posts sit in, this rounds each video. Expressing
 * one with the other is impossible — rounding the block does nothing to the
 * square iframe inside it, and rounding every post does not round the panel.
 *
 * This is a block SETTING rather than a style-panel property because it
 * describes the block's content — like Item width and Item gap beside it —
 * rather than the block's own box, which is what the style panel governs.
 *
 * Empty means "no rounding", NOT "inherit the block radius": a block with
 * rounded corners and square videos inside it is an ordinary design, and
 * inheriting would make it unexpressible.
 */
/**
 * CONVENIENCE ALIAS for `resolveSocialItemBox(settings).borderRadius`.
 *
 * Not a second source of truth — it delegates, and every renderer reads the
 * whole box instead. Kept because it is exported from a published package and
 * removing it would break consumers; do not add logic here.
 */
export function resolveSocialItemRadius(
    settings: { itemBorderRadius?: unknown; } | null | undefined,
): string | undefined {
    return resolveSocialItemBox(settings,).borderRadius;
}

/** The per-post box settings, as CSS values. */
export interface SocialItemBox {
    /** Cap on each post's width. */
    width?: string;
    /** Fixed height for each post. */
    height?: string;
    /** Space between posts. */
    gap?: string;
    /** Corner radius on each post. */
    borderRadius?: string;
}

/**
 * Every "Item …" setting in one place, so the web renderer and the email
 * renderer read them identically.
 *
 * These were previously picked out of the settings bag ad hoc by the web
 * renderer and ignored entirely by the email renderer, which is how an operator
 * could size and round their posts on the site and get none of it in the inbox.
 * One resolver is what stops the two surfaces disagreeing about what the
 * operator asked for.
 *
 * Empty strings become `undefined` so a caller can use `??` without an empty
 * value winning and emitting `width:`.
 */
export function resolveSocialItemBox(
    settings:
        | { itemWidth?: unknown; itemHeight?: unknown; itemGap?: unknown; itemBorderRadius?: unknown; }
        | null
        | undefined,
): SocialItemBox {
    const raw = settings ?? {};
    const val = (v: unknown,) => {
        const s = String(v ?? '',).trim();
        return s || undefined;
    };
    return {
        width: val(raw.itemWidth,),
        height: val(raw.itemHeight,),
        gap: val(raw.itemGap,),
        borderRadius: val(raw.itemBorderRadius,),
    };
}

/** Horizontal alignment of a post's title. */
export type SocialTitleAlign = 'left' | 'center' | 'right';

/**
 * The block's "Title alignment" setting. Unset — every block saved before the
 * setting existed — is CENTRE, matching the default placement of the post
 * itself, so a title sits under the picture it belongs to.
 */
export function resolveSocialTitleAlign(
    settings: { titleAlign?: unknown; } | null | undefined,
): SocialTitleAlign {
    const v = settings?.titleAlign;
    return v === 'left' || v === 'right' ? v : 'center';
}
