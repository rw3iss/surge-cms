import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn().mockResolvedValue({ rows: [], },);
vi.mock('../db', () => ({ query: (...args: unknown[]) => queryMock(...args), }),);

import { upsert, } from './connections';

describe('connections.upsert actor handling', () => {
    beforeEach(() => queryMock.mockClear(),);

    it('nulls a synthetic api-key actor for connected_by', async () => {
        // No existing row → INSERT branch. The SELECT returns rows:[] from
        // the default mock; connected_by is the last bound param.
        await upsert({ provider: 'instagram', }, 'api-key:deploy-bot',);

        const insertCall = queryMock.mock.calls.find(
            (c,) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO social_connections',),
        );
        expect(insertCall,).toBeDefined();
        const params = insertCall![1] as unknown[];
        expect(params[params.length - 1],).toBeNull();
    },);

    it('passes a real UUID actor through to connected_by', async () => {
        const uuid = '11111111-2222-3333-4444-555555555555';
        await upsert({ provider: 'instagram', }, uuid,);

        const insertCall = queryMock.mock.calls.find(
            (c,) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO social_connections',),
        );
        const params = insertCall![1] as unknown[];
        expect(params[params.length - 1],).toBe(uuid,);
    },);
},);
