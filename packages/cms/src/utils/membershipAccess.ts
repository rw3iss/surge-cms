/**
 * Which routes a RESTRICTED member (subscription-required mode) may still use.
 * Pure (no DOM / Solid) so it is unit-tested; SubscriptionWall re-exports it.
 */

/** Routes a restricted member may always use. A trailing `/` means "this prefix". */
export const ALWAYS_OPEN = ['/subscribe', '/profile', '/login', '/join', '/verify', '/invite/', '/forgot-password', '/reset-password', '/u/', '/lists/',];

/** True when `path` is open: an "Open without a subscription" page, or an always-open route (and its sub-paths). */
export function isOpenPath(path: string, openPaths: string[],): boolean {
    const p = path.replace(/\/+$/, '',) || '/';
    if (openPaths.includes(p,)) return true;
    return ALWAYS_OPEN.some((o,) => (o.endsWith('/',) ? p.startsWith(o,) : p === o || p.startsWith(`${o}/`,)));
}
