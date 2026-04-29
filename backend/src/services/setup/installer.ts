import { AlreadyInstalledError, AppError, ValidationError, } from '../../core/errors';
import type { ValidationIssue, } from '../../core/types/installation';
import { logger, } from '../../utils/logger';
import { getInstallationState, invalidateInstallationState, } from '../installation';
import { adminUserStep, } from './steps/adminUserStep';
import { databaseStep, } from './steps/databaseStep';
import { envWriteStep, } from './steps/envWriteStep';
import type { InstallContext, InstallStep, } from './steps/InstallStep';
import { migrationStep, } from './steps/migrationStep';
import { seedStep, } from './steps/seedStep';
import { siteSettingsStep, } from './steps/siteSettingsStep';
import { defaultEnvPath, EnvFileStore, } from './stores/envFileStore';
import type { InstallInput, } from './types';
import { installInputSchema, zodErrorToIssues, } from './validators/installInput';

/**
 * Step list. Order is significant — `databaseStep` must run first
 * (needs a pool), `envWriteStep` last (point of no return). Inserting a
 * new step is just adding an entry here; nothing else in the file
 * changes.
 */
const STEPS: InstallStep[] = [
    databaseStep,
    migrationStep,
    adminUserStep,
    seedStep,
    siteSettingsStep,
    envWriteStep,
];

export interface InstallResult {
    ok: true;
    appliedSteps: string[];
    restartNeeded: true;
}

export type InstallFailure = {
    ok: false;
    errors: ValidationIssue[];
    stage?: string;
};

export async function runInstallation(
    rawInput: unknown,
    options: { envPath?: string; } = {},
): Promise<InstallResult> {
    // Refuse to run on an already-installed instance.
    const state = await getInstallationState(true,);
    if (!state.needsSetup) throw new AlreadyInstalledError();

    // Validate.
    const parsed = installInputSchema.safeParse(rawInput,);
    if (!parsed.success) {
        throw new ValidationError(
            'Wizard input failed validation',
            { errors: zodErrorToIssues(parsed.error,), stage: 'validate', },
        );
    }
    const input = parsed.data as InstallInput;

    const envBuffer = new EnvFileStore(options.envPath ?? defaultEnvPath(),);
    const ctx: InstallContext = { input, envBuffer, scratch: {}, };
    const applied: InstallStep[] = [];

    try {
        for (const step of STEPS) {
            if (!step.isApplicable(ctx,)) {
                logger.debug(`Setup: skipping ${step.id} (not applicable)`,);
                continue;
            }
            logger.info(`Setup: running ${step.id}`,);
            await step.execute(ctx,);
            applied.push(step,);
        }
        invalidateInstallationState();
        return { ok: true, appliedSteps: applied.map((s,) => s.id,), restartNeeded: true, };
    } catch (error) {
        logger.error('Setup failed; rolling back', {
            error: (error as Error).message,
            applied: applied.map((s,) => s.id,),
        },);
        for (const step of applied.reverse()) {
            if (!step.rollback) continue;
            try {
                await step.rollback(ctx,);
            } catch (rbErr) {
                logger.warn(`Rollback failed for ${step.id}`, { error: (rbErr as Error).message, },);
            }
        }
        // Always close any pool the database step opened.
        if (ctx.pool) await ctx.pool.end().catch(() => {/* ignore */});

        if (error instanceof AppError) throw error;
        throw new AppError(
            500,
            'INSTALL_FAILED',
            `Installation failed: ${(error as Error).message}`,
        );
    } finally {
        // Best-effort cleanup if everything succeeded — close the temporary pool;
        // the next request will create a fresh pool from the now-installed config.
        if (ctx.pool) {
            await ctx.pool.end().catch(() => {/* ignore */});
            ctx.pool = undefined;
        }
    }
}
