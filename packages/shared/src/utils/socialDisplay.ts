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
} = {
    mediaDisplay: 'full',
    showTitle: true,
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

/** Resolve the display settings off a block's settings bag. */
export function resolveSocialDisplay(
    settings: { mediaDisplay?: unknown; showTitle?: unknown; } | null | undefined,
): { mediaDisplay: SocialMediaDisplay; showTitle: boolean; } {
    const raw = settings ?? {};
    const size = raw.mediaDisplay;
    return {
        mediaDisplay: SOCIAL_MEDIA_DISPLAYS.includes(size as SocialMediaDisplay,)
            ? (size as SocialMediaDisplay)
            : SOCIAL_DISPLAY_DEFAULTS.mediaDisplay,
        // Explicit `false` turns it off; anything else (including an absent
        // key on every pre-existing block) keeps the title.
        showTitle: raw.showTitle !== false,
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
