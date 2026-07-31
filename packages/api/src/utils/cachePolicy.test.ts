import { describe, expect, it, } from 'vitest';
import { isCacheablePublicHtml, } from './cachePolicy';

// Minimal Request stub — only the fields the predicate reads.
function req(opts: {
    method?: string;
    path?: string;
    cookies?: Record<string, string>;
    authorization?: string;
} = {},): any {
    return {
        method: opts.method ?? 'GET',
        path: opts.path ?? '/',
        cookies: opts.cookies ?? {},
        headers: opts.authorization ? { authorization: opts.authorization, } : {},
    };
}

describe('isCacheablePublicHtml', () => {
    it('caches anonymous public GET pages', () => {
        expect(isCacheablePublicHtml(req({ path: '/', },),)).toBe(true,);
        expect(isCacheablePublicHtml(req({ path: '/posts', },),)).toBe(true,);
        expect(isCacheablePublicHtml(req({ path: '/posts/some-slug', },),)).toBe(true,);
        expect(isCacheablePublicHtml(req({ path: '/shop', },),)).toBe(true,);
        expect(isCacheablePublicHtml(req({ path: '/some-dynamic-page', },),)).toBe(true,);
    });

    it('NEVER caches when a logged-in session cookie is present', () => {
        expect(isCacheablePublicHtml(req({ path: '/', cookies: { accessToken: 'jwt', }, },),)).toBe(false,);
    });

    it('NEVER caches API-key / bearer clients', () => {
        expect(isCacheablePublicHtml(req({ path: '/', authorization: 'Bearer ssk_x', },),)).toBe(false,);
    });

    it('does not cache admin / api / setup', () => {
        expect(isCacheablePublicHtml(req({ path: '/admin', },),)).toBe(false,);
        expect(isCacheablePublicHtml(req({ path: '/admin/posts', },),)).toBe(false,);
        expect(isCacheablePublicHtml(req({ path: '/api/v1/posts', },),)).toBe(false,);
        expect(isCacheablePublicHtml(req({ path: '/setup', },),)).toBe(false,);
    });

    it('does not cache auth / cart / checkout / search / account / unsubscribe', () => {
        for (const p of ['/login', '/join', '/search', '/shop/cart', '/shop/checkout', '/shop/orders/123', '/account', '/profile', '/u/tok']) {
            expect(isCacheablePublicHtml(req({ path: p, },),)).toBe(false,);
        }
    });

    it('only caches GET/HEAD', () => {
        expect(isCacheablePublicHtml(req({ method: 'POST', path: '/', },),)).toBe(false,);
        expect(isCacheablePublicHtml(req({ method: 'HEAD', path: '/', },),)).toBe(true,);
    });
});
