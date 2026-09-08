import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn().mockResolvedValue({ rows: [], },);
const txClientQueryMock = vi.fn().mockResolvedValue({ rows: [], },);
vi.mock('../db', () => ({
    query: (...args: unknown[]) => queryMock(...args),
    transaction: async (cb: (client: { query: typeof txClientQueryMock; }) => unknown,) =>
        cb({ query: txClientQueryMock, },),
}),);

const invalidateSocialMock = vi.fn().mockResolvedValue(undefined,);
vi.mock('./cache', () => ({
    cache: { invalidateSocialCache: (...a: unknown[]) => invalidateSocialMock(...a), },
}),);

import { reorder, upsert, } from './connections';

/**
 * Bind position of `connected_by` in the INSERT.
 *
 * Read from the SQL rather than assumed to be last: the statement grew
 * `display_name`/`account_id` after it, and a "last parameter" assertion
 * silently started testing the wrong value.
 */
function connectedByParam(call: unknown[],): unknown {
    const sql = call[0] as string;
    const cols = /\(([^)]*)\)\s*VALUES/i.exec(sql,)![1]
        .split(',',).map((c,) => c.trim());
    return (call[1] as unknown[])[cols.indexOf('connected_by',)];
}

describe('connections.upsert actor handling', () => {
    beforeEach(() => queryMock.mockClear(),);

    it('nulls a synthetic api-key actor for connected_by', async () => {
        // No existing row → INSERT branch. The SELECT returns rows:[] from
        // the default mock.
        await upsert({ provider: 'instagram', }, 'api-key:deploy-bot',);

        const insertCall = queryMock.mock.calls.find(
            (c,) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO social_connections',),
        );
        expect(insertCall,).toBeDefined();
        expect(connectedByParam(insertCall!,),).toBeNull();
    },);

    it('passes a real UUID actor through to connected_by', async () => {
        const uuid = '11111111-2222-3333-4444-555555555555';
        await upsert({ provider: 'instagram', }, uuid,);

        const insertCall = queryMock.mock.calls.find(
            (c,) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO social_connections',),
        );
        expect(connectedByParam(insertCall!,),).toBe(uuid,);
    },);
},);

describe('connections.reorder', () => {
    beforeEach(() => {
        queryMock.mockReset();
        txClientQueryMock.mockReset().mockResolvedValue({ rows: [], },);
        invalidateSocialMock.mockClear();
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
        expect(invalidateSocialMock,).toHaveBeenCalled();
    },);

    it('is a no-op at the top edge', async () => {
        queryMock.mockResolvedValueOnce({
            rows: [{ id: 'id-a', provider: 'instagram', sort_order: 0, },],
        },);

        await reorder('instagram', 'up',);

        expect(txClientQueryMock,).not.toHaveBeenCalled();
    },);
},);
