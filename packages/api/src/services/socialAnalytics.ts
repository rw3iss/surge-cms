/**
 * Social analytics — barrel over services/social/analytics/ (collectors,
 * runner, read side). Plan: docs/plans/2026-11-04-social-analytics-research.md.
 */
export { collectorStatuses, overview, posts, postSeries, series, } from './social/analytics/read';
export { listRuns, runCollection, SOCIAL_ANALYTICS_CRON, } from './social/analytics/runner';
export { listCollectors, } from './social/analytics/registry';
export { summarize, summaryDigest, } from './social/analytics/summary';
export { getSettings, updateSettings, } from './social/analytics/settings';
export {
    deleteDigest, generateDigest, getDigest, listDigests, SOCIAL_ANALYTICS_DIGEST_CRON, sweepRetention,
} from './social/analytics/digests';
export { renderEmailFor, sendDigestEmail, } from './social/analytics/digestDelivery';
export { audience, } from './social/analytics/audience';
