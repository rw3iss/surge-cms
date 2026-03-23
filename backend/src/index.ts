import { createApp, } from './app';
import { config, } from './config';
import { closePool, pool, } from './db';
import { cache, } from './services/cache';
import { verifyEmailConfig, } from './services/email';
import { logger, } from './utils/logger';

async function main() {
    try {
        // Verify database connection
        logger.info('Connecting to database...',);
        await pool.connect();
        logger.info('Database connected',);

        // Verify Redis connection
        logger.info('Connecting to Redis...',);
        const redisHealthy = await cache.healthCheck();
        if (redisHealthy) {
            logger.info('Redis connected',);
        } else {
            logger.warn('Redis connection failed - caching will be disabled',);
        }

        // Verify email configuration
        const emailConfigured = await verifyEmailConfig();
        if (!emailConfigured) {
            logger.warn('Email configuration not set or invalid - emails will not be sent',);
        }

        // Create and start Express app
        const app = createApp();

        const server = app.listen(config.port, () => {
            logger.info(`Server running on port ${config.port}`,);
            logger.info(`Environment: ${config.env}`,);
            logger.info(`API URL: http://localhost:${config.port}/api/${config.apiVersion}`,);
        },);

        // Graceful shutdown
        const shutdown = async (signal: string,) => {
            logger.info(`Received ${signal}, shutting down gracefully...`,);

            server.close(async () => {
                logger.info('HTTP server closed',);

                try {
                    await closePool();
                    logger.info('Database pool closed',);

                    await cache.close();
                    logger.info('Redis connection closed',);

                    process.exit(0,);
                } catch (error) {
                    logger.error('Error during shutdown', { error, },);
                    process.exit(1,);
                }
            },);

            // Force shutdown after 30 seconds
            setTimeout(() => {
                logger.error('Forced shutdown after timeout',);
                process.exit(1,);
            }, 30000,);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM',),);
        process.on('SIGINT', () => shutdown('SIGINT',),);

        // Handle uncaught exceptions
        process.on('uncaughtException', (error,) => {
            logger.error('Uncaught exception', { error, },);
            shutdown('uncaughtException',);
        },);

        process.on('unhandledRejection', (reason,) => {
            logger.error('Unhandled rejection', { reason, },);
        },);
    } catch (error) {
        logger.error('Failed to start server', { error, },);
        process.exit(1,);
    }
}

main();
