/**
 * Drift guard for the generated API reference (`/admin/help/api`).
 *
 * Built from docs/api-manifest.json + the SDK reference + the client's
 * coverage map. If it fails: `npm run docs:api` (root), then commit.
 */
import { describe, expect, it, } from 'vitest';
import { readFileSync, } from 'node:fs';
import { resolve, } from 'node:path';
import { buildApiReference, renderFile, } from '../../../scripts/generate-api-reference';
import { API_MODULES, API_ROUTE_COUNT, } from './apiReference.generated';
import { SDK_MODULES, } from './sdkModules.generated';
import { apiAnchor, } from '../../components/admin/help/anchors';

const OUT = resolve(__dirname, 'apiReference.generated.ts',);

describe('generated API reference', () => {
    it('is up to date with the route manifest', () => {
        const fresh = renderFile(buildApiReference(),);
        const committed = readFileSync(OUT, 'utf8',);
        expect(fresh === committed, 'The API reference is stale. Run: npm run docs:api',).toBe(true,);
    },);

    it('lists every manifest route', () => {
        const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../../../docs/api-manifest.json',), 'utf8',),);
        expect(API_ROUTE_COUNT,).toBe(manifest.totalRoutes,);
        expect(API_ROUTE_COUNT,).toBeGreaterThanOrEqual(400,);
    },);

    it('cross-links SDK methods and routes both ways', () => {
        const routes = new Set(API_MODULES.flatMap((m,) => m.routes.map((r,) => `${r.method} ${r.absolutePath}`)),);
        // Every route an SDK method names exists in the API reference …
        const dangling = SDK_MODULES.flatMap((m,) => m.methods.flatMap((f,) => f.routes.filter((r,) => !routes.has(r,),)));
        expect(dangling,).toEqual([],);
        // … and a known route names its method.
        const list = API_MODULES.find((m,) => m.module === 'posts',)!.routes.find((r,) => r.method === 'GET' && r.path === '/',);
        expect(list?.sdk,).toContain('cms.posts.list',);
    },);

    it('carries input fields from the zod schemas', () => {
        const withInput = API_MODULES.flatMap((m,) => m.routes).filter((r,) => r.input,);
        expect(withInput.length,).toBeGreaterThan(100,);
        const create = API_MODULES.find((m,) => m.module === 'api-keys',)!.routes.find((r,) => r.method === 'POST',);
        expect(create?.input?.body?.find((f,) => f.name === 'name',),).toMatchObject({ type: 'string', required: true, },);
    },);

    it('builds unique anchors', () => {
        const anchors = API_MODULES.flatMap((m,) => m.routes.map((r,) => apiAnchor(`${r.method} ${r.absolutePath}`,)));
        expect(new Set(anchors,).size,).toBe(anchors.length,);
        expect(apiAnchor('GET /api/v1/posts/:id',),).toBe('get-/api/v1/posts/:id',);
    },);
},);
