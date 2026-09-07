/**
 * Drift guard for the generated SDK module reference.
 *
 * The reference at /admin/help/sdk/component-js lists every namespace on `cms`
 * and every method on each. It is generated from the @sitesurge/client source
 * precisely so it cannot go stale — but only if something notices when the
 * committed output no longer matches. That is this test.
 *
 * If it fails: `npm run docs:sdk -w @sitesurge/admin`, then commit the result.
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
},);
