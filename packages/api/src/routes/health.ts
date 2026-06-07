import type { HealthBasicResponse, HealthLiveResponse, } from '@rw/cms-shared';
import { defineRoute, } from '../api/defineRoute';
import * as health from '../services/health';
import { logger, } from '../utils/logger';

// The probes that can answer 503 (detailed/ready) are `raw` so they can
// emit the legacy `success: false` body on failure — the standardized
// envelope always reports `success: true`, which would lie about a
// degraded system to k8s / uptime monitors.

export const healthRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'public',
        summary: 'Basic health check.',
        handler: (): HealthBasicResponse => ({ status: 'healthy', timestamp: new Date().toISOString(), }),
    },),

    defineRoute({
        method: 'get', path: '/detailed', auth: 'public', raw: true,
        summary: 'Detailed health check (DB + Redis latency, uptime, memory).',
        handler: async ({ res, },) => {
            try {
                const { healthy, ...data } = await health.detailed();
                res.status(healthy ? 200 : 503,).json({ success: healthy, data, },);
            } catch (error) {
                logger.error('Health check failed', { error, },);
                res.status(503,).json({
                    success: false,
                    data: { status: 'unhealthy', timestamp: new Date().toISOString(), },
                },);
            }
        },
    },),

    defineRoute({
        method: 'get', path: '/ready', auth: 'public', raw: true,
        summary: 'Readiness check (k8s).',
        handler: async ({ res, },) => {
            try {
                const ok = await health.ready();
                res.status(ok ? 200 : 503,).json({ success: ok, data: { ready: ok, }, },);
            } catch {
                res.status(503,).json({ success: false, data: { ready: false, }, },);
            }
        },
    },),

    defineRoute({
        method: 'get', path: '/live', auth: 'public',
        summary: 'Liveness check (k8s).',
        handler: (): HealthLiveResponse => ({ live: true, }),
    },),
];
