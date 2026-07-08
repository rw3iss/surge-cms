import { beforeEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./receipt', () => ({ sendOrderReceipt: vi.fn(), }),);
vi.mock('../../config', () => ({ config: { stripe: { secretKey: undefined, }, frontendUrl: '', }, }),);

const findOrdersMock = vi.fn().mockResolvedValue({ data: [], total: 0, },);
const findOrderByIdMock = vi.fn();
vi.mock('../../repositories/shop/shopOrders.repo', () => ({
    findOrders: (...a: unknown[]) => findOrdersMock(...a),
    findOrderById: (...a: unknown[]) => findOrderByIdMock(...a),
    findOrderByNumber: vi.fn(),
    updateOrder: vi.fn(),
    findDigitalItemByToken: vi.fn(),
    findDigitalFileUrl: vi.fn(),
}),);

import * as orders from './orders';

describe('shop orders service — role-shaped reads', () => {
    beforeEach(() => {
        findOrdersMock.mockClear();
        findOrderByIdMock.mockReset();
    },);

    it('admin list passes NO user/email filter (sees all orders)', async () => {
        await orders.list({}, { isAdmin: true, userId: 'admin1', email: 'admin@x.com', },);
        const filters = findOrdersMock.mock.calls[0][0] as { userId?: string; email?: string; };
        expect(filters.userId,).toBeUndefined();
        expect(filters.email,).toBeUndefined();
    },);

    it('user list scopes to their own user_id + email', async () => {
        await orders.list({}, { isAdmin: false, userId: 'u1', email: 'u1@x.com', },);
        const filters = findOrdersMock.mock.calls[0][0] as { userId?: string; email?: string; };
        expect(filters.userId,).toBe('u1',);
        expect(filters.email,).toBe('u1@x.com',);
    },);

    it('a user with no id and no email owns nothing (empty list, no query)', async () => {
        const result = await orders.list({}, { isAdmin: false, userId: null, email: null, },);
        expect(result.data,).toEqual([],);
        expect(findOrdersMock,).not.toHaveBeenCalled();
    },);

    it('get() returns any order for an admin', async () => {
        findOrderByIdMock.mockResolvedValue({ id: 'o1', userId: 'someoneElse', customerEmail: 'x@y.com', items: [], },);
        const out = await orders.get('o1', { isAdmin: true, userId: 'admin1', },);
        expect(out.id,).toBe('o1',);
    },);

    it('get() 404s when a non-admin requests an order they do not own', async () => {
        findOrderByIdMock.mockResolvedValue({ id: 'o1', userId: 'other', customerEmail: 'other@x.com', items: [], },);
        await expect(
            orders.get('o1', { isAdmin: false, userId: 'u1', email: 'u1@x.com', },),
        ).rejects.toMatchObject({ statusCode: 404, },);
    },);

    it('get() returns the order for the owning user', async () => {
        findOrderByIdMock.mockResolvedValue({ id: 'o1', userId: 'u1', customerEmail: 'u1@x.com', items: [], },);
        const out = await orders.get('o1', { isAdmin: false, userId: 'u1', email: 'u1@x.com', },);
        expect(out.id,).toBe('o1',);
    },);
},);
