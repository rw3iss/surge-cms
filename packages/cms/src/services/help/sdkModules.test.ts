/**
 * Drift guard for the generated SDK module reference.
 *
 * The reference at /admin/help/sdk/reference lists every namespace on `cms`
 * and every method on each (with params, return type and the API routes it
 * calls, resolved against docs/api-manifest.json). It is generated from the @sitesurge/client source
 * precisely so it cannot go stale — but only if something notices when the
 * committed output no longer matches. That is this test.
 *
 * If it fails: `npm run docs:api` (root) or `npm run docs:sdk -w @sitesurge/admin`,
 * then commit the result.
 */
import { describe, expect, it, } from 'vitest';
import { readFileSync, } from 'node:fs';
import { resolve, } from 'node:path';
import { buildSdkModuleDocs, renderFile, } from '../../../scripts/generate-sdk-modules';
import { SDK_METHOD_COUNT, SDK_MODULE_COUNT, SDK_MODULES, } from './sdkModules.generated';

const OUT = resolve(__dirname, 'sdkModules.generated.ts',);

describe('generated SDK module reference', () => {
    it('is up to date with the client source', () => {
        const fresh = renderFile(buildSdkModuleDocs(),);
        const committed = readFileSync(OUT, 'utf8',);
        expect(
            fresh === committed,
            'The SDK reference is stale. Run: npm run docs:sdk -w @sitesurge/admin',
        ).toBe(true,);
    },);

    it('covers every namespace and finds real methods', () => {
        // Sanity floors rather than exact counts, which would fail on every
        // legitimate SDK addition and train people to regenerate blindly.
        expect(SDK_MODULE_COUNT,).toBeGreaterThanOrEqual(30,);
        expect(SDK_METHOD_COUNT,).toBeGreaterThanOrEqual(200,);
        expect(SDK_MODULES.every((m,) => m.methods.length > 0,),).toBe(true,);
    },);

    it('never captures a method body in a signature', () => {
        // The parser cuts at the body brace; a regression there produced
        // signatures like `isAuthenticated(): boolean { return this.x(); }`.
        const leaked = SDK_MODULES.flatMap((m,) =>
            m.methods.filter((f,) => f.signature.includes('return ',) || f.signature.includes('this.',))
                .map((f,) => `${m.namespace}.${f.name}`)
        );
        expect(leaked,).toEqual([],);
    },);

    it('exposes sub-namespace groups with dotted names', () => {
        // cms.shop.products.list and friends are most of the shop surface; a
        // parser that only walked class methods reported one method for shop.
        const shop = SDK_MODULES.find((m,) => m.namespace === 'shop',);
        expect(shop,).toBeDefined();
        expect(shop!.methods.some((f,) => f.name.startsWith('products.',)),).toBe(true,);
        expect(shop!.methods.length,).toBeGreaterThan(20,);
    },);

    it('strips JSDoc decoration from summaries', () => {
        const messy = SDK_MODULES.flatMap((m,) => m.methods)
            .filter((f,) => f.summary.includes('/**',) || f.summary.includes('*/',));
        expect(messy,).toEqual([],);
    },);

    it('resolves the API route of every network method', () => {
        // Local helpers (cms.ui) and the auth-manager passthroughs make no
        // request; everything else must name a manifest route, or the SDK ↔ API
        // cross-links silently go missing.
        const LOCAL = new Set(['ui', 'auth',],);
        const missing = SDK_MODULES.filter((m,) => !LOCAL.has(m.namespace,),)
            .flatMap((m,) => m.methods.filter((f,) => f.routes.length === 0,).map((f,) => `${m.namespace}.${f.name}`));
        expect(missing,).toEqual([],);
        const posts = SDK_MODULES.find((m,) => m.namespace === 'posts',)!;
        expect(posts.methods.find((f,) => f.name === 'list',)?.routes,).toEqual(['GET /api/v1/posts',],);
        // A `:id` call lands on the `:id` route, not a literal sibling.
        expect(posts.methods.find((f,) => f.name === 'getById',)?.routes,).toEqual(['GET /api/v1/posts/:id',],);
    },);

    it('splits parameters and the return type out of the signature', () => {
        const keys = SDK_MODULES.find((m,) => m.namespace === 'apiKeys',)!;
        const create = keys.methods.find((f,) => f.name === 'create',)!;
        expect(create.params,).toEqual([{ name: 'body', type: 'ApiKeyCreateBody', optional: false, },],);
        expect(create.returns,).toBe('Promise<ApiKeyCreateResponse>',);
    },);
},);
