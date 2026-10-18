import { describe, expect, it, vi, } from 'vitest';

const pull = vi.fn(async () => ({ provider: 'acme', }));
const broken = vi.fn(async () => { throw new Error('down',); });
const printify = vi.fn(async () => ({ provider: 'printify', }));
vi.mock('./providers/registry', () => ({
    listProviders: () => [
        { key: 'printify', reconcileOrders: printify, },
        { key: 'broken', reconcileOrders: broken, },
        { key: 'acme', reconcileOrders: pull, },
        { key: 'apliiq', },
    ],
}),);
vi.mock('./providers/settings', () => ({ getActiveProviderConfig: async (k: string,) => (k === 'off' ? null : { k, }), }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), }, }),);

const { runProviderReconciles, } = await import('./fulfilmentSync');

describe('runProviderReconciles', () => {
    it('reconciles every pull supplier, skips excluded + push ones, survives a failure', async () => {
        const out = await runProviderReconciles({ sinceDays: 60, trigger: 'cron', exclude: ['printify',], },);
        expect(out,).toEqual([{ provider: 'acme', },],);
        expect(printify,).not.toHaveBeenCalled();
        expect(broken,).toHaveBeenCalled();
        expect(pull,).toHaveBeenCalledWith({ k: 'acme', }, { sinceDays: 60, trigger: 'cron', },);
    },);
},);
