import { beforeEach, describe, expect, it, vi, } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as unknown[][], }),);
vi.mock('../../db', () => ({
    query: vi.fn(async (_sql: string, params: unknown[],) => {
        h.calls.push(params,);
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111', },], };
    },),
}),);
vi.mock('./options', () => ({ getNotificationOptions: async () => ({ inAppEnabled: true, retentionDays: 90, }), }),);

import { recipientsFor, } from './inApp';

describe('recipientsFor', () => {
    beforeEach(() => { h.calls = []; },);

    it('drops ids that are not UUIDs (one bad id must not lose the alert for everyone) and de-duplicates', async () => {
        const good = '11111111-1111-4111-8111-111111111111';
        await recipientsFor({ enabled: true, userIds: [good, 'not-a-uuid', good, '',], roles: ['admin', 'admin', '',], },);
        expect(h.calls[0],).toEqual([[good,], ['admin',],],);
    },);

    it('asks nothing when only bad ids remain', async () => {
        expect(await recipientsFor({ enabled: true, userIds: ['x',], roles: [], },),).toEqual([],);
        expect(h.calls,).toEqual([],);
    },);
},);
