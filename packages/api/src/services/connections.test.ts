import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn().mockResolvedValue({ rows: [], },);
const txClientQueryMock = vi.fn().mockResolvedValue({ rows: [], },);
vi.mock('../db', () => ({
    query: (...args: unknown[]) => queryMock(...args),
    transaction: async (cb: (client: { query: typeof txClientQueryMock; }) => unknown,) =>
        cb({ query: txClientQueryMock, },),
}),);

const delPatternMock = vi.fn().mockResolvedValue(undefined,);
vi.mock('./cache', () => ({ cache: { delPattern: (...a: unknown[]) => delPatternMock(...a), }, }),);

import { reorder, upsert, } from './connections';

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
        expect(params[params.length - 1]).toBeNull();
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

describe('connections.reorder', () => {
    beforeEach(() => {
        queryMock.mockReset();
        txClientQueryMock.mockReset().mockResolvedValue({ rows: [], },);
        delPatternMock.mockClear();
    },);

    it('swaps sort_order with the upper neighbour when moving up', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [
                { id: 'id-a', provider: 'instagram', sort_order: 0, },
                { id: 'id-b', provider: 'youtube', sort_order: 1, },
            ],
        },);

        await reorder('youtube', 'up',);

        // youtube (index 1) swaps with instagram (index 0): each gets the
        // other's array index as the new sort_order.
        const updates = txClientQueryMock.mock.calls.map((c,) => c[1] as unknown[]);
        expect(updates,).toContainEqual(['id-b', 0,],);
        expect(updates,).toContainEqual(['id-a', 1,],);
        expect(delPatternMock,).toHaveBeenCalledWith('social:*',);
    },);

    it('is a no-op at the top edge', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [{ id: 'id-a', provider: 'instagram', sort_order: 0, },],
        },);

        await reorder('instagram', 'up',);

        expect(txClientQueryMock,).not.toHaveBeenCalled();
    },);
},);
