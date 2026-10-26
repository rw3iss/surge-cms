/**
 * SYSTEM PAGES — the registry of built-in public screens a CMS page may stand in
 * for ("Use as page" in the page editor).
 *
 * A page whose `systemPage` is one of these keys renders IN PLACE of the built-in
 * screen at that route (the URL stays the route's); with no such page the
 * built-in screen renders as before. At most one page holds a key (partial-unique
 * `pages.system_page`); saving another page with the same key takes it over.
 *
 * ADD AN ENTRY HERE whenever core or a feature module adds a built-in public
 * LANDING page (a route with no params that the operator might want to design
 * themselves), then wrap its route in `<SystemPageRoute pageKey="…">` in the SPA.
 * `feature` hides the option (and the override) while that feature is off.
 *
 * Deliberately NOT listed — functional screens a CMS page cannot replace without
 * breaking the flow: /login, /join, /verify, /invite/:token, /forgot-password,
 * /reset-password, /profile, /shop/cart, /shop/checkout, /shop/orders/:number,
 * and every detail route with a param (/posts/:slug, /events/:slug, …).
 * /donate and /contact are already ordinary CMS pages (by slug).
 */
export interface SystemPageDef {
    /** Stored in `pages.system_page`. Never rename a key — it is data. */
    key: string;
    /** Shown in the page editor's "Use as page" dropdown. */
    label: string;
    /** The public route the page replaces. */
    path: string;
    /** Feature module that owns the route; omitted = core (always offered). */
    feature?: string;
    description: string;
}

export const SYSTEM_PAGES: readonly SystemPageDef[] = [
    { key: 'home', label: 'Homepage', path: '/', description: 'The site root.', },
    { key: 'posts', label: 'Posts', path: '/posts', feature: 'posts', description: 'The post listing.', },
    { key: 'search', label: 'Search', path: '/search', description: 'Site search results.', },
    { key: 'subscribe', label: 'Subscribe', path: '/subscribe', feature: 'users', description: 'The membership levels page.', },
    { key: 'shop', label: 'Shop', path: '/shop', feature: 'shop', description: 'The storefront landing page (product pages, cart and checkout stay built-in).', },
    { key: 'events', label: 'Events', path: '/events', feature: 'events', description: 'The events calendar.', },
    { key: 'gallery', label: 'Gallery', path: '/gallery', feature: 'gallery', description: 'The gallery landing page (at its configured base URL).', },
    { key: 'forum', label: 'Forum', path: '/forum', feature: 'forum', description: 'The forum index.', },
    { key: 'wiki', label: 'Wiki', path: '/wiki', feature: 'wiki', description: 'The wiki index.', },
    { key: 'mail', label: 'Mail archive', path: '/mail', feature: 'mailing_lists', description: 'The public archive of sent emails.', },
];

export const SYSTEM_PAGE_KEYS = SYSTEM_PAGES.map((p,) => p.key,);

export function getSystemPage(key: string | null | undefined,): SystemPageDef | undefined {
    return key ? SYSTEM_PAGES.find((p,) => p.key === key,) : undefined;
}

export function isSystemPageKey(key: unknown,): key is string {
    return typeof key === 'string' && SYSTEM_PAGE_KEYS.includes(key,);
}

/** The options to offer: core + those whose feature is on. */
export function availableSystemPages(featureOn: (feature: string,) => boolean,): SystemPageDef[] {
    return SYSTEM_PAGES.filter((p,) => !p.feature || featureOn(p.feature,),);
}

/** The public path a page is served at: its system route, else `/<slug>`. */
export function pagePublicPath(page: { slug: string; systemPage?: string | null; },): string {
    return getSystemPage(page.systemPage,)?.path ?? `/${page.slug}`;
}
