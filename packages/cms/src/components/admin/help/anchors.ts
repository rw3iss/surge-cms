/**
 * Anchor ids shared by the SDK reference (`/admin/help/sdk/reference`) and the
 * API reference (`/admin/help/api`), so each page can deep-link into the other.
 */

export const SDK_REFERENCE_PATH = '/admin/help/sdk/reference';
export const API_REFERENCE_PATH = '/admin/help/api';

/** `GET /api/v1/posts/:id` → `get-/api/v1/posts/:id` (a valid, readable id). */
export function apiAnchor(route: string,): string {
    const space = route.indexOf(' ',);
    return `${route.slice(0, space,).toLowerCase()}-${route.slice(space + 1,)}`;
}

/** Link to one route in the API reference. */
export function apiRouteHref(route: string,): string {
    return `${API_REFERENCE_PATH}#${apiAnchor(route,)}`;
}

/** `cms.posts.list` is already a valid id — the anchor IS the call. */
export function sdkMethodHref(call: string,): string {
    return `${SDK_REFERENCE_PATH}#${call}`;
}
