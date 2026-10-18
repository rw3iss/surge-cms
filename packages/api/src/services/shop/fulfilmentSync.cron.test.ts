/** `shop:fulfilment-sync` — its own cron (audit SE30), no-op with the shop off. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const listProviders = vi.fn();
const getActiveProviderConfig = vi.fn();
const isFeatureEnabledServer = vi.fn();
const register = vi.fn();

vi.mock('./providers/registry', () => ({ listProviders: () => listProviders(), }),);
vi.mock('./providers/settings', () => ({ getActiveProviderConfig: (...a: unknown[]) => getActiveProviderConfig(...a,), }),);
vi.mock('../settings', () => ({ isFeatureEnabledServer: (...a: unknown[]) => isFeatureEnabledServer(...a,), }),);
vi.mock('../cron', () => ({ cronRegistry: { register: (...a: unknown[]) => register(...a,), }, }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), }, }),);

import { FULFILMENT_SYNC_JOB, fulfilmentSyncTick, initFulfilmentSyncCron, } from './fulfilmentSync';

const reconcile = vi.fn(async () => ({ provider: 'acme', }));

beforeEach(() => {
    vi.clearAllMocks();
    listProviders.mockReturnValue([{ key: 'printify', reconcileOrders: vi.fn(), }, { key: 'acme', reconcileOrders: reconcile, },],);
    getActiveProviderConfig.mockResolvedValue({ token: 't', },);
},);

describe('fulfilment sync cron', () => {
    it('registers under its own job name', () => {
        initFulfilmentSyncCron();
        expect(register.mock.calls[0][0],).toMatchObject({ name: FULFILMENT_SYNC_JOB, },);
    },);

    it('reconciles every pull supplier except Printify', async () => {
        isFeatureEnabledServer.mockResolvedValue(true,);
        await fulfilmentSyncTick();
        expect(reconcile,).toHaveBeenCalledTimes(1,);
        expect(getActiveProviderConfig,).not.toHaveBeenCalledWith('printify',);
    },);

    it('does nothing while the shop feature is off', async () => {
        isFeatureEnabledServer.mockResolvedValue(false,);
        await fulfilmentSyncTick();
        expect(reconcile,).not.toHaveBeenCalled();
    },);
},);
