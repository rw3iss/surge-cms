/**
 * Registers the event reminder sweep. `runReminderSweep` existed but nothing
 * scheduled it, so "Remind attendees N hours before" never sent anything.
 *
 * Every 15 minutes: the sweep is idempotent through the
 * `event_notifications_sent` ledger, so each reminder still goes out once.
 * Registration is unconditional; the handler no-ops when the events feature
 * is off (its tables may not exist).
 */
import { cronRegistry, } from '../cron';
import { logger, } from '../../utils/logger';
import { isFeatureEnabledServer, } from '../settings';
import { runReminderSweep, } from './notifications';

export function initEventReminderCron(): void {
    cronRegistry.register({
        name: 'event-reminders',
        schedule: '*/15 * * * *',
        description: 'Send event reminders that are due',
        handler: async () => {
            if (!(await isFeatureEnabledServer('events',))) return;
            try {
                await runReminderSweep();
            } catch (err) {
                logger.error('Event reminder sweep failed', { error: err, },);
            }
        },
    },);
}
