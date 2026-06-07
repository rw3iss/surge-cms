/**
 * Setup orchestration — the gate + install pipeline the HTTP routes call
 * into. Keeps the route handlers thin (parse → service → respond).
 */
import crypto from 'crypto';
import { AlreadyInstalledError, } from '../../core/errors';
import { getInstallationState, } from '../installation';
import { transitionToRunning, } from '../lifecycle';
import { logger, } from '../../utils/logger';
import { runInstallation, } from './installer';
import type { InstallResult, } from './installer';

/** Reject when the instance is already installed. Every setup endpoint
 *  except GET /status calls this first. */
export async function ensureSetupAllowed(): Promise<void> {
    const state = await getInstallationState();
    if (!state.needsSetup) throw new AlreadyInstalledError();
}

export function generateJwtSecret(): { secret: string; } {
    return { secret: crypto.randomBytes(48,).toString('base64url',), };
}

/**
 * Run the installer and schedule the running-mode transition.
 *
 * The transition is fire-and-forget on `setImmediate` so the HTTP
 * response flushes BEFORE the process restarts itself — the caller
 * returns this result and the framework serializes it; setImmediate
 * fires after that flush.
 */
export async function install(body: unknown,): Promise<InstallResult> {
    const result = await runInstallation(body,);
    setImmediate(() => {
        transitionToRunning().catch((err,) => {
            logger.error('transitionToRunning failed', { error: (err as Error).message, },);
        },);
    },);
    return result;
}
