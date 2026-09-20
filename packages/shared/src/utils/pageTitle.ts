/**
 * The document title, composed ONCE for every renderer.
 *
 * Three surfaces have to produce byte-identical titles:
 *
 *   - the SSR head (`api/services/ssr/metaBuilder.ts`) — what a crawler reads
 *     in the initial HTML
 *   - the SPA head (`cms/components/common/seo/SeoHead.tsx`) — what replaces it
 *     a frame later, and what a JavaScript-rendering crawler actually indexes
 *   - anything else that needs to show the same string
 *
 * They previously disagreed, and the disagreement was invisible: SSR emitted
 * `"{Page Title} | {Site}"` while the client emitted `"{Site} - {Page Title}"`,
 * so a homepage whose author-written meta title was "Conservative News for
 * Philadelphia & the Tri-State Area" was indexed as **"Surge Media - Home"**.
 * Every SEO tool that reads only the raw HTML reported it as correct, and every
 * tool that reads only the rendered DOM reported the other one. Nothing flagged
 * the mismatch, because each half was internally consistent.
 *
 * Hence one function, in the package both sides already import.
 *
 * FORMAT: `{Page Title} | {Site Name}` — the page's own words first. Search
 * engines truncate around 60 characters and weight leading words most, so a
 * brand prefix spends the most valuable part of every listing repeating one
 * string and pushes the distinguishing words toward the cut-off. Brand-as-suffix
 * is the near-universal convention for exactly that reason.
 */

/** Separator between the page title and the site name. */
const SEP = ' | ';

/**
 * True when a title already carries the site name, in either order and with
 * either separator.
 *
 * An author who types a complete meta title ("Contact Surge Media — Philadelphia
 * News Tips | Surge Media") must get it back verbatim; appending the brand a
 * second time is worse than not appending it at all.
 */
function carriesSiteName(pageTitle: string, siteName: string,): boolean {
    return (
        pageTitle.startsWith(`${siteName} -`,) ||
        pageTitle.startsWith(`${siteName} |`,) ||
        pageTitle.startsWith(`${siteName}:`,) ||
        pageTitle.endsWith(`| ${siteName}`,) ||
        pageTitle.endsWith(`- ${siteName}`,) ||
        pageTitle.endsWith(`— ${siteName}`,)
    );
}

/**
 * Compose the final `<title>` for a page.
 *
 * `pageTitle` should already be the resolved preference — a page's `metaTitle`
 * when it has one, else its display title. Resolving that is the CALLER's job
 * (only the caller knows the entity), but both callers must pass the same
 * thing; see `resolvePageTitle` below for the shared precedence rule.
 */
export function buildDocumentTitle(
    pageTitle: string | null | undefined,
    siteName: string,
): string {
    const page = (pageTitle ?? '').trim();
    const site = (siteName ?? '').trim();
    if (!page) return site;
    if (!site) return page;
    if (page === site) return site;
    if (carriesSiteName(page, site,)) return page;
    return `${page}${SEP}${site}`;
}

/**
 * The precedence for an entity's title: an explicit `metaTitle` wins over the
 * display title.
 *
 * Trivial, but it was written out separately on each surface, and the homepage
 * skipped it entirely — passing the literal string `"Home"` and discarding the
 * site's configured meta title. Sharing the rule is what stops one surface
 * quietly using a different field from another.
 */
export function resolvePageTitle(
    entity: { metaTitle?: string | null; title?: string | null; } | null | undefined,
    fallback = '',
): string {
    const meta = (entity?.metaTitle ?? '').trim();
    if (meta) return meta;
    const title = (entity?.title ?? '').trim();
    if (title) return title;
    return fallback;
}
