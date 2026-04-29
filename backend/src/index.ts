import fs from 'fs/promises';
import path from 'path';
import { createApp, } from './app';
import { config, getConfig, loadConfig, } from './config';
import { closePool, initPool, } from './db/client';
import { cache, } from './services/cache';
import { cronRegistry, } from './services/cron';
import { verifyEmailConfig, } from './services/email';
import { getInstallationState, } from './services/installation';
import { initScheduledPublisher, } from './services/scheduledPublisher';
import { initSocialCrons, } from './services/socialCrons';
import { logger, } from './utils/logger';

/**
 * Tolerant boot. The previous version exited on missing env vars and
 * eagerly connected to the DB; both made it impossible to serve a
 * setup wizard on a fresh install. The new flow:
 *   1. Load config (never crashes; partial config returns defaults).
 *   2. Compute installation state.
 *   3. If state.needsSetup → start the app in 'setup' mode (only
 *      `/api/v1/setup/*` and `/api/v1/health` respond). Crons / DB /
 *      Redis are NOT initialized.
 *   4. Otherwise → start in 'running' mode and warm up DB/Redis/crons.
 *
 * Either way, the process always reaches `app.listen` so the user
 * sees the wizard at `/setup` instead of an error.
 */

async function bootRunningMode(): Promise<void> {
    logger.info('Connecting to database...',);
    initPool();
    logger.info('Database connected',);

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
    cronRegistry.startAll();
    logger.info('Cron jobs started',);
}

async function main(): Promise<void> {
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
}

main().catch((error,) => {
    logger.error('Failed to start server', { error, },);
    process.exit(1,);
},);
