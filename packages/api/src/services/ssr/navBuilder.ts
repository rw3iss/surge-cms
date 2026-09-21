/**
 * Server-rendered site navigation.
 *
 * **The problem this solves.** The header and footer are rendered entirely by
 * the SPA, so the SSR HTML — the only version a crawler without JS execution
 * sees — contained links to `/` and the current page and nothing else. Every
 * other page on the site was reachable only from the sitemap. Google treats a
 * sitemap as a suggestion and an internal link as a vote, which is exactly what
 * Search Console reported: fourteen URLs "Discovered — currently not indexed".
 * They were found, and then judged not worth fetching, because nothing linked
 * to them.
 *
 * **Why it mirrors the SPA's links rather than inventing its own.** Serving
 * crawlers a different link graph from the one users get is cloaking, however
 * benign the intent. So this walks the SAME header/footer settings the SPA
 * renders from, and emits the same destinations — only the markup is reduced.
 *
 * The fragment is emitted on every SSR route, before and after the page body,
 * as `<nav>` landmarks. The SPA's `render()` replaces `#root` wholesale on
 * mount, so it exists for at most one frame.
 */

import type { SiteFooterSettings, SiteHeaderSettings, SiteLayoutItem, } from '@sitesurge/types';
import type { SiteHeaderItem, } from '@sitesurge/types';
import { escapeHtml, } from './blocks/_util';

/** One navigation destination. */
export interface NavLink {
    label: string;
    url: string;
}

/**
 * Is this a URL worth putting in front of a crawler?
 *
 * `#`-only and `javascript:` hrefs are in-page behaviour, not destinations.
 * `mailto:`/`tel:` are real links but lead nowhere crawlable, and emitting a
 * bare address into server-rendered HTML is a gift to scrapers.
 */
function isCrawlable(url: string,): boolean {
    const u = url.trim();
    if (u === '' || u === '#') return false;
    return !/^(javascript|mailto|tel|sms|data):/i.test(u,);
}

/**
 * Pull `{label, url}` out of one header item, recursing into a menu's children.
 *
 * A `menu` item is a dropdown: the parent may or may not be a link itself, but
 * its children always are, and those children are typically the ONLY link to
 * several pages. Missing them was most of the orphaning.
 */
function collectHeaderItem(item: SiteHeaderItem, out: NavLink[],): void {
    if (item.url && isCrawlable(item.url,)) {
        // An image_link has no text; its alt text is not in this type, so fall
        // back to the destination. A link with no anchor text still counts as a
        // crawl path, which is the point.
        const label = (item.text || '').trim() || item.url;
        out.push({ label, url: item.url, },);
    }
    for (const child of item.children ?? []) collectHeaderItem(child, out,);
}

/** Same, for a footer item — which nests through `group` items' `items`. */
function collectLayoutItem(item: SiteLayoutItem, out: NavLink[],): void {
    if (item.url && isCrawlable(item.url,)) {
        const label = (item.text || '').trim() || (item.altText || '').trim() || item.url;
        out.push({ label, url: item.url, },);
    }
    for (const child of item.items ?? []) collectLayoutItem(child, out,);
}

/**
 * Drop repeats, keeping the first (and so best-labelled) occurrence.
 *
 * The same destination almost always appears in both the header and the footer.
 * Emitting it twice is not an error, but a crawler reads repeated identical
 * anchors as boilerplate, and it makes the fragment harder to read when
 * debugging.
 */
function dedupe(links: NavLink[],): NavLink[] {
    const seen = new Set<string>();
    const out: NavLink[] = [];
    for (const l of links) {
        const key = l.url.replace(/\/+$/, '',) || '/';
        if (seen.has(key,)) continue;
        seen.add(key,);
        out.push(l,);
    }
    return out;
}

/** Every link in the configured header, in order. */
export function headerLinks(header: SiteHeaderSettings | null | undefined,): NavLink[] {
    const out: NavLink[] = [];
    const items = [...(header?.items ?? [])].sort((a, b,) => (a.order ?? 0) - (b.order ?? 0));
    for (const item of items) collectHeaderItem(item, out,);
    return dedupe(out,);
}

/** Every link in the configured footer, in row → column → item order. */
export function footerLinks(footer: SiteFooterSettings | null | undefined,): NavLink[] {
    // `enabled: false` means the footer is not rendered at all. Emitting its
    // links anyway would put addresses in front of a crawler that no visitor
    // can reach — the cloaking this module exists to avoid.
    if (!footer || footer.enabled === false) return [];
    const out: NavLink[] = [];
    for (const row of footer.rows ?? []) {
        for (const col of row.columns ?? []) {
            for (const item of col.items ?? []) collectLayoutItem(item, out,);
        }
    }
    return dedupe(out,);
}

/** Render a list of links as a `<nav>` landmark, or '' when there are none. */
export function renderNav(links: NavLink[], className: string, label: string,): string {
    if (links.length === 0) return '';
    const items = links
        .map(l => `    <li><a href="${escapeHtml(l.url,)}">${escapeHtml(l.label,)}</a></li>`)
        .join('\n',);
    return [
        `<nav class="${escapeHtml(className,)}" aria-label="${escapeHtml(label,)}">`,
        '  <ul>',
        items,
        '  </ul>',
        '</nav>',
    ].join('\n',);
}

/**
 * The full pair of nav fragments for one SSR render.
 *
 * Returned separately rather than concatenated so the caller can wrap the page
 * body between them — the document order a crawler reads is header, content,
 * footer, and putting both navs above the content would bury the article.
 */
export function buildSiteNav(
    header: SiteHeaderSettings | null | undefined,
    footer: SiteFooterSettings | null | undefined,
): { header: string; footer: string; } {
    const top = headerLinks(header,);
    // A destination already linked from the header gains nothing from a second
    // anchor lower down, so the footer nav carries only what is unique to it.
    const topKeys = new Set(top.map(l => l.url.replace(/\/+$/, '',) || '/'),);
    const bottom = footerLinks(footer,).filter(l => !topKeys.has(l.url.replace(/\/+$/, '',) || '/'),);

    return {
        header: renderNav(top, 'ssr-nav ssr-nav--header', 'Main',),
        footer: renderNav(bottom, 'ssr-nav ssr-nav--footer', 'Footer',),
    };
}
