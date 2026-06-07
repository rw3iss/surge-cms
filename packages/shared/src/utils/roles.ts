/** Role predicates shared by the API route manifests and the CMS UI.
 *  Centralized so a future role addition (e.g. an editor tier) is a
 *  one-file change rather than a hunt for inline `role === 'admin'`
 *  literals. */
export function isAdminRole(role?: string,): boolean {
    return role === 'admin' || role === 'sysadmin';
}
