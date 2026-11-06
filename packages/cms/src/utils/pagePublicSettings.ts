/**
 * Whether a page save changes what the PUBLIC settings carry about pages:
 * `systemPages` (key → slug of the PUBLISHED page holding it) and
 * `membership.openPaths` (open-without-a-subscription page paths).
 *
 * The editor reloads the settings after such a save, so previews, the
 * "Use as page" holder note and the public routes in this tab follow it.
 * A slug change only matters when the page holds a key or is an open page.
 */
interface PageLike {
    slug?: string | null;
    status?: string | null;
    systemPage?: string | null;
    openAccess?: boolean | null;
}

export function publicSettingsChanged(prev: PageLike | null, next: PageLike,): boolean {
    const wasKey = prev?.systemPage || null;
    const isKey = next.systemPage || null;
    if (wasKey !== isKey) return true;
    if ((prev?.openAccess === true) !== (next.openAccess === true)) return true;
    const listed = !!isKey || next.openAccess === true;
    if (!listed) return false;
    if ((prev?.status ?? null) !== (next.status ?? null)) return true;
    return (prev?.slug ?? null) !== (next.slug ?? null);
}
