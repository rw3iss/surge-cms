/**
 * Wire DTOs for the /dev module (developer tools — cron registry).
 * Validation schemas live in `packages/api/src/routes/dev.ts`.
 */

/**
 * Status snapshot for one registered cron job. ISO strings for all
 * timestamps. Defined here as the wire shape mirroring the API
 * package's in-process cron registry.
 */
export interface CronJobStatus {
    name: string;
    schedule: string;
    description: string;
    lastRun: string | null;
    lastResult: 'success' | 'error' | null;
    lastError: string | null;
    nextRun: string | null;
    isRunning: boolean;
    registeredAt: string;
}

/** GET /api/v1/dev/crons — all registered jobs. */
export type DevCronListResponse = CronJobStatus[];

/** GET /api/v1/dev/crons/:name — params. */
export interface DevCronGetParams {
    name: string;
}

/** GET /api/v1/dev/crons/:name — one job, or null when unknown. */
export type DevCronGetResponse = CronJobStatus | null;
