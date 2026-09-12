import { describe, expect, it, } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FEATURE_REGISTRY, type FeatureKey, } from './registry';
import { parseFeatureHeader, } from '../db/migrator';

/**
 * Guard: every feature-gated migration must be declared by its feature.
 *
 * The migration runner SKIPS `-- @feature <key>` files while that feature is
 * disabled, and `installFeatureStep` later replays the list in
 * `FEATURE_REGISTRY[key].migrations`. Those lists are hand-maintained, so a
 * migration added later can carry the header, be skipped at boot, and never be
 * replayed on enable — leaving an INCOMPLETE schema that only fails at runtime.
 *
 * That is exactly what happened: 075/076/081/088/089 (shop) and 078
 * (mailing_lists) were headered but unregistered, so enabling shop on a fresh
 * install produced `column spm.external_url does not exist` on /shop/products.
 *
 * This test makes the drift a build failure instead of a production 500.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations',);

/**
 * `filename -> feature key` for every migration carrying a @feature header.
 *
 * Uses the RUNNER's own parser rather than a second regex. This test used to
 * hand-roll a looser, unanchored one over the first 400 bytes, so it disagreed
 * with the thing it is guarding: the runner requires the header to be the whole
 * line, and merely *mentioning* the header in a comment ("deliberately carries
 * no @feature header") made the test claim a migration was gated when the
 * runner would always run it. A guard that reports a risk the code does not
 * have trains people to ignore it.
 *
 * Reading the whole file, not a 400-byte prefix, for the same reason — the
 * runner matches anywhere in the SQL.
 */
function gatedMigrations(): Map<string, string> {
    const out = new Map<string, string>();
    for (const file of fs.readdirSync(MIGRATIONS_DIR,).sort()) {
        if (!file.endsWith('.sql',)) continue;
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file,), 'utf8',);
        const key = parseFeatureHeader(sql,);
        if (key) out.set(file, key,);
    }
    return out;
}

describe('feature migration coverage', () => {
    it('finds the gated migrations (guards against a wrong directory)', () => {
        expect(gatedMigrations().size,).toBeGreaterThan(0,);
    },);

    it('declares every @feature migration in that feature\'s registry entry', () => {
        const missing: string[] = [];

        for (const [file, key,] of gatedMigrations()) {
            const feature = FEATURE_REGISTRY[key as FeatureKey];
            if (!feature) {
                missing.push(`${file}: @feature ${key} is not a registered feature`,);
                continue;
            }
            if (!(feature.migrations ?? []).includes(file,)) {
                missing.push(`${file}: not listed in FEATURE_REGISTRY.${key}.migrations`,);
            }
        }

        expect(
            missing,
            `Feature-gated migrations missing from the registry — enabling the feature `
                + `would leave an incomplete schema:\n  ${missing.join('\n  ',)}`,
        ).toEqual([],);
    },);

    it('does not list a migration that no longer exists on disk', () => {
        const onDisk = new Set(
            fs.readdirSync(MIGRATIONS_DIR,).filter((f,) => f.endsWith('.sql',)),
        );
        const dangling: string[] = [];

        for (const [key, feature,] of Object.entries(FEATURE_REGISTRY,)) {
            for (const file of feature.migrations ?? []) {
                if (!onDisk.has(file,)) dangling.push(`${key}: ${file}`,);
            }
        }

        expect(dangling, `Registry references missing migration files:\n  ${dangling.join('\n  ',)}`,)
            .toEqual([],);
    },);
},);
