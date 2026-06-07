/**
 * Wire DTOs for the /health module.
 *
 * NOTE: `/health/detailed` and `/health/ready` are RAW routes — they
 * answer 503 with a `success: false` body when degraded, which the
 * standardized ApiResponse envelope (always `success: true`) cannot
 * express. The shapes below describe the `data` payload regardless of
 * the `success` flag; clients must read the HTTP status for liveness.
 */

/** GET /api/v1/health — basic check. */
export interface HealthBasicResponse {
    status: 'healthy';
    timestamp: string;
}

/** GET /api/v1/health/detailed — DB + Redis latency, uptime, memory.
 *  `data` on both the 200 and 503 bodies. */
export interface HealthDetailedResponse {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: string;
    checks?: Record<string, { status: string; latency?: number; }>;
    uptime?: number;
    memory?: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
        arrayBuffers: number;
    };
}

/** GET /api/v1/health/ready — readiness (k8s). `data` on 200/503. */
export interface HealthReadyResponse {
    ready: boolean;
}

/** GET /api/v1/health/live — liveness (k8s). */
export interface HealthLiveResponse {
    live: true;
}
