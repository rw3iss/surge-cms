/**
 * The `{{site.*}}` variable bag — ONE shape, for every surface that resolves
 * templates.
 *
 * The three runtimes had drifted badly:
 *
 *   - the **client** handed the template engine the raw public settings
 *     object, so `{{site.siteName}}` worked and `{{site.name}}` did not
 *   - **mail** built `{ name, url }` by hand, so `{{site.name}}` worked and
 *     `{{site.siteName}}` did not
 *   - **SSR** never defined `site` at all, so every `{{site.*}}` resolved empty
 *
 * The same template therefore produced three different results depending on
 * where it was rendered, and none of them offered the logo.
 *
 * `buildSiteVariables` is the single definition. It emits the canonical short
 * names AND keeps the raw settings keys the client already exposed, so
 * templates written against the old client behaviour keep working.
 */

/** The subset of public site settings the template bag is built from. */
export interface SiteVariableSource {
    siteName?: string;
    siteTagline?: string;
    siteDescription?: string;
    logo?: string;
    favicon?: string;
    contactEmail?: string;
    [key: string]: unknown;
}

/** The resolved `{{site.*}}` bag. */
export interface SiteVariables {
    /** Site name. `{{site.name}}` */
    name: string;
    /** Canonical site URL, no trailing slash. `{{site.url}}` */
    url: string;
    /**
     * Absolute URL of the configured logo (Settings → Site Branding).
     * Empty string when none is set, so `{{site.logo}}` in an `<img src>`
     * degrades to a broken-free empty attribute rather than the literal text.
     */
    logo: string;
    /** Absolute URL of the configured favicon. */
    favicon: string;
    /** Optional tagline. */
    tagline: string;
    /** Site description / meta description. */
    description: string;
    /** Public contact address, when configured. */
    email: string;
    /** Raw settings keys, preserved for backward compatibility (see above). */
    [key: string]: unknown;
}

/**
 * Make a possibly-relative asset path absolute.
 *
 * A logo uploaded to local storage is stored as `/uploads/x.png`. That is fine
 * in a page, and useless in an email or an RSS item — the client has no origin
 * to resolve it against. Since the same bag feeds both, it is absolutised once
 * here rather than at each use site.
 */
function absoluteUrl(value: string | undefined, siteUrl: string,): string {
    const v = (value ?? '').trim();
    if (!v) return '';
    if (/^(https?:)?\/\//i.test(v,) || v.startsWith('data:',)) return v;
    const base = siteUrl.replace(/\/$/, '',);
    return `${base}${v.startsWith('/',) ? '' : '/'}${v}`;
}

/**
 * Build the `{{site.*}}` bag from public settings.
 *
 * `siteUrl` is passed separately because it is not a settings row — it comes
 * from the app config on the server and from `window.location.origin` on the
 * client.
 */
export function buildSiteVariables(
    settings: SiteVariableSource | null | undefined,
    siteUrl: string,
): SiteVariables {
    const s = settings ?? {};
    const url = (siteUrl || '').replace(/\/$/, '',);
    return {
        // Raw keys first so the canonical names below win on any collision —
        // `name` must be the site name, not whatever a settings row called it.
        ...s,
        name: (s.siteName ?? '').trim(),
        url,
        logo: absoluteUrl(s.logo, url,),
        favicon: absoluteUrl(s.favicon, url,),
        tagline: (s.siteTagline ?? '').trim(),
        description: (s.siteDescription ?? '').trim(),
        email: (s.contactEmail ?? '').trim(),
    };
}
