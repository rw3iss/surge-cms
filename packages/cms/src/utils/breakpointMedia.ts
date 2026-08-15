// `breakpointMediaCondition` now lives in `@sitesurge/types` so the email
// renderer (backend) and the public/admin CSS builders share ONE definition.
// Re-exported here so existing `./breakpointMedia` imports keep working.
export { breakpointMediaCondition, } from '@sitesurge/types';
