/**
 * Multi-process mode.
 *
 * A Node process runs JavaScript on ONE thread, so however busy it gets it can
 * never use a second core. Measured on the 2-core production box: the single
 * process saturated at ~1.2 cores under a 1,000-user browsing load while the
 * other core sat idle, and the kernel dropped 68k connections because the
 * process could not accept them fast enough.
 *
 * `CLUSTER_WORKERS` forks N copies that share the listening socket. The default
 * is 1 — exactly the previous behaviour — so Docker images and npm consumers
 * are unaffected until they opt in.
 *
 * WHAT THE PRIMARY KEEPS TO ITSELF
 *
 * Forking multiplies every side effect, so anything that must happen once is
 * gated to `role: 'primary'` (see `startServer` in lib.ts):
 *
 *   - migrations + core-entity seeding  (would otherwise race N ways)
 *   - cron scheduling                   (N workers = N sends of the same email)
 *   - resuming interrupted mail jobs
 *
 * The primary runs a worker's workload too, rather than idling — on a 2-core
 * box, dedicating one process to supervision would waste half the machine.
 *
 * WHAT IS SHARED VIA REDIS
 *
 * Two pieces of state used to live in one process's memory and would silently
 * fragment across workers. Both now go through Redis:
 *
 *   - the API rate limiter (`middleware/rateLimitStore.ts`) — a per-process
 *     counter would multiply the effective limit by the worker count
 *   - admin presence (`services/adminChannel/`) — two staff on two workers
 *     would not see each other, defeating the point of the feature
 *
 * These are the same changes a multi-NODE deployment needs, so this also
 * unblocks running more than one box later.
 */
import cluster from 'node:cluster';
import { logger, } from './utils/logger';

/** How long to wait before replacing a worker that died, so a crash-loop
 *  cannot spin the CPU forking. */
const RESPAWN_DELAY_MS = 1000;

/**
 * Fork `workers - 1` children and return the role this process should play.
 *
 * Returns `'single'` when clustering is off, so callers can treat "no cluster"
 * and "the primary" identically where it does not matter, and distinguish them
 * where it does (logging, mainly).
 */
export function initCluster(workers: number,): 'single' | 'primary' | 'worker' {
    if (workers <= 1) return 'single';
    if (!cluster.isPrimary) return 'worker';

    // The primary serves traffic as well, so it forks one FEWER child than the
    // requested worker count.
    const children = workers - 1;
    logger.info(`Cluster mode: ${workers} processes (primary + ${children} forked)`,);

    for (let i = 0; i < children; i++) cluster.fork();

    cluster.on('exit', (worker, code, signal,) => {
        // A deliberate shutdown sends SIGTERM; replacing the worker then would
        // fight the shutdown and keep the service alive after `systemctl stop`.
        if (shuttingDown) return;
        logger.error(
            `Cluster worker ${worker.process.pid} exited (code=${code} signal=${signal}) — respawning`,
        );
        setTimeout(() => { if (!shuttingDown) cluster.fork(); }, RESPAWN_DELAY_MS,).unref();
    },);

    return 'primary';
}

let shuttingDown = false;

/**
 * Stop replacing workers, and pass the signal down.
 *
 * Without this the primary's `exit` handler treats a shutdown as a crash and
 * forks a replacement for every worker that exits, so the service never stops.
 */
export function stopCluster(signal: NodeJS.Signals = 'SIGTERM',): void {
    shuttingDown = true;
    if (!cluster.isPrimary) return;
    for (const w of Object.values(cluster.workers ?? {},)) {
        try { w?.process.kill(signal,); } catch { /* already gone */ }
    }
}

/** True when this process should run once-only work (crons, migrations). */
export function isPrimaryProcess(): boolean {
    return cluster.isPrimary;
}

/** Short label for logs, so a line can be traced to the process that wrote it. */
export function processLabel(): string {
    return cluster.isPrimary ? 'primary' : `worker:${cluster.worker?.id ?? '?'}`;
}
