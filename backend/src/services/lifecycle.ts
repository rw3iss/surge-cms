import fs from 'fs';
import path from 'path';
import { invalidateInstallationState, } from './installation';
import { logger, } from '../utils/logger';

/**
 * Single seam between "setup just finished" and "the backend is now in
 * running mode."
 *
 * Production (option A): exit the process; PM2 / systemd / etc. restarts
 * us with the freshly-written `.env`.
 *
 * Development: `tsx watch` does NOT auto-restart on process exit — it
 * only respawns on watched-file changes. Just exiting would leave the
 * dev server dead. Instead we touch the entry file so tsx sees a
 * "change" and respawns the process with the new env.
 *
 * Future (option B — in-process hot-reload): swap the body for
 *     await loadConfig();
 *     await resetPool();
 *     remountRoutes('running');
 *     await initSocialCrons();
 *     ...
 * No call site changes; only this function changes.
 */

const RESTART_DELAY_MS = 500;

function touchEntryFile(): boolean {
    // In dev, lifecycle.ts is at <root>/backend/src/services/lifecycle.ts
    // (run by tsx). The entry tsx watches is one level up — index.ts.
    const entryPath = path.resolve(__dirname, '..', 'index.ts',);
    try {
        const now = new Date();
        fs.utimesSync(entryPath, now, now,);
        logger.info(`Touched ${entryPath} — tsx watch will respawn the process`,);
        return true;
    } catch (err) {
        logger.warn('Could not touch entry file; you may need to restart the dev server manually', {
            error: (err as Error).message,
            entryPath,
        },);
        return false;
    }
}

export async function transitionToRunning(): Promise<void> {
    invalidateInstallationState();

    const isProduction = process.env.NODE_ENV === 'production';

    if (!isProduction) {
        // Touch the entry file. tsx watch picks up the change within ~250ms
        // and SIGTERMs us automatically — we don't need our own exit().
        const touched = touchEntryFile();
        if (touched) {
            logger.info('Setup complete — waiting for tsx watch to restart us',);
            return;
        }
        // Fallback: if we couldn't touch the file (permissions, etc.),
        // exit anyway so the user at least sees the dev server stop and
        // can restart manually.
    }

    logger.info('Setup complete — exiting for supervisor restart',);
    setTimeout(() => {
        // Clean exit so supervisors restart without alarm.
        // eslint-disable-next-line no-process-exit
        process.exit(0,);
    }, RESTART_DELAY_MS,);
}
