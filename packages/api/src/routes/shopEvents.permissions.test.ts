import { beforeEach, describe, expect, it, vi, } from 'vitest';

/**
 * Shop + Events permissions were declared in the catalog but never checked —
 * removing "Refund orders" from a role changed nothing. These pin that every
 * listed route actually runs its permission, and that API keys (no user) are
 * left to the key's own scope.
 */
const requirePermission = vi.fn();
const can = vi.fn();
vi.mock('../services/permissions', () => ({
    requirePermission: (...a: unknown[]) => requirePermission(...a),
    can: (...a: unknown[]) => can(...a),
}),);

const { shopRoutes, SHOP_ROUTE_PERMISSIONS, } = await import('./shop');
const { eventsRoutes, EVENT_ROUTE_PERMISSIONS, } = await import('./events');

const ADMIN = { id: 'u1', role: 'admin', };
const find = (routes: typeof shopRoutes, method: string, path: string,) =>
    routes.find((r,) => r.method === method && r.path === path,)!;

beforeEach(() => {
    requirePermission.mockReset();
    can.mockReset();
},);

describe('route permission tables', () => {
    it('every shop entry names a real route', () => {
        const real = new Set(shopRoutes.map((r,) => `${r.method.toUpperCase()} ${r.path}`,),);
        for (const k of Object.keys(SHOP_ROUTE_PERMISSIONS,)) expect(real.has(k,), k,).toBe(true,);
    },);
    it('every events entry names a real route', () => {
        const real = new Set(eventsRoutes.map((r,) => `${r.method.toUpperCase()} ${r.path}`,),);
        for (const k of Object.keys(EVENT_ROUTE_PERMISSIONS,)) expect(real.has(k,), k,).toBe(true,);
    },);
},);

describe('shop gates', () => {
    it('a denied permission stops the handler before it runs', async () => {
        requirePermission.mockRejectedValue(Object.assign(new Error('nope',), { status: 403, },),);
        const r = find(shopRoutes, 'delete', '/products/:id',);
        await expect(r.handler({ user: ADMIN, params: { id: 'x', }, audit: () => ({}), } as never,),).rejects.toThrow('nope',);
        expect(requirePermission,).toHaveBeenCalledWith({ id: 'u1', role: 'admin', }, 'shop:write',);
    },);

    it('the merchandise announce needs mailing_lists:send', async () => {
        requirePermission.mockRejectedValue(new Error('denied',),);
        const r = find(shopRoutes, 'post', '/merchandise/announce',);
        await expect(r.handler({ user: ADMIN, body: {}, audit: () => ({}), } as never,),).rejects.toThrow('denied',);
        expect(requirePermission.mock.calls[0][1],).toBe('mailing_lists:send',);
    },);

    it('moving an order to refunded also needs shop.orders:refund', async () => {
        requirePermission.mockImplementation(async (_s: unknown, key: string,) => {
            if (key === 'shop.orders:refund') throw new Error('no refund',);
        },);
        const r = find(shopRoutes, 'patch', '/orders/:id',);
        await expect(r.handler({ user: ADMIN, params: { id: 'o', }, body: { status: 'refunded', }, audit: () => ({}), } as never,),)
            .rejects.toThrow('no refund',);
        expect(requirePermission.mock.calls.map((c,) => c[1],),).toEqual(['shop.orders:write', 'shop.orders:refund',],);
    },);

    it('an API key (no user) is not permission-checked', async () => {
        requirePermission.mockRejectedValue(new Error('should not be called',),);
        const r = find(shopRoutes, 'patch', '/orders/:id',);
        // Will fail later in the service (no DB) — but not with the permission error.
        await expect(r.handler({ user: undefined, apiKey: { id: 'k', }, params: { id: 'o', }, body: { status: 'refunded', }, audit: () => ({}), } as never,),)
            .rejects.not.toThrow('should not be called',);
        expect(requirePermission,).not.toHaveBeenCalled();
    },);
},);

describe('events gates', () => {
    it('registrants need events.registrations:read', async () => {
        requirePermission.mockRejectedValue(new Error('denied',),);
        const r = find(eventsRoutes, 'get', '/:id/registrations',);
        await expect(r.handler({ user: { id: 'e', role: 'editor', }, params: { id: 'x', }, query: {}, } as never,),).rejects.toThrow('denied',);
        expect(requirePermission.mock.calls[0][1],).toBe('events.registrations:read',);
    },);
    it('event writes need events:write', async () => {
        requirePermission.mockRejectedValue(new Error('denied',),);
        const r = find(eventsRoutes, 'delete', '/:id',);
        await expect(r.handler({ user: { id: 'e', role: 'editor', }, params: { id: 'x', }, audit: () => ({}), } as never,),).rejects.toThrow('denied',);
        expect(requirePermission.mock.calls[0][1],).toBe('events:write',);
    },);
},);
