/**
 * Registers the scheduled-send sweeper.
 *
 * ONE cron job for every schedule, not one job per schedule. node-cron holds
 * tasks in memory, so per-schedule tasks would have to be registered on
 * create/update/delete AND rebuilt on boot — and any path that forgot would
 * leave a schedule that exists in the database but never fires. A single
 * sweeper asking "what is due?" has no such state to get wrong, and restores
 * itself after a restart by construction.
 *
 * Every minute, because a schedule's resolution is a wall-clock minute. The
 * query behind it is an indexed lookup against a partial index over due,
 * enabled rows — it costs nothing when there is nothing to do.
 *
 * Registration is unconditional and cheap; the handler no-ops when the
 * mailing_lists feature is off. `cronRegistry` already skips scheduling
 * entirely when CRON_ENABLED=false (a warm standby), and crons run on the
 * cluster PRIMARY only, so exactly one process sweeps.
 */
import { cronRegistry, } from '../cron';
import { logger, } from '../../utils/logger';
import { isFeatureEnabledServer, } from '../settings';
import { runDueSchedules, } from '../mailSchedules';

export function initMailScheduleCron(): void {
    cronRegistry.register({
        name: 'mail-schedules',
        schedule: '* * * * *',
        description: 'Send any mailing-list schedules that are due',
        handler: async () => {
            if (!(await isFeatureEnabledServer('mailing_lists',))) return;
            try {
                await runDueSchedules();
            } catch (err) {
                // Never rethrow: an unhandled failure here would mark the cron
                // job errored and, worse, could take down the tick for every
                // later sweep. The per-schedule handler already records its own
                // failures on the row.
                logger.error('Mail schedule sweep failed', { error: err, },);
            }
        },
    },);
}
