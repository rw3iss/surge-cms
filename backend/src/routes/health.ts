import { Router, } from 'express';
import { healthCheck as dbHealthCheck, } from '../db';
import { cache, } from '../services/cache';
import { logger, } from '../utils/logger';

const router = Router();

// Basic health check
router.get('/', (req, res,) => {
    res.json({
        success: true,
        data: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
        },
    },);
},);

// Detailed health check
router.get('/detailed', async (req, res,) => {
    try {
        const checks: Record<string, { status: string; latency?: number; }> = {};

        // Database check
        const dbStart = Date.now();
        const dbHealthy = await dbHealthCheck();
        checks.database = {
            status: dbHealthy ? 'healthy' : 'unhealthy',
            latency: Date.now() - dbStart,
        };

        // Redis check
        const redisStart = Date.now();
        const redisHealthy = await cache.healthCheck();
        checks.redis = {
            status: redisHealthy ? 'healthy' : 'unhealthy',
            latency: Date.now() - redisStart,
        };

        const allHealthy = Object.values(checks,).every((c,) => c.status === 'healthy');

        res.status(allHealthy ? 200 : 503,).json({
            success: allHealthy,
            data: {
                status: allHealthy ? 'healthy' : 'degraded',
                timestamp: new Date().toISOString(),
                checks,
                uptime: process.uptime(),
                memory: process.memoryUsage(),
            },
        },);
    } catch (error) {
        logger.error('Health check failed', { error, },);
        res.status(503,).json({
            success: false,
            data: {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
            },
        },);
    }
},);

// Readiness check (for k8s)
router.get('/ready', async (req, res,) => {
    try {
        const dbHealthy = await dbHealthCheck();

        if (dbHealthy) {
            res.json({ success: true, data: { ready: true, }, },);
        } else {
            res.status(503,).json({ success: false, data: { ready: false, }, },);
        }
    } catch {
        res.status(503,).json({ success: false, data: { ready: false, }, },);
    }
},);

// Liveness check (for k8s)
router.get('/live', (req, res,) => {
    res.json({ success: true, data: { live: true, }, },);
},);

export default router;
