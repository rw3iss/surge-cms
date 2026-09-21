/**
 * Registers the automatic-backup sweeper.
 *
 * ONE cron asking "is a backup due?", not a task per schedule — see
 * `services/backup/schedule.ts` for why the cursor lives in the database.
 *
 * Every minute, because the schedule's resolution is a wall-clock minute. The
 * check is a settings read (cached) and a date comparison, so it costs nothing
 * when there is nothing to do.
 *
 * Registration is unconditional; the handler no-ops when automatic backups are
 * off. `cronRegistry` skips scheduling entirely when CRON_ENABLED=false, and
 * crons run on the cluster PRIMARY only, so exactly one process sweeps — which
 * matters more here than for mail: two processes dumping the same database at
 * once would double the load and race on the same object key.
 */
import { cronRegistry, } from '../cron';
import { logger, } from '../../utils/logger';
import { runDueBackup, } from './schedule';

export function initBackupCron(): void {
    cronRegistry.register({
        name: 'auto-backup',
        schedule: '* * * * *',
        description: 'Run the scheduled database backup when one is due',
        handler: async () => {
            try {
                await runDueBackup();
            } catch (err) {
                // Never rethrow: an unhandled failure would mark the cron
                // errored and could take down later ticks. runDueBackup
                // already records its own failures on the settings row.
                logger.error('Backup sweep failed', { error: err, },);
            }
        },
    },);
}
