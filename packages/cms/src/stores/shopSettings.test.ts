/**
 * Storefront gating depends on two flags that are easy to conflate:
 *   - the `shop` FEATURE  — is the module installed at all?
 *   - `storeEnabled`      — has the operator opened the store?
 *
 * A cart icon linking to a 404, or a checkout page for a closed store, both
 * come from reading only the first one. These pin the resolved values.
 */
import { beforeEach, describe, expect, it, } from 'vitest';
import type { ShopPublicSettings, } from '@sitesurge/types';
import { __setShopSettingsForTest, storeEnabled, storefrontMode, } from './shopSettings';

const base = { currency: 'USD', taxEnabled: false, businessName: 'X', } as ShopPublicSettings;

beforeEach(() => __setShopSettingsForTest(null,),);

describe('storeEnabled', () => {
    it('is false before settings load — a closed store must not flash open', () => {
        expect(storeEnabled(),).toBe(false,);
    },);

    it('is false when the fetch failed (settings stay null)', () => {
        __setShopSettingsForTest(null,);
        expect(storeEnabled(),).toBe(false,);
    },);

    it('follows the operator toggle', () => {
        __setShopSettingsForTest({ ...base, storeEnabled: true, },);
        expect(storeEnabled(),).toBe(true,);
        __setShopSettingsForTest({ ...base, storeEnabled: false, },);
        expect(storeEnabled(),).toBe(false,);
    },);

    it('treats a missing flag as closed, not open', () => {
        __setShopSettingsForTest({ ...base, } as ShopPublicSettings,);
        expect(storeEnabled(),).toBe(false,);
    },);
},);

describe('storefrontMode', () => {
    it('defaults to the built-in grid', () => {
        __setShopSettingsForTest({ ...base, storeEnabled: true, },);
        expect(storefrontMode(),).toBe('builtin',);
    },);

    it('reports page mode when set', () => {
        __setShopSettingsForTest({ ...base, storeEnabled: true, storefrontMode: 'page', },);
        expect(storefrontMode(),).toBe('page',);
    },);

    it('is independent of storeEnabled — a closed store can still use its own page', () => {
        __setShopSettingsForTest({ ...base, storeEnabled: false, storefrontMode: 'page', },);
        expect(storefrontMode(),).toBe('page',);
        expect(storeEnabled(),).toBe(false,);
    },);
},);
