import { describe, expect, it, vi, } from 'vitest';
import { csrfProtection, } from './csrf';

function run(req: Record<string, unknown>,) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), };
    const next = vi.fn();
    csrfProtection(req as never, res as never, next,);
    return { res, next, };
}

describe('csrfProtection', () => {
    it('skips the cookie check for Bearer-authenticated requests', () => {
        const { res, next, } = run({
            method: 'POST',
            path: '/api/v1/posts',
            headers: { authorization: 'Bearer some-jwt-or-api-key', },
            cookies: {},
        },);
        expect(next,).toHaveBeenCalledOnce();
        expect(res.status,).not.toHaveBeenCalled();
    },);

    it('still blocks cookie-auth clients without a CSRF token', () => {
        const { res, next, } = run({
            method: 'POST',
            path: '/api/v1/posts',
            headers: {},
            cookies: {},
        },);
        expect(next,).not.toHaveBeenCalled();
        expect(res.status,).toHaveBeenCalledWith(403,);
    },);

    it('passes cookie-auth clients with matching tokens', () => {
        const { next, } = run({
            method: 'POST',
            path: '/api/v1/posts',
            headers: { 'x-csrf-token': 'tok', },
            cookies: { 'csrf-token': 'tok', },
        },);
        expect(next,).toHaveBeenCalledOnce();
    },);

    it('skips safe methods', () => {
        const { next, } = run({ method: 'GET', path: '/x', headers: {}, cookies: {}, },);
        expect(next,).toHaveBeenCalledOnce();
    },);

    it('skips cookie check even when auth cookies are also present (Bearer wins downstream)', () => {
        const { res, next, } = run({
            method: 'POST',
            path: '/api/v1/posts',
            headers: { authorization: 'Bearer some-jwt', },
            cookies: { accessToken: 'cookie-token', 'csrf-token': 'tok', },
        },);
        expect(next,).toHaveBeenCalledOnce();
        expect(res.status,).not.toHaveBeenCalled();
    },);

    it('skips the Stripe webhook path', () => {
        const { next, } = run({
            method: 'POST',
            path: '/api/v1/payments/webhook',
            headers: {},
            cookies: {},
        },);
        expect(next,).toHaveBeenCalledOnce();
    },);
},);
