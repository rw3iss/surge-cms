/**
 * Public programmatic API for `@sitesurge/server`.
 *
 * Embed the SiteSurge backend in your own Node app:
 *
 *   import { createApp, startServer, runMigrations } from '@sitesurge/server';
 *
 *   // (a) just run it (boots DB/Redis/crons, applies migrations, listens):
 *   await startServer();
 *
 *   // (b) or mount the Express app yourself + add custom routes:
 *   const app = createApp('running');
 *   app.use('/webhooks/custom', myRouter);
 *   app.listen(3001);
 *
 * The CLI/runnable entry (`dist/index.js`, used by the systemd unit and the
 * Docker image) is a thin wrapper that just calls `startServer()`.
 */
import fs from 'fs/promises';
import path from 'path';
import type { Server } from 'http';
import { createApp, } from './app';
import { config, getConfig, loadConfig, } from './config';
import { closePool, initPool, } from './db/client';
import { runMigrations, } from './db/migrator';
import { cache, } from './services/cache';
import { cronRegistry, } from './services/cron';
import { verifyEmailConfig, } from './services/email';
import { getInstallationState, } from './services/installation';
import { initPrintifyCron, } from './services/printify/cron';
import { initScheduledPublisher, } from './services/scheduledPublisher';
import { initSocialCrons, } from './services/socialCrons';
import { logger, } from './utils/logger';
import { assertNoCycles, } from './features/registry';

// ─── Re-exported surface for embedders / tooling (e.g. @sitesurge/cli) ─────
export { createApp, type AppMode, } from './app';
export { loadConfig, getConfig, config, } from './config';
export { initPool, closePool, getPool, } from './db/client';
export { runMigrations, } from './db/migrator';
export { runSeed, } from './db/seeder';
export { getInstallationState, } from './services/installation';
export { runInstallation, } from './services/setup/installer';
export { generateJwtSecret, } from './services/setup/orchestrator';
export { postgresTester, } from './services/setup/testers/postgresTester';
export { redisTester, } from './services/setup/testers/redisTester';
export type { InstallInput, } from './services/setup/types';

/**
 * Warm up DB/Redis/crons and apply pending migrations. Called by
 * `startServer` when the instance is already installed ('running' mode).
 */
async function bootRunningMode(): Promise<void> {
    logger.info('Connecting to database...',);
    initPool();
    logger.info('Database connected',);

    // Apply any pending migrations. Idempotent; feature-tagged migrations are
    // skipped when their feature is disabled, so new feature-scoped migrations
    // land on the next restart once the feature is enabled — no manual CLI step.
    try {
        const result = await runMigrations();
        if (result.appliedCount > 0) {
            logger.info(`Boot-time migrations applied: ${result.appliedFilenames.join(', ',)}`,);
        }
    } catch (err) {
        logger.error('Boot-time migrations failed', { error: err, },);
        // Don't crash — surface the error and continue serving /health.
    }

    logger.info('Connecting to Redis...',);
    const redisHealthy = await cache.healthCheck();
    if (redisHealthy) logger.info('Redis connected',);
    else logger.warn('Redis connection failed - caching will be disabled',);

    const emailConfigured = await verifyEmailConfig();
    if (!emailConfigured) logger.warn('Email not configured — emails will not be sent',);

    const avatarDir = path.resolve(config.dataDir, 'avatars',);
    await fs.mkdir(avatarDir, { recursive: true, },);
    logger.info(`Data directory: ${path.resolve(config.dataDir,)}`,);

    await initSocialCrons();
    initScheduledPublisher();
    initPrintifyCron();
    cronRegistry.startAll();
    logger.info('Cron jobs started',);

    // Load enabled plugins (only when the plugins feature is on — else the
    // `plugins` table doesn't exist yet). Isolated: a bad plugin never crashes boot.
    try {
        const { isFeatureEnabledServer, } = await import('./services/settings.js');
        if (await isFeatureEnabledServer('plugins',)) {
            const { bootPlugins, } = await import('./services/plugins.js');
            await bootPlugins();
        }
    } catch (err) {
        logger.warn('Plugin boot skipped', { error: err, },);
    }

    // Resume any send jobs left 'running' by a previous crash (idempotent).
    try {
        const { resumeRunningJobs, } = await import('./services/mail/sendWorker.js');
        void resumeRunningJobs();
    } catch (err) {
        logger.warn('Could not start send-job resumer', { error: err, },);
    }
}

/**
 * Boot the SiteSurge server: load config, decide setup-vs-running mode, warm up
 * dependencies, listen, and install graceful-shutdown handlers. Resolves with
 * the underlying `http.Server`. Tolerant by design — a fresh/misconfigured
 * instance still starts (in 'setup' mode) so the wizard is reachable at /setup.
 */
export async function startServer(): Promise<Server> {
    // Fail-fast if the FEATURE_REGISTRY has a dependency cycle (static config).
    assertNoCycles();

    loadConfig();
    const state = await getInstallationState(true,);
    const mode = state.needsSetup ? 'setup' : 'running';
    logger.info(`Boot mode: ${mode}`, { stage: state.stage, blockers: state.blockers, },);

    if (mode === 'running') {
        try {
            await bootRunningMode();
        } catch (error) {
            logger.error('Running-mode boot failed; falling back to setup mode', {
                error: (error as Error).message,
            },);
        }
    }

    const app = createApp(mode,);
    const cfg = getConfig();
    const server = app.listen(cfg.port, () => {
        logger.info(`Server running on port ${cfg.port}`,);
        logger.info(`Environment: ${cfg.env}`,);
        if (mode === 'setup') {
            logger.info(`Setup wizard: http://localhost:${cfg.port}/setup`,);
        } else {
            logger.info(`API URL: http://localhost:${cfg.port}/api/${cfg.apiVersion}`,);
        }
    },);

    const openSockets = new Set<import('net').Socket>();
    server.on('connection', (socket,) => {
        openSockets.add(socket,);
        socket.on('close', () => openSockets.delete(socket,),);
    },);

    let shuttingDown = false;
    const FORCE_EXIT_MS = 3000;

    const shutdown = async (signal: string,): Promise<void> => {
        if (shuttingDown) {
            logger.warn(`Received ${signal} during shutdown — forcing exit`,);
            process.exit(1,);
        }
        shuttingDown = true;
        logger.info(`Received ${signal}, shutting down...`,);

        const forceExitTimer = setTimeout(() => {
            logger.error(`Shutdown took longer than ${FORCE_EXIT_MS}ms — forcing exit`,);
            process.exit(1,);
        }, FORCE_EXIT_MS,);
        forceExitTimer.unref();

        try {
            server.close();
            if (typeof (server as unknown as { closeAllConnections?: () => void; }).closeAllConnections === 'function') {
                (server as unknown as { closeAllConnections: () => void; }).closeAllConnections();
            }
            for (const socket of openSockets) socket.destroy();
            openSockets.clear();
            cronRegistry.stopAll();
            await Promise.allSettled([closePool(), cache.close(),],);
            logger.info('Shutdown complete',);
            clearTimeout(forceExitTimer,);
            process.exit(0,);
        } catch (error) {
            logger.error('Error during shutdown', { error, },);
            clearTimeout(forceExitTimer,);
            process.exit(1,);
        }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM',),);
    process.on('SIGINT', () => shutdown('SIGINT',),);
    process.on('SIGHUP', () => shutdown('SIGHUP',),);

    process.on('uncaughtException', (error,) => {
        logger.error('Uncaught exception', { error, },);
        process.exit(1,);
    },);

    process.on('unhandledRejection', (reason,) => {
        logger.error('Unhandled rejection', { reason, },);
    },);

    return server;
}
