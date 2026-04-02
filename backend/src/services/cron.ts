import cron, { ScheduledTask, } from 'node-cron';
import { CronExpressionParser, } from 'cron-parser';
import { logger, } from '../utils/logger';

export interface CronJobOptions {
    name: string;
    schedule: string;
    description: string;
    handler: () => Promise<void>;
}

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

interface RegisteredJob {
    options: CronJobOptions;
    task: ScheduledTask | null;
    lastRun: Date | null;
    lastResult: 'success' | 'error' | null;
    lastError: string | null;
    isRunning: boolean;
    registeredAt: Date;
}

class CronRegistry {
    private jobs = new Map<string, RegisteredJob>();

    register(options: CronJobOptions,): void {
        if (this.jobs.has(options.name,)) {
            logger.warn(`Cron job "${options.name}" already registered, skipping duplicate`,);
            return;
        }

        if (!cron.validate(options.schedule,)) {
            logger.error(`Invalid cron schedule for "${options.name}": ${options.schedule}`,);
            return;
        }

        this.jobs.set(options.name, {
            options,
            task: null,
            lastRun: null,
            lastResult: null,
            lastError: null,
            isRunning: false,
            registeredAt: new Date(),
        },);

        logger.info(`Cron job registered: "${options.name}" (${options.schedule})`,);
    }

    startAll(): void {
        for (const [name, job,] of this.jobs) {
            if (job.task) continue;
            this.scheduleJob(name, job,);
        }
    }

    /** Unregister and stop a single cron job by name. */
    unregister(name: string,): boolean {
        const job = this.jobs.get(name,);
        if (!job) return false;

        if (job.task) {
            job.task.stop();
        }

        this.jobs.delete(name,);
        logger.info(`Cron job unregistered: "${name}"`,);
        return true;
    }

    /** Register and immediately start a single cron job (for dynamic registration after startAll). */
    registerAndStart(options: CronJobOptions,): void {
        this.register(options,);
        const job = this.jobs.get(options.name,);
        if (job && !job.task) {
            this.scheduleJob(options.name, job,);
        }
    }

    private scheduleJob(name: string, job: RegisteredJob,): void {
        job.task = cron.schedule(job.options.schedule, async () => {
            if (job.isRunning) {
                logger.warn(`Cron job "${name}" still running, skipping this tick`,);
                return;
            }

            job.isRunning = true;
            job.lastRun = new Date();
            logger.info(`Cron job "${name}" started`,);

            try {
                await job.options.handler();
                job.lastResult = 'success';
                job.lastError = null;
                logger.info(`Cron job "${name}" completed successfully`,);
            } catch (error) {
                job.lastResult = 'error';
                job.lastError = error instanceof Error ? error.message : String(error);
                logger.error(`Cron job "${name}" failed`, { error, },);
            } finally {
                job.isRunning = false;
            }
        },);

        logger.info(`Cron job "${name}" scheduled`,);
    }

    stopAll(): void {
        for (const [name, job,] of this.jobs) {
            if (job.task) {
                job.task.stop();
                job.task = null;
                logger.info(`Cron job "${name}" stopped`,);
            }
        }
    }

    private getNextRun(schedule: string,): string | null {
        try {
            const interval = CronExpressionParser.parse(schedule,);
            return interval.next().toISOString();
        } catch {
            return null;
        }
    }

    list(): CronJobStatus[] {
        return Array.from(this.jobs.values(),).map((job,) => ({
            name: job.options.name,
            schedule: job.options.schedule,
            description: job.options.description,
            lastRun: job.lastRun?.toISOString() ?? null,
            lastResult: job.lastResult,
            lastError: job.lastError,
            nextRun: this.getNextRun(job.options.schedule,),
            isRunning: job.isRunning,
            registeredAt: job.registeredAt.toISOString(),
        }),);
    }

    getJob(name: string,): CronJobStatus | undefined {
        const job = this.jobs.get(name,);
        if (!job) return undefined;

        return {
            name: job.options.name,
            schedule: job.options.schedule,
            description: job.options.description,
            lastRun: job.lastRun?.toISOString() ?? null,
            lastResult: job.lastResult,
            lastError: job.lastError,
            nextRun: this.getNextRun(job.options.schedule,),
            isRunning: job.isRunning,
            registeredAt: job.registeredAt.toISOString(),
        };
    }
}

export const cronRegistry = new CronRegistry();
