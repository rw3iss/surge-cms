/**
 * Build the rendering context that the mail renderer needs from
 * `site_settings`: site name + URL plus the swatch palette (id → hex).
 * Both the preview endpoint and the send route call this — same query,
 * same shape, so it lives once.
 */
import type { SiteBreakpoint, TypographyDefaults, } from '@sitesurge/types';
import { resolveTypography, } from '@sitesurge/types';
import { query, } from '../../db';
import { config, } from '../../config';

/** Fallback breakpoint (matches the appearance default) for installs whose
 *  `site_appearance` row predates the breakpoints feature. */
const DEFAULT_BREAKPOINTS: SiteBreakpoint[] = [{ id: 'mobile', name: 'Mobile', maxWidth: '768', },];

export interface MailRenderContext {
    siteName: string;
    siteUrl: string;
    palette: Record<string, string>;
    /** Named responsive breakpoints (from Settings → Appearance) — the email
     *  renderer emits an `@media` rule per breakpoint override on a block. */
    breakpoints: SiteBreakpoint[];
    /** Rich-text heading/paragraph rhythm (Settings → Appearance → Typography). */
    typography: TypographyDefaults;
}

export async function loadMailRenderContext(): Promise<MailRenderContext> {
    const res = await query<{ key: string; value: unknown; }>(
        `SELECT key, value FROM site_settings`,
    );
    const settings: Record<string, unknown> = {};
    for (const row of res.rows) settings[row.key] = row.value;

    const palette: Record<string, string> = {};
    const rawSwatches = settings.site_colors;
    if (Array.isArray(rawSwatches,)) {
        for (const s of rawSwatches as Array<{ id?: unknown; hex?: unknown; }>) {
            if (typeof s.id === 'string' && typeof s.hex === 'string') {
                palette[s.id] = s.hex;
            }
        }
    }

    const appearance = settings.site_appearance as
        ({ breakpoints?: SiteBreakpoint[]; } & Partial<TypographyDefaults>) | undefined;
    const breakpoints = Array.isArray(appearance?.breakpoints,) && appearance!.breakpoints!.length
        ? appearance!.breakpoints!
        : DEFAULT_BREAKPOINTS;

    // `{{site.url}}` — prefer an explicit `site_url` setting, else fall back to
    // the configured public base URL (same one the working unsubscribe links
    // use). Without this, `site_url` is usually blank → `{{site.url}}` rendered
    // empty and `<a href="{{site.url}}">` links were dead.
    const siteUrl = (
        (settings.site_url as string | undefined)
        || (config.frontendUrl as string | undefined)
        || ''
    ).replace(/\/+$/, '',);

    return {
        siteName: (settings.site_name as string) ?? 'Site',
        siteUrl,
        palette,
        breakpoints,
        // Resolved here rather than at each call site, so the send path and the
        // PREVIEW path cannot end up with different values — the two disagreeing
        // is exactly the bug this was added for.
        typography: resolveTypography(appearance,),
    };
}
