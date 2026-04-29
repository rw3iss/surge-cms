import type { InstallationState, } from '../../core/types/installation';

/**
 * Pure policy: should this request be blocked because the app is in
 * setup mode? Lives in `http/policies/` so it can be unit-tested
 * without spinning up Express, and so the Fastify port (later) can
 * reuse it verbatim — only the wrapping middleware is framework-bound.
 *
 * Rules:
 *   - In running mode, never block.
 *   - In setup mode, only `/api/v1/setup/*` and `/api/v1/health*` are
 *     allowed. Static asset and HTML routes pass through (the SPA
 *     handles its own redirect to /setup).
 */

export interface BlockDecision {
    block: boolean;
    /** When `block` is true, the body to return. */
    body?: { success: false; error: { code: 'NEEDS_SETUP'; message: string; details: { stage: InstallationState['stage']; }; }; };
}

const ALLOWED_API_PREFIXES = [
    '/setup', // /api/v1/setup/...
    '/health', // /api/v1/health (always available so docker/k8s probes work)
];

export function shouldBlockRequest(
    state: InstallationState,
    apiPath: string,
): BlockDecision {
    if (!state.needsSetup) return { block: false, };

    // Only API requests are gated by this policy. Non-API (static/HTML)
    // requests are handled by the frontend redirect.
    if (!apiPath.startsWith('/api/',)) return { block: false, };

    const versioned = apiPath.replace(/^\/api\/v\d+/, '',);
    for (const prefix of ALLOWED_API_PREFIXES) {
        if (versioned === prefix || versioned.startsWith(`${prefix}/`,)) {
            return { block: false, };
        }
    }

    return {
        block: true,
        body: {
            success: false,
            error: {
                code: 'NEEDS_SETUP',
                message: 'This installation requires setup. Visit /setup to continue.',
                details: { stage: state.stage, },
            },
        },
    };
}
