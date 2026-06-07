import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn().mockResolvedValue({ rows: [], },);
vi.mock('../db', () => ({ query: (...args: unknown[]) => queryMock(...args), }),);

import { logAudit, } from './audit';

describe('logAudit actor handling', () => {
    beforeEach(() => queryMock.mockClear(),);

    it('passes UUID userIds into user_id', async () => {
        await logAudit({
            userId: '11111111-2222-3333-4444-555555555555',
            action: 'create', entityType: 'post',
        },);
        const params = queryMock.mock.calls[0][1] as unknown[];
        expect(params[0],).toBe('11111111-2222-3333-4444-555555555555',);
    },);

    it('nulls non-UUID userIds and folds them into new_values.actor', async () => {
        await logAudit({
            userId: 'api-key:deploy-bot',
            action: 'update', entityType: 'post',
            newValues: { title: 'x', },
        },);
        const params = queryMock.mock.calls[0][1] as unknown[];
        expect(params[0],).toBeNull();
        expect(JSON.parse(params[5] as string,),).toEqual({ title: 'x', actor: 'api-key:deploy-bot', },);
    },);

    it("folds the legacy 'system' actor the same way", async () => {
        await logAudit({ userId: 'system', action: 'create', entityType: 'page', },);
        const params = queryMock.mock.calls[0][1] as unknown[];
        expect(params[0],).toBeNull();
        expect(JSON.parse(params[5] as string,),).toEqual({ actor: 'system', },);
    },);
},);
