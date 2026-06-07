/** Role predicates shared by route manifests. Centralized so a future
 *  role addition (e.g. an editor tier) is a one-file change. */
export const isAdminRole = (role?: string,): boolean => role === 'admin' || role === 'sysadmin';
