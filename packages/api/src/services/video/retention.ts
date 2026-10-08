/**
 * Daily video housekeeping (cluster primary, via the cron registry):
 *  - delete kept originals whose retention has passed (`source_key` → NULL —
 *    a later re-encode then says "re-upload"), and
 *  - expire abandoned direct-upload sessions, when the uploads module offers
 *    `sweepExpiredUploadSessions`.
 * No-op while the `video` feature is off.
 */
import * as repo from '../../repositories/video.repo';
import { logger, } from '../../utils/logger';
import { cronRegistry, } from '../cron';
import { isFeatureEnabledServer, } from '../settings';
import { isObjectStore, resolveStorageProvider, } from '../storage';

/** Delete expired originals. Returns how many were removed. */
export async function sweepExpiredOriginals(): Promise<number> {
    const store = await resolveStorageProvider();
    if (!isObjectStore(store,)) return 0;
    let removed = 0;
    for (;;) {
        const batch = await repo.listExpiredOriginals(50,);
        if (batch.length === 0) break;
        for (const v of batch) {
            try {
                await store.deleteObject(v.sourceKey!,);
                await repo.updateVideo(v.mediaId, { sourceKey: null, originalExpiresAt: null, },);
                removed++;
            } catch (e) {
                logger.warn('Video: could not delete an expired original', { mediaId: v.mediaId, error: (e as Error).message, },);
                return removed; // don't spin on a row that keeps failing
            }
        }
        if (batch.length < 50) break;
    }
    return removed;
}

export function initVideoCrons(): void {
    cronRegistry.register({
        name: 'video-retention',
        schedule: '17 3 * * *',
        description: 'Delete kept video originals past retention; expire abandoned uploads',
        handler: async () => {
            try {
                if (!(await isFeatureEnabledServer('video',))) return;
                const n = await sweepExpiredOriginals();
                if (n > 0) logger.info(`Video: deleted ${n} expired original(s)`,);
                try {
                    const uploads = await import('./uploads.js') as { sweepExpiredUploadSessions?: () => Promise<unknown>; };
                    if (typeof uploads.sweepExpiredUploadSessions === 'function') await uploads.sweepExpiredUploadSessions();
                } catch (e) {
                    logger.debug?.('Video: upload-session sweep unavailable', { error: (e as Error).message, },);
                }
            } catch (err) {
                logger.error('Video retention sweep failed', { error: err, },);
            }
        },
    },);
}
