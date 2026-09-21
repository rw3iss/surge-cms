/**
 * The automatic-backup scheduler.
 *
 * What is worth pinning here is the POLICY, not the timezone arithmetic —
 * that is Postgres's job, reused from mailSchedules and tested there. These
 * cover the decisions that fail SILENTLY:
 *
 *   - a backup that never fires because nothing rescheduled it
 *   - two backups running on top of each other because the cursor moved late
 *   - a failure that permanently disables future backups
 *   - a schedule pointed at "download only", dumping into the void
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const getBackupSettings = vi.fn();
const setBackupSettings = vi.fn();
const computeNextRun = vi.fn();
const createBackup = vi.fn();
const cleanup = vi.fn();
const storeBackup = vi.fn();
const pruneOldBackups = vi.fn();

vi.mock('../settings', () => ({
    getBackupSettings: (...a: unknown[]) => getBackupSettings(...a,),
    setBackupSettings: (...a: unknown[]) => setBackupSettings(...a,),
}),);
vi.mock('../mailSchedules', () => ({ computeNextRun: (...a: unknown[]) => computeNextRun(...a,), }),);
vi.mock('../backup', () => ({
    createBackup: (...a: unknown[]) => createBackup(...a,),
    cleanup: (...a: unknown[]) => cleanup(...a,),
}),);
vi.mock('./destinations', () => ({
    storeBackup: (...a: unknown[]) => storeBackup(...a,),
    pruneOldBackups: (...a: unknown[]) => pruneOldBackups(...a,),
}),);
vi.mock('../../utils/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), },
}),);

import { rescheduleBackups, runDueBackup, } from './schedule';

const NOW = new Date('2026-09-21T03:00:00.000Z',);
const cfg = (over: Record<string, unknown> = {},) => ({
    destination: 's3',
    local: { path: '', },
    s3: { bucket: 'b', },
    retentionDays: 30,
    schedule: { enabled: true, frequency: 'daily', timeOfDay: '02:00', timezone: 'UTC', },
    nextRunAt: '2026-09-21T02:00:00.000Z',
    ...over,
} as never);

/** What the last settings write persisted. */
const written = () => setBackupSettings.mock.calls.at(-1,)?.[0] as Record<string, unknown>;

beforeEach(() => {
    getBackupSettings.mockReset(); setBackupSettings.mockReset();
    computeNextRun.mockReset(); createBackup.mockReset(); cleanup.mockReset();
    storeBackup.mockReset(); pruneOldBackups.mockReset();
    computeNextRun.mockResolvedValue(new Date('2026-09-22T02:00:00.000Z',),);
    createBackup.mockResolvedValue({ path: '/tmp/x.dump', filename: 'sitesurge-backup-x.dump', dir: '/tmp', },);
    storeBackup.mockResolvedValue({ location: 'b/x.dump', bytes: 100, },);
    pruneOldBackups.mockResolvedValue(0,);
    setBackupSettings.mockResolvedValue(undefined,);
    cleanup.mockResolvedValue(undefined,);
},);

describe('rescheduleBackups', () => {
    it('computes and stores the next run when enabled', async () => {
        const next = await rescheduleBackups(cfg(),);
        expect(next,).toBe('2026-09-22T02:00:00.000Z',);
        expect(written().nextRunAt,).toBe('2026-09-22T02:00:00.000Z',);
    },);

    it('CLEARS the cursor when disabled, so it stops being due', async () => {
        // Leaving a stale nextRunAt would fire one more backup after the
        // operator turned the feature off.
        const next = await rescheduleBackups(cfg({ schedule: { enabled: false, frequency: 'daily', timeOfDay: '02:00', timezone: 'UTC', }, },),);
        expect(next,).toBeNull();
        expect(written().nextRunAt,).toBeNull();
        expect(computeNextRun,).not.toHaveBeenCalled();
    },);

    it('refuses to schedule against "download only"', async () => {
        // A dump produced and immediately discarded every night is worse than
        // no schedule — it looks like it is working.
        const next = await rescheduleBackups(cfg({ destination: 'download', },),);
        expect(next,).toBeNull();
        expect(written().nextRunAt,).toBeNull();
    },);

    it('passes the configured frequency, time and zone through', async () => {
        await rescheduleBackups(cfg({
            schedule: { enabled: true, frequency: 'weekly', timeOfDay: '23:30', timezone: 'America/New_York', },
        },),);
        const arg = computeNextRun.mock.calls[0][0];
        expect(arg.frequency,).toBe('weekly',);
        expect(arg.timeOfDay,).toBe('23:30',);
        // A wall-clock zone, not an offset — 23:30 must stay 23:30 across DST.
        expect(arg.timezone,).toBe('America/New_York',);
    },);
},);

describe('runDueBackup', () => {
    it('runs, stores and prunes when due', async () => {
        getBackupSettings.mockResolvedValue(cfg(),);
        expect(await runDueBackup(NOW,),).toBe(true,);
        expect(createBackup,).toHaveBeenCalledWith('custom',);
        expect(storeBackup,).toHaveBeenCalled();
        expect(pruneOldBackups,).toHaveBeenCalled();
    },);

    it('does nothing when the next run is still in the future', async () => {
        getBackupSettings.mockResolvedValue(cfg({ nextRunAt: '2026-09-22T02:00:00.000Z', },),);
        expect(await runDueBackup(NOW,),).toBe(false,);
        expect(createBackup,).not.toHaveBeenCalled();
    },);

    it('does nothing when disabled, even with a stale cursor', async () => {
        getBackupSettings.mockResolvedValue(cfg({
            schedule: { enabled: false, frequency: 'daily', timeOfDay: '02:00', timezone: 'UTC', },
        },),);
        expect(await runDueBackup(NOW,),).toBe(false,);
        expect(createBackup,).not.toHaveBeenCalled();
    },);

    it('advances the cursor BEFORE dumping', async () => {
        // A dump can take minutes. Leaving the old cursor would let the next
        // minute's tick start a second dump on top of the first.
        const order: string[] = [];
        computeNextRun.mockImplementation(async () => { order.push('reschedule',); return new Date('2026-09-22T02:00:00.000Z',); },);
        createBackup.mockImplementation(async () => { order.push('dump',); return { path: '/tmp/x', filename: 'f.dump', dir: '/tmp', }; },);
        getBackupSettings.mockResolvedValue(cfg(),);

        await runDueBackup(NOW,);
        expect(order,).toEqual(['reschedule', 'dump',],);
    },);

    it('records a FAILURE without disabling future backups', async () => {
        // A backup that fails once must not stop all later ones — the cursor
        // was already advanced, so tomorrow still runs.
        storeBackup.mockRejectedValue(new Error('bucket unreachable',),);
        getBackupSettings.mockResolvedValue(cfg(),);

        expect(await runDueBackup(NOW,),).toBe(false,);
        expect(written().lastStatus,).toBe('failed',);
        expect(String(written().lastError,),).toMatch(/unreachable/,);
        expect(computeNextRun,).toHaveBeenCalled();
    },);

    it('removes the temp dump even when storing fails', async () => {
        // Otherwise a broken destination fills the disk one nightly dump at a
        // time.
        storeBackup.mockRejectedValue(new Error('nope',),);
        getBackupSettings.mockResolvedValue(cfg(),);
        await runDueBackup(NOW,);
        expect(cleanup,).toHaveBeenCalled();
    },);

    it('removes the temp dump on success too', async () => {
        getBackupSettings.mockResolvedValue(cfg(),);
        await runDueBackup(NOW,);
        expect(cleanup,).toHaveBeenCalled();
    },);

    it('records success with the stored location', async () => {
        getBackupSettings.mockResolvedValue(cfg(),);
        await runDueBackup(NOW,);
        expect(written().lastStatus,).toBe('ok',);
        expect(written().lastLocation,).toBe('b/x.dump',);
        expect(written().lastError,).toBeNull();
    },);

    it('never throws when settings cannot be read', async () => {
        getBackupSettings.mockRejectedValue(new Error('db down',),);
        await expect(runDueBackup(NOW,),).resolves.toBe(false,);
    },);
},);
