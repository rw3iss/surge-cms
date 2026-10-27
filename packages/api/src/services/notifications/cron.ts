/** Daily sweep of in-app notifications (cleared after 7 days, all after the retention period). */
import { cronRegistry, } from '../cron';
import { sweep, } from './inApp';

export function initNotificationSweep(): void {
    cronRegistry.register({
        name: 'notifications-sweep',
        schedule: '45 4 * * *',
        description: 'Deletes cleared and expired in-app notifications',
        handler: async () => { await sweep(); },
    },);
}
