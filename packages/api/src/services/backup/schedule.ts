/**
 * Automatic database backups.
 *
 * The design mirrors `mailSchedules`, for the same reasons: **the schedule owns
 * its own `nextRunAt` and ONE cron sweeps for what is due.** node-cron holds
 * tasks in memory, so registering a task per schedule would silently vanish on
 * restart and nobody would notice until a backup failed to happen — which, for
 * a backup, you discover at the worst possible moment. A cursor in the database
 * restores itself by construction and makes a missed window recoverable rather
 * than skipped.
 *
 * **Postgres computes the next run** (`generate_series` + `AT TIME ZONE`),
 * reused verbatim from `mailSchedules.computeNextRun`: 02:00 must stay 02:00
 * across a daylight-saving change, which an offset cannot express. Writing that
 * arithmetic twice is how the two would drift.
 *
 * **Catch-up policy: a daily backup that missed three days runs ONCE.** The
 * next run is always the first occurrence strictly after now, so an outage
 * costs one backup, not a burst of three.
 */
import type { BackupSettings, } from '@sitesurge/types';
import { computeNextRun, } from '../mailSchedules';
import * as settings from '../settings';
import { logger, } from '../../utils/logger';
import * as backup from '../backup';
import { pruneOldBackups, storeBackup, } from './destinations';

/**
 * Map the backup frequency onto the mail-schedule grammar.
 *
 * They are deliberately the same words; this exists so the reuse is explicit
 * rather than an accident of two enums happening to match today.
 */
function scheduleInput(cfg: BackupSettings, after?: Date,) {
    const s = cfg.schedule;
    return {
        frequency: s.frequency as 'daily' | 'weekly' | 'monthly',
        // The anchor date only fixes WHICH day of the week/month recurs; for a
        // daily schedule it is irrelevant. Today is the natural anchor for a
        // schedule the operator just enabled.
        startDate: new Date().toISOString().slice(0, 10,),
        timeOfDay: s.timeOfDay || '02:00',
        timezone: s.timezone || 'UTC',
        ...(after ? { after, } : {}),
    };
}

/**
 * Recompute `nextRunAt` from the current settings and persist it.
 *
 * Called whenever the schedule changes, so enabling or retiming a backup takes
 * effect immediately rather than after the next tick.
 */
export async function rescheduleBackups(
    cfg?: BackupSettings,
    after?: Date,
): Promise<string | null> {
    const current = cfg ?? await settings.getBackupSettings();

    if (!current.schedule?.enabled) {
        await persist({ ...current, nextRunAt: null, },);
        return null;
    }
    // A schedule pointing at "download only" would produce a dump and throw it
    // away. Treat it as unschedulable rather than running pointlessly every
    // night — and say so, since the operator asked for backups.
    if (current.destination === 'download') {
        logger.warn('Automatic backups are enabled but the destination is "download only" — nothing would be stored.',);
        await persist({ ...current, nextRunAt: null, },);
        return null;
    }

    const next = await computeNextRun(scheduleInput(current, after,),);
    const iso = next ? next.toISOString() : null;
    await persist({ ...current, nextRunAt: iso, },);
    return iso;
}

/** Write settings back without an audit actor (this is a system write). */
async function persist(next: BackupSettings,): Promise<void> {
    // A system write, not an operator action — the audit row records it with
    // no actor rather than attributing it to whoever last touched settings.
    await settings.setBackupSettings(next, {} as never,);
}

/**
 * Run the automatic backup if one is due.
 *
 * Returns true when a backup actually ran. Never throws: a failure is recorded
 * on the settings row and the next run is still scheduled, because a backup
 * that fails once must not disable backups forever.
 */
export async function runDueBackup(now = new Date(),): Promise<boolean> {
    let cfg: BackupSettings;
    try {
        cfg = await settings.getBackupSettings();
    } catch (e) {
        logger.error('Backup schedule: could not read settings', { error: (e as Error).message, },);
        return false;
    }

    if (!cfg.schedule?.enabled || !cfg.nextRunAt) return false;
    if (new Date(cfg.nextRunAt,).getTime() > now.getTime()) return false;

    // Advance the cursor BEFORE running. A backup can take minutes; leaving the
    // old cursor in place would let the next tick start a second one on top of
    // it. Same reasoning as the mail sweeper's claim-then-send.
    await rescheduleBackups(cfg, now,);

    logger.info('Automatic backup starting', { destination: cfg.destination, },);
    let meta: Awaited<ReturnType<typeof backup.createBackup>> | null = null;
    try {
        meta = await backup.createBackup('custom',);
        const stored = await storeBackup(cfg, meta.path, meta.filename,);
        const pruned = await pruneOldBackups(cfg,);

        const fresh = await settings.getBackupSettings();
        await persist({
            ...fresh,
            lastRunAt: now.toISOString(),
            lastStatus: 'ok',
            lastError: null,
            lastLocation: stored.location,
        },);
        logger.info('Automatic backup complete', {
            location: stored.location, bytes: stored.bytes, pruned,
        },);
        return true;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e,);
        logger.error('Automatic backup failed', { error: msg, },);
        try {
            const fresh = await settings.getBackupSettings();
            await persist({
                ...fresh,
                lastRunAt: now.toISOString(),
                lastStatus: 'failed',
                lastError: msg.slice(0, 500,),
            },);
        } catch { /* recording the failure must not raise a second one */ }
        return false;
    } finally {
        // The temp dump goes whether or not the upload worked — a failing
        // destination must not fill the server's disk one nightly dump at a
        // time.
        if (meta) await backup.cleanup(meta,).catch(() => {},);
    }
}
