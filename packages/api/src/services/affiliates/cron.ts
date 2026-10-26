/**
 * Automatic affiliate payouts. Daily; a no-op unless the `affiliates` feature
 * is on, the schedule (Shop → Settings → Affiliate program) is not "off", and
 * a period has passed since the last run (`isPayoutDue`).
 */
import { cronRegistry, } from '../cron';
import { runScheduledPayouts, } from './payouts';

export function initAffiliatePayouts(): void {
    cronRegistry.register({
        name: 'affiliate-payouts',
        schedule: '15 6 * * *',
        description: 'Pays affiliates their available commission on the configured schedule',
        handler: () => runScheduledPayouts(),
    },);
}
