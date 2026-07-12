/**
 * @sitesurge/client — headless TypeScript client for any hosted CMS backend.
 *
 * Goal: mirror the in-process `cms.*` service aggregate over HTTP so that
 * any consumer (our own @sitesurge/admin SPA, external apps, Node scripts) routes
 * ALL client-side API calls through this package. Zero runtime dependencies;
 * fetch-based; works in Node ≥ 18 and modern browsers.
 */
import { CmsClientCore, } from './core/client';
import type { CmsClientConfig, } from './core/types';
import { assembleModules, type CmsModules, } from './modules';

export type CmsClient = CmsClientCore & CmsModules;

/** Create a configured CMS client. */
export function createClient(config: CmsClientConfig,): CmsClient {
    const core = new CmsClientCore(config,);
    return assembleModules(core,) as CmsClient;
}

export * from './core/types';
export * from './core/errors';
export { CmsClientCore, } from './core/client';
