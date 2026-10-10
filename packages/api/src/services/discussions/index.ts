/**
 * The discussion engine (hidden `discussions` feature) — comments on any
 * registered target, reactions, reports, moderation, activity counters.
 * Comments (posts/events) and the Forum (threads) register their targets.
 * Plan: docs/plans/2026-10-10-comments-and-forum.md
 */
import { logger, } from '../../utils/logger';
import { cronRegistry, } from '../cron';
import { isFeatureEnabledServer, } from '../settings';
import { reconcile as reconcileActivity, } from './activity';
import { allTargets, } from './targets';
// Every feature's targets register on import (one line per feature).
import './registerTargets';

export * as comments from './comments';
export * as moderation from './moderation';
export * as activity from './activity';
export * from './targets';
export * from './events';
export * from './viewer';
export { getSettings, updateSettings, } from './settings';

/** Nightly: recompute activity + reply counters and every target's own counters. */
export function initDiscussionsCron(): void {
    cronRegistry.register({
        name: 'discussions-reconcile',
        schedule: '47 3 * * *',
        description: 'Recompute comment/forum activity and reply counters from the rows',
        handler: async () => {
            if (!(await isFeatureEnabledServer('discussions',).catch(() => false))) return;
            try {
                await reconcileActivity();
                for (const t of allTargets()) {
                    if (await isFeatureEnabledServer(t.feature,).catch(() => false)) await t.reconcile?.();
                }
            } catch (err) {
                logger.error('Discussions reconcile failed', { error: err, },);
            }
        },
    },);
}
