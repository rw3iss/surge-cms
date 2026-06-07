/**
 * Health service — liveness/readiness/diagnostic probes. Wraps the DB
 * and Redis health checks; routes own the HTTP status semantics (a
 * degraded probe answers 503).
 */
import { healthCheck as dbHealthCheck, } from '../db';
import { cache, } from './cache';

export interface DetailedHealth {
    status: 'healthy' | 'degraded';
    timestamp: string;
    checks: Record<string, { status: string; latency?: number; }>;
    uptime: number;
    memory: NodeJS.MemoryUsage;
    healthy: boolean;
}

export async function detailed(): Promise<DetailedHealth> {
    const checks: Record<string, { status: string; latency?: number; }> = {};

    const dbStart = Date.now();
    const dbHealthy = await dbHealthCheck();
    checks.database = {
        status: dbHealthy ? 'healthy' : 'unhealthy',
        latency: Date.now() - dbStart,
    };

    const redisStart = Date.now();
    const redisHealthy = await cache.healthCheck();
    checks.redis = {
        status: redisHealthy ? 'healthy' : 'unhealthy',
        latency: Date.now() - redisStart,
    };

    const allHealthy = Object.values(checks,).every((c,) => c.status === 'healthy');

    return {
        status: allHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        checks,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        healthy: allHealthy,
    };
}

export async function ready(): Promise<boolean> {
    return dbHealthCheck();
}
