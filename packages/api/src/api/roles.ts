/** Role predicates shared by route manifests. The implementation lives in
 *  @sitesurge/types so the CMS UI and the API agree on what "admin" means;
 *  this module re-exports it to keep the existing `../api/roles` import
 *  paths in the route files stable. */
export { isAdminRole, } from '@sitesurge/types';
