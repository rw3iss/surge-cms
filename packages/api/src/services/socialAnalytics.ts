/**
 * Social analytics — barrel over services/social/analytics/ (collectors,
 * runner, read side). Plan: docs/plans/2026-11-04-social-analytics-research.md.
 */
export { collectorStatuses, overview, posts, postSeries, series, } from './social/analytics/read';
export { listRuns, runCollection, SOCIAL_ANALYTICS_CRON, } from './social/analytics/runner';
export { listCollectors, } from './social/analytics/registry';
export { summarize, summaryDigest, } from './social/analytics/summary';
