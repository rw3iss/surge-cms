import { beforeEach, describe, expect, it, vi, } from 'vitest';

const applyMock = vi.fn().mockResolvedValue(['039_x.sql',],);
vi.mock('./migrations', () => ({ applyFeatureMigrations: (...a: unknown[]) => applyMock(...a,), }),);

import { installFeatureStep, } from './lifecycle';
import { FEATURE_REGISTRY, } from './registry';

describe('installFeatureStep', () => {
    beforeEach(() => applyMock.mockClear(),);
    it('runs migrations then the onEnable hook, returning applied migrations', async () => {
        const hook = vi.fn().mockResolvedValue(undefined,);
        (FEATURE_REGISTRY as Record<string, unknown>).__test = {
            key: '__test', label: 'T', defaultEnabled: false, onEnable: hook,
        };
        const client = {} as never;
        const applied = await installFeatureStep('__test' as never, client,);
        expect(applyMock,).toHaveBeenCalledWith('__test', client,);
        expect(hook,).toHaveBeenCalledWith(client, '__test',);
        expect(applied,).toEqual(['039_x.sql',]);
        delete (FEATURE_REGISTRY as Record<string, unknown>).__test;
    },);
},);
