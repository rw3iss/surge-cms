import type {
    HealthBasicResponse, HealthDetailedResponse, HealthReadyResponse, HealthLiveResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * /health namespace (public) — liveness/readiness probes. All probes pass
 * `cache: false` so they always reflect the live process state. `detailed`
 * and `ready` answer 503 when degraded; read the HTTP status for liveness.
 */
export class HealthModule extends ModuleBase {
    protected readonly module = 'health';

    /** GET /health — basic check (always succeeds). */
    basic(): Promise<HealthBasicResponse> {
        return this.get<HealthBasicResponse>('/health', { options: { cache: false, }, },);
    }

    /** GET /health/detailed — DB + Redis latency, uptime, memory. */
    detailed(): Promise<HealthDetailedResponse> {
        return this.get<HealthDetailedResponse>('/health/detailed', { options: { cache: false, }, },);
    }

    /** GET /health/ready — readiness probe (200/503 per status). */
    ready(): Promise<HealthReadyResponse> {
        return this.get<HealthReadyResponse>('/health/ready', { options: { cache: false, }, },);
    }

    /** GET /health/live — liveness probe. */
    live(): Promise<HealthLiveResponse> {
        return this.get<HealthLiveResponse>('/health/live', { options: { cache: false, }, },);
    }
}
