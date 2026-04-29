import type { AppearanceSettings, } from '@rw/shared';
import { colorCssValue, } from '../services/colorResolver';

/**
 * Translate an `AppearanceSettings` snapshot into the inline-style
 * object that drives the `--site-*` CSS custom properties.
 *
 * Used by both `Layout.tsx` (public site) and `AdminLayout.tsx`
 * (admin chrome) so any colors/typography configured under
 * `Settings → Appearance` apply uniformly. Keeping it here avoids
 * three drifted copies of the same mapping.
 *
 * `mode: 'admin'` skips a few appearance fields that would conflict
 * with admin chrome — the admin shell needs to keep its own dark
 * sidebar and neutral background even if the public site is
 * configured with a high-contrast theme. Color tokens
 * (`--site-primary`, `--site-link`) still flow through so accent
 * styles in admin (Save buttons, focus rings, the active sidebar
 * row) match the configured brand.
 *
 * Color values may be raw hex OR `swatch:{id}` references — every
 * color is run through `colorCssValue()` so swatch refs land as
 * `var(--swatch-{id}, fallback)` and stay reactive to palette edits.
 */
export function appearanceCssVars(
    a: AppearanceSettings | null | undefined,
    mode: 'public' | 'admin' = 'public',
): Record<string, string> {
    const s: Record<string, string> = {};
    if (!a) return s;

    const setColor = (key: string, value: string | undefined,) => {
        if (!value) return;
        const css = colorCssValue(value, '',);
        if (css) s[key] = css;
    };

    // Tokens always flowed through (color & typography variables).
    setColor('--site-primary', a.primaryColor,);
    setColor('--site-link', a.linkColor,);
    setColor('--site-heading', a.headingColor,);
    setColor('--site-border', a.borderColor,);
    if (a.headingFontFamily) s['--site-heading-font'] = a.headingFontFamily;
    if (a.headingWeight) s['--site-heading-weight'] = a.headingWeight;
    if (a.borderRadius) s['--site-radius'] = a.borderRadius;
    if (a.gutterWidth) s['--site-gutter'] = a.gutterWidth;
    if (a.maxContentWidth) s['--site-max-width'] = a.maxContentWidth;
    if (a.blockPadding) s['--site-block-padding'] = a.blockPadding;

    // Background / text / line-height: flow through both as raw inline
    // styles AND as variables on the public site. The admin shell has
    // its own controlled chrome (sidebar, header, neutral page bg) and
    // would look broken if these were applied to its root, so we skip
    // the inline-style versions in admin mode but still expose the
    // variables so individual admin components can opt in.
    if (a.backgroundColor) {
        const css = colorCssValue(a.backgroundColor, '',);
        if (css) {
            s['--site-bg'] = css;
            if (mode === 'public') s['background-color'] = css;
        }
    }
    if (a.textColor) {
        const css = colorCssValue(a.textColor, '',);
        if (css) {
            s['--site-text'] = css;
            if (mode === 'public') s['color'] = css;
        }
    }
    if (a.fontFamily) {
        s['--site-font'] = a.fontFamily;
        if (mode === 'public') s['font-family'] = a.fontFamily;
    }
    if (a.lineHeight) {
        s['--site-line-height'] = a.lineHeight;
        if (mode === 'public') s['line-height'] = a.lineHeight;
    }

    return s;
}
