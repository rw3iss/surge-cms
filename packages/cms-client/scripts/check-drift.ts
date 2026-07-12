/**
 * API drift check — the COMPLETENESS GUARANTEE for @sitesurge/client.
 *
 * Compares the wire truth (`docs/api-manifest.json`) against the client's
 * declared route coverage (`src/modules/coverage.ts`) in BOTH directions:
 *
 *   1. Every manifest route must be in ROUTE_COVERAGE ∪ INTENTIONALLY_UNEXPOSED.
 *      A manifest route in neither set is a MISSING client method.
 *   2. Every ROUTE_COVERAGE entry must exist in the manifest. An entry with no
 *      manifest match is a DEAD route — a client method targeting a path the
 *      server doesn't serve.
 *
 * Exit 0 only when both directions are clean. Run via `npm run check:drift`.
 */
import { readFileSync, } from 'node:fs';
import { fileURLToPath, } from 'node:url';
import { dirname, resolve, } from 'node:path';
import { ROUTE_COVERAGE, INTENTIONALLY_UNEXPOSED, } from '../src/modules/coverage';

interface ManifestRoute {
    method: string;
    path: string;
    absolutePath: string;
    auth: string;
    summary: string;
}

interface ManifestModule {
    module: string;
    mountPath: string;
    routes: ManifestRoute[];
}

interface Manifest {
    generatedAt: string;
    totalModules: number;
    totalRoutes: number;
    modules: ManifestModule[];
}

const here = dirname(fileURLToPath(import.meta.url,),);
// scripts/ → packages/cms-client → packages → repo root → docs/api-manifest.json
const manifestPath = resolve(here, '../../../docs/api-manifest.json',);

function loadManifest(): Manifest {
    const raw = readFileSync(manifestPath, 'utf8',);
    return JSON.parse(raw,) as Manifest;
}

function flattenManifest(manifest: Manifest,): Set<string> {
    const set = new Set<string>();
    for (const mod of manifest.modules) {
        for (const route of mod.routes) {
            set.add(`${route.method} ${route.absolutePath}`,);
        }
    }
    return set;
}

function main(): void {
    const manifest = loadManifest();
    const manifestSet = flattenManifest(manifest,);
    const covered = new Set(ROUTE_COVERAGE,);
    const allowlisted = new Set(INTENTIONALLY_UNEXPOSED,);
    const known = new Set([...covered, ...allowlisted,],);

    // Direction 1: manifest routes neither covered nor allowlisted.
    const uncovered: string[] = [];
    for (const route of manifestSet) {
        if (!known.has(route,)) uncovered.push(route,);
    }

    // Direction 2: coverage entries that don't exist in the manifest.
    const dead: string[] = [];
    for (const route of covered) {
        if (!manifestSet.has(route,)) dead.push(route,);
    }

    // Bonus integrity: allowlist entries that aren't real manifest routes
    // (a stale allowlist hides nothing but signals drift in the allowlist).
    const staleAllow: string[] = [];
    for (const route of allowlisted) {
        if (!manifestSet.has(route,)) staleAllow.push(route,);
    }

    // Duplicate coverage entries (one method ↔ one route invariant).
    const dupes = ROUTE_COVERAGE.filter((r, i,) => ROUTE_COVERAGE.indexOf(r,) !== i,);

    const sortLines = (xs: string[],) => [...xs,].sort().map((x,) => `  - ${x}`,).join('\n',);

    console.log('@sitesurge/client API drift check',);
    console.log(`  manifest:       ${manifest.totalRoutes} routes / ${manifest.totalModules} modules (flattened ${manifestSet.size})`,);
    console.log(`  ROUTE_COVERAGE: ${ROUTE_COVERAGE.length} entries (${covered.size} unique)`,);
    console.log(`  allowlisted:    ${allowlisted.size} entries`,);

    let failed = false;

    if (uncovered.length > 0) {
        failed = true;
        console.error(`\nFAIL — ${uncovered.length} manifest route(s) NOT covered and NOT allowlisted:`,);
        console.error(sortLines(uncovered,),);
        console.error('\nAdd a client method (+ ROUTE_COVERAGE entry) for each, or allowlist it in INTENTIONALLY_UNEXPOSED.',);
    }

    if (dead.length > 0) {
        failed = true;
        console.error(`\nFAIL — ${dead.length} ROUTE_COVERAGE entry(ies) NOT present in the manifest (dead routes):`,);
        console.error(sortLines(dead,),);
        console.error('\nA client method is targeting a route the server does not serve. Fix the path or remove the entry.',);
    }

    if (staleAllow.length > 0) {
        failed = true;
        console.error(`\nFAIL — ${staleAllow.length} INTENTIONALLY_UNEXPOSED entry(ies) NOT present in the manifest (stale allowlist):`,);
        console.error(sortLines(staleAllow,),);
    }

    if (dupes.length > 0) {
        failed = true;
        console.error(`\nFAIL — ${dupes.length} duplicate ROUTE_COVERAGE entry(ies):`,);
        console.error(sortLines([...new Set(dupes,),],),);
    }

    if (failed) {
        process.exit(1,);
    }

    console.log('\nPASS — every manifest route is covered or allowlisted, and every coverage entry is real.',);
    process.exit(0,);
}

main();
