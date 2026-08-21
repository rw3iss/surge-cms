import { describe, expect, it, } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FEATURE_REGISTRY, } from './registry';

/**
 * Guard: the feature catalog is duplicated in THREE hand-maintained places, and
 * they must agree.
 *
 *   1. `api/src/features/registry.ts`      — the server's source of truth
 *      (migrations, owned tables, lifecycle hooks).
 *   2. `shared/src/types/content.ts`       — the `SiteFeatures` wire type.
 *   3. `cms/src/config/features.ts`        — the frontend catalog that RENDERS
 *      the Settings → Features list.
 *
 * A feature missing from (3) is invisible in the admin no matter how complete
 * the backend is — which is exactly what happened when `events` was added to
 * the registry alone: the module existed, the migration was registered, and the
 * toggle simply never appeared.
 *
 * These files live in different workspaces, so this test reads (2) and (3) as
 * text rather than importing them.
 */

const SHARED_CONTENT = path.resolve(__dirname, '../../../shared/src/types/content.ts',);
const CMS_FEATURES = path.resolve(__dirname, '../../../cms/src/config/features.ts',);

/** Keys declared in the shared `SiteFeatures` interface. */
function sharedFeatureKeys(): string[] {
    const src = fs.readFileSync(SHARED_CONTENT, 'utf8',);
    const block = src.slice(src.indexOf('export interface SiteFeatures {',),);
    const body = block.slice(0, block.indexOf('\n}',),);
    return [...body.matchAll(/^\s{4}([a-z_]+):\s*\{\s*enabled/gm,),].map((m,) => m[1]);
}

/** Keys listed in the frontend FEATURES array. */
function cmsFeatureKeys(): string[] {
    const src = fs.readFileSync(CMS_FEATURES, 'utf8',);
    const block = src.slice(src.indexOf('export const FEATURES',),);
    const body = block.slice(0, block.indexOf('\n];',),);
    return [...body.matchAll(/\{\s*key:\s*'([a-z_]+)'/g,),].map((m,) => m[1]);
}

describe('feature catalog parity', () => {
    const registryKeys = Object.keys(FEATURE_REGISTRY,).sort();

    it('reads all three catalogs (guards against a bad path or parse)', () => {
        expect(registryKeys.length,).toBeGreaterThan(5,);
        expect(sharedFeatureKeys().length,).toBeGreaterThan(5,);
        expect(cmsFeatureKeys().length,).toBeGreaterThan(5,);
    },);

    it('shared SiteFeatures matches the backend registry', () => {
        expect(sharedFeatureKeys().sort(),).toEqual(registryKeys,);
    },);

    it('the frontend catalog matches the backend registry', () => {
        // Without this, a new feature is unreachable from Settings → Features.
        expect(cmsFeatureKeys().sort(),).toEqual(registryKeys,);
    },);

    it('agrees on the dependency graph', () => {
        const src = fs.readFileSync(CMS_FEATURES, 'utf8',);
        const block = src.slice(src.indexOf('export const FEATURES',),);
        const body = block.slice(0, block.indexOf('\n];',),);

        const mismatches: string[] = [];
        for (const line of body.split('\n',)) {
            const key = line.match(/\{\s*key:\s*'([a-z_]+)'/,)?.[1];
            if (!key) continue;
            const cmsRequires = [...line.matchAll(/'([a-z_]+)',\]/g,),].map((m,) => m[1]).sort();
            const apiRequires = [...(FEATURE_REGISTRY[key as never] as {
                requires?: string[];
            })?.requires ?? [],].sort();
            if (JSON.stringify(cmsRequires,) !== JSON.stringify(apiRequires,)) {
                mismatches.push(
                    `${key}: frontend requires [${cmsRequires}] but backend requires [${apiRequires}]`,
                );
            }
        }
        expect(mismatches, mismatches.join('\n',),).toEqual([],);
    },);
},);
