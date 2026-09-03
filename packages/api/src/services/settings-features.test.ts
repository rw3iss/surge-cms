/**
 * The public feature projection must agree with FEATURE_REGISTRY.
 *
 * These two used to be separate hand-maintained lists, and they drifted: `wiki`
 * was projected with the legacy default-ON rule while its registry default was
 * `false`. A site that had never installed the wiki reported it as enabled, and
 * the toggle then appeared dead — the write path reads "current" from the same
 * registry default, so turning it off was a no-op with nothing to write.
 *
 * The projection now derives from the registry; this guards that it stays so,
 * including for features added later.
 */
import { describe, expect, it, vi, } from 'vitest';

vi.mock('../db', () => ({ query: vi.fn(async () => ({ rows: [], })), }));

import { computePublicFeatures, } from './settings';
import { FEATURE_REGISTRY, featureSettingKey, } from '../features/registry';
import type { FeatureKey, } from '../features/registry';

const KEYS = Object.keys(FEATURE_REGISTRY,) as FeatureKey[];

describe('computePublicFeatures', () => {
    it('falls back to each feature\'s registry default when no row exists', async () => {
        const features = await computePublicFeatures({},) as Record<string, { enabled: boolean; }>;
        for (const key of KEYS) {
            // Patreon is the one feature with an extra runtime condition (a live
            // connection), so it can be off even when its default says on.
            if (key === 'patreon') continue;
            expect(
                features[key]?.enabled,
                `${key} should default to its registry defaultEnabled`,
            ).toBe(FEATURE_REGISTRY[key].defaultEnabled,);
        }
    });

    it('reports wiki as disabled on a site that never installed it', async () => {
        // The exact production case: no wiki_enabled row, no wiki tables.
        const features = await computePublicFeatures({ posts_enabled: true, },) as
            Record<string, { enabled: boolean; }>;
        expect(features.wiki.enabled,).toBe(false,);
    });

    it('keeps legacy modules visible when their row is absent', async () => {
        // An install predating the feature system must not suddenly hide content.
        const features = await computePublicFeatures({},) as Record<string, { enabled: boolean; }>;
        for (const key of ['posts', 'campaigns', 'forms', 'messages', 'social',]) {
            expect(features[key].enabled, `${key} should stay on`,).toBe(true,);
        }
    });

    it('honours an explicit false for a default-on module', async () => {
        const features = await computePublicFeatures({ posts_enabled: false, },) as
            Record<string, { enabled: boolean; }>;
        expect(features.posts.enabled,).toBe(false,);
    });

    it('honours an explicit true for an opt-in feature', async () => {
        const features = await computePublicFeatures({ wiki_enabled: true, },) as
            Record<string, { enabled: boolean; }>;
        expect(features.wiki.enabled,).toBe(true,);
    });

    it('accepts the legacy { value: true } row shape', async () => {
        // Some rows were written wrapped; reading one as `false` would silently
        // disable a feature the operator had switched on.
        const features = await computePublicFeatures({ shop_enabled: { value: true, }, },) as
            Record<string, { enabled: boolean; }>;
        expect(features.shop.enabled,).toBe(true,);
    });

    it('projects every feature in the registry', async () => {
        const features = await computePublicFeatures({},) as Record<string, unknown>;
        for (const key of KEYS) {
            expect(features[key], `${key} missing from the public projection`,).toBeDefined();
        }
    });

    it('uses the registry key naming for the settings row', () => {
        expect(featureSettingKey('wiki',),).toBe('wiki_enabled',);
    });
});
