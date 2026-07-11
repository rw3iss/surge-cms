import { beforeEach, describe, expect, it, vi, } from 'vitest';

// ── Mocks ──
const cacheGetMock = vi.fn().mockResolvedValue(null,);
const cacheSetMock = vi.fn();
const cacheDelMock = vi.fn();
const invalidateSettingsMock = vi.fn();
vi.mock('../cache', () => ({
    cache: {
        get: (...a: unknown[]) => cacheGetMock(...a),
        set: (...a: unknown[]) => cacheSetMock(...a),
        del: (...a: unknown[]) => cacheDelMock(...a),
        invalidateSettingsCache: (...a: unknown[]) => invalidateSettingsMock(...a),
    },
}),);

const logAuditMock = vi.fn();
vi.mock('../audit', () => ({ logAudit: (...a: unknown[]) => logAuditMock(...a), }),);

const queryMock = vi.fn(async () => ({ rows: [] as unknown[], }));
vi.mock('../../db', () => ({ query: (...a: unknown[]) => queryMock(...a), }),);

import * as settings from './settings';

const ctx = { userId: 'u1', ipAddress: '', userAgent: '', };

beforeEach(() => {
    cacheGetMock.mockReset().mockResolvedValue(null,);
    cacheSetMock.mockReset();
    cacheDelMock.mockReset();
    invalidateSettingsMock.mockReset();
    logAuditMock.mockReset();
    queryMock.mockReset().mockResolvedValue({ rows: [], });
},);

describe('shop settings service', () => {
    it('getRaw returns registry-seed defaults when both rows are absent', async () => {
        const config = await settings.getRaw();
        expect(config.settings,).toEqual({
            currency: 'usd',
            taxEnabled: true,
            businessName: '',
            storeEnabled: true,
        },);
        expect(config.appearance,).toEqual({
            gridColumns: 3,
            showRatings: true,
            cardStyle: 'standard',
        },);
    },);

    it('getPublic omits any Stripe/secret fields even when stored on the row', async () => {
        // Store a shop_settings row that (hypothetically) carries secret-ish
        // keys — the projection must never surface them.
        queryMock.mockImplementation(async (_sql: string, params?: unknown[],) => {
            if (params && params[0] === 'shop_settings') {
                return {
                    rows: [{
                        value: {
                            currency: 'usd',
                            taxEnabled: true,
                            businessName: 'Acme',
                            businessAddress: '1 Secret Way',
                            storeEnabled: true,
                            stripeSecretKey: 'sk_live_LEAK',
                            stripeTaxEnabled: true,
                            payoutAccountId: 'acct_LEAK',
                        },
                    }],
                };
            }
            return { rows: [], };
        },);

        const pub = await settings.getPublic();
        const flat = JSON.stringify(pub,);

        // No secret/account internals in the wire projection.
        expect(flat,).not.toContain('stripeSecretKey',);
        expect(flat,).not.toContain('sk_live',);
        expect(flat,).not.toContain('payoutAccountId',);
        expect(flat,).not.toContain('acct_LEAK',);
        expect(flat,).not.toContain('businessAddress',);
        expect(flat,).not.toContain('1 Secret Way',);
        // The safe subset IS present.
        expect(pub.settings,).toEqual({
            currency: 'usd',
            taxEnabled: true,
            storeEnabled: true,
            businessName: 'Acme',
            currencyDisplay: undefined,
        },);
        expect(pub.appearance.gridColumns,).toBe(3,);
        // No stray keys on the settings projection.
        expect(Object.keys(pub.settings,).sort(),).toEqual(
            ['businessName', 'currency', 'currencyDisplay', 'storeEnabled', 'taxEnabled',],
        );
    },);

    it('update merges the partial, persists both rows, and busts the caches', async () => {
        // Existing rows returned by getRaw's reads.
        queryMock.mockImplementation(async (sql: string,) => {
            const s = String(sql,);
            if (s.includes('SELECT value') && s.includes('$1')) {
                // getRaw reads (settings then appearance) — return the current
                // stored values so the merge preserves untouched fields.
                return { rows: [], };
            }
            return { rows: [], };
        },);

        const result = await settings.update(
            { settings: { currency: 'eur', }, appearance: { gridColumns: 4, }, },
            ctx,
        );

        // Merge preserved defaults + applied the patch.
        expect(result.settings.currency,).toBe('eur',);
        expect(result.settings.storeEnabled,).toBe(true,); // default preserved
        expect(result.appearance.gridColumns,).toBe(4,);
        expect(result.appearance.showRatings,).toBe(true,); // default preserved

        // Persisted both rows.
        const upserts = queryMock.mock.calls
            .map((c,) => String(c[0],))
            .filter((sql,) => sql.includes('INSERT INTO site_settings',));
        expect(upserts.length,).toBe(2,);
        const upsertKeys = queryMock.mock.calls
            .filter((c,) => String(c[0],).includes('INSERT INTO site_settings',))
            .map((c,) => (c[1] as unknown[])[0]);
        expect(upsertKeys,).toContain('shop_settings',);
        expect(upsertKeys,).toContain('shop_appearance',);

        // Cache invalidation.
        expect(cacheDelMock,).toHaveBeenCalledWith('shop:settings:raw',);
        expect(cacheDelMock,).toHaveBeenCalledWith('shop:settings:public',);
        expect(invalidateSettingsMock,).toHaveBeenCalled();
        expect(logAuditMock,).toHaveBeenCalledWith(
            expect.objectContaining({ entityType: 'shop-settings', }),
        );
    },);

    it('update rejects a non-3-letter currency', async () => {
        await expect(
            settings.update({ settings: { currency: 'dollars', }, }, ctx,),
        ).rejects.toThrow();
    },);

    it('update rejects gridColumns out of range', async () => {
        await expect(
            settings.update({ appearance: { gridColumns: 9, }, }, ctx,),
        ).rejects.toThrow();
    },);
},);
