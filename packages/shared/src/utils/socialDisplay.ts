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
