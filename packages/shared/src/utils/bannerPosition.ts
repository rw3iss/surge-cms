/**
 * A post banner's image anchor → the CSS position value.
 *
 * Shared by the public post page and the editor preview so the two cannot
 * disagree. The presets anchor vertically (top / middle / bottom); `custom`
 * takes any background-position the author typed (`center 30%`, `left 20px
 * bottom`, …) — applied as `background-position` on hero banners and
 * `object-position` on image banners, which accept the same syntax.
 */
export type BannerImagePosition = 'start' | 'center' | 'end' | 'custom';

export const BANNER_POSITION_CUSTOM_MAX = 100;

/**
 * Is this safe to drop into a style value? Position syntax needs letters,
 * numbers, units, `%`, spaces and the odd `calc()`; anything that could end the
 * declaration or open markup (`;` `{` `}` `<` `>` quotes, `\`) is refused.
 */
export function isValidBannerPositionCustom(v: string,): boolean {
    const s = v.trim();
    return s.length > 0 && s.length <= BANNER_POSITION_CUSTOM_MAX && /^[a-zA-Z0-9%.\-+*/(),\s]+$/.test(s,);
}

export function resolveBannerPosition(
    position: string | null | undefined,
    custom?: string | null,
): string {
    switch (position) {
        case 'start':
            return 'center top';
        case 'end':
            return 'center bottom';
        case 'custom':
            // A bad or empty custom value falls back to the default anchor.
            return custom && isValidBannerPositionCustom(custom,) ? custom.trim() : 'center center';
        default:
            return 'center center';
    }
}
