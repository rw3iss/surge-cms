/**
 * Batches new-merchandise announcements.
 *
 * Hourly rather than on publish: a burst of publishing, or a supplier catalogue
 * sync, should produce ONE email rather than one per product. The window also
 * gives an operator time to un-publish something they published by mistake
 * before it reaches anyone's inbox. The sweep is a no-op unless auto-send is on
 * AND something is pending, so it costs a single indexed query otherwise.
 */
import { cronRegistry, } from '../cron';
import { runAutoAnnounce, } from './merchandiseAnnounce';

const JOB_NAME = 'merchandise-announce';
const SCHEDULE = '0 * * * *';

export function initMerchandiseAnnounce(): void {
    cronRegistry.register({
        name: JOB_NAME,
        schedule: SCHEDULE,
        description: 'Batches newly published products into one new-merchandise announcement',
        handler: runAutoAnnounce,
    },);
}
