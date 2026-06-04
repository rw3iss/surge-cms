/**
 * Shim — the canonical service-layer contract now lives in
 * `services/types.ts`. This re-export keeps legacy `sdk/` imports
 * compiling while modules migrate (spec: 2026-06-04-headless-api-design).
 */
export * from '../services/types';
