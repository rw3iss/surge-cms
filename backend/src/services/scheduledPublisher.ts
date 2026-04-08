/**
 * Scheduled publishing cron — publishes any posts or pages whose
 * status='scheduled' and publish_at has elapsed.
 */
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { cache, } from './cache';
import { cronRegistry, } from './cron';

const JOB_NAME = 'scheduled-publisher';
// Run every 5 minutes
const SCHEDULE = '*/5 * * * *';

async function publishScheduled(): Promise<void> {
    // Posts
    const postResult = await query(
        `UPDATE posts
         SET status = 'published', published_at = COALESCE(published_at, publish_at, NOW()), updated_at = NOW()
         WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= NOW()
         RETURNING id`,
    );
    if (postResult.rowCount && postResult.rowCount > 0) {
        logger.info(`Published ${postResult.rowCount} scheduled post(s)`,);
        await cache.invalidatePostCache();
    }

    // Pages
    const pageResult = await query(
        `UPDATE pages
         SET status = 'published', updated_at = NOW()
         WHERE status = 'scheduled' AND publish_at IS NOT NULL AND publish_at <= NOW()
         RETURNING id`,
    );
    if (pageResult.rowCount && pageResult.rowCount > 0) {
        logger.info(`Published ${pageResult.rowCount} scheduled page(s)`,);
        await cache.invalidatePageCache();
    }
}

export function initScheduledPublisher(): void {
    cronRegistry.register({
        name: JOB_NAME,
        schedule: SCHEDULE,
        description: 'Publishes posts and pages whose scheduled publish_at has elapsed',
        handler: publishScheduled,
    },);
}
