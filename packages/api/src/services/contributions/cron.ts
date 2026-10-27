/**
 * Automatic contributor payouts. Daily; a no-op unless contributor payouts are
 * enabled (Posts → Settings → Contributions), the schedule is not "off" and a
 * period has passed since the last run (`isPayoutDue`).
 */
import { cronRegistry, } from '../cron';
import { runScheduledPayouts, } from './index';

export function initContributorPayouts(): void {
    cronRegistry.register({
        name: 'contributor-payouts',
        schedule: '30 6 * * *',
        description: 'Pays contributors their available earnings on the configured schedule',
        handler: () => runScheduledPayouts(),
    },);
}
