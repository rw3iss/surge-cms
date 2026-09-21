import { describe, expect, it, vi, } from 'vitest';
import { canonicalPath, canonicalRedirect, canonicalUrlMiddleware, } from './canonicalUrl';

describe('canonicalPath', () => {
    it('maps the SPA shell filename onto the root', () => {
        expect(canonicalPath('/index.html',),).toBe('/',);
    },);

    it('strips a trailing slash', () => {
        expect(canonicalPath('/about/',),).toBe('/about',);
        expect(canonicalPath('/posts/some-slug/',),).toBe('/posts/some-slug',);
    },);

    it('strips repeated trailing slashes', () => {
        expect(canonicalPath('/about///',),).toBe('/about',);
    },);

    it('leaves the root alone', () => {
        // The root is the one path where a trailing slash IS the canonical
        // form; trimming it would produce an empty Location header.
        expect(canonicalPath('/',),).toBe('/',);
        expect(canonicalPath('///',),).toBe('/',);
    },);

    it('leaves an already-canonical path alone', () => {
        expect(canonicalPath('/about',),).toBe('/about',);
    },);
},);

describe('canonicalRedirect', () => {
    it('redirects /index.html to the root', () => {
        expect(canonicalRedirect('GET', '/index.html',),).toBe('/',);
    },);

    it('redirects a trailing slash', () => {
        expect(canonicalRedirect('GET', '/about/',),).toBe('/about',);
    },);

    it('preserves the query string', () => {
        expect(canonicalRedirect('GET', '/posts/?page=2',),).toBe('/posts?page=2',);
        expect(canonicalRedirect('GET', '/index.html?utm_source=x',),).toBe('/?utm_source=x',);
    },);

    it('preserves a fragment', () => {
        expect(canonicalRedirect('GET', '/about/#team',),).toBe('/about#team',);
    },);

    it('does not redirect an already-canonical URL', () => {
        expect(canonicalRedirect('GET', '/about',),).toBeNull();
        expect(canonicalRedirect('GET', '/',),).toBeNull();
        expect(canonicalRedirect('GET', '/posts/slug?a=1',),).toBeNull();
    },);

    it('covers HEAD as well as GET', () => {
        expect(canonicalRedirect('HEAD', '/about/',),).toBe('/about',);
    },);

    it.each(['POST', 'PUT', 'PATCH', 'DELETE',],)(
        'leaves %s alone — a 301 would invite the client to replay it as a GET',
        (method,) => {
            expect(canonicalRedirect(method, '/about/',),).toBeNull();
            expect(canonicalRedirect(method, '/index.html',),).toBeNull();
        },
    );

    it.each([
        '/api/v1/posts/',
        '/assets/chunk/',
        '/uploads/2026/',
        '/avatars/x/',
    ],)('leaves the non-page prefix %s alone', (url,) => {
        expect(canonicalRedirect('GET', url,),).toBeNull();
    },);

    it('does not treat an api-like page slug as the api prefix', () => {
        // `/apiary/` starts with "/api" but not "/api/" — the trailing slash in
        // the guard is what keeps a real page from being skipped.
        expect(canonicalRedirect('GET', '/apiary/',),).toBe('/apiary',);
    },);

    it('redirects a nested index.html only at the exact root filename', () => {
        // `/docs/index.html` is a real distinct address, not the SPA shell;
        // rewriting it to `/` would send a valid page to the homepage.
        expect(canonicalRedirect('GET', '/docs/index.html',),).toBeNull();
    },);
},);

describe('canonicalUrlMiddleware', () => {
    function run(method: string, originalUrl: string,) {
        const redirect = vi.fn();
        const next = vi.fn();
        canonicalUrlMiddleware(
            { method, originalUrl, } as never,
            { redirect, } as never,
            next,
        );
        return { redirect, next, };
    }

    it('answers 301, not 302', () => {
        // A 302 says the duplicate is coming back, so a crawler keeps both
        // addresses and consolidates nothing. The status code IS the fix.
        const { redirect, next, } = run('GET', '/about/',);
        expect(redirect,).toHaveBeenCalledWith(301, '/about',);
        expect(next,).not.toHaveBeenCalled();
    },);

    it('redirects the SPA shell filename', () => {
        const { redirect, } = run('GET', '/index.html',);
        expect(redirect,).toHaveBeenCalledWith(301, '/',);
    },);

    it('calls next() and never redirects a canonical URL', () => {
        const { redirect, next, } = run('GET', '/about',);
        expect(redirect,).not.toHaveBeenCalled();
        expect(next,).toHaveBeenCalledOnce();
    },);

    it('calls next() for a POST', () => {
        const { redirect, next, } = run('POST', '/about/',);
        expect(redirect,).not.toHaveBeenCalled();
        expect(next,).toHaveBeenCalledOnce();
    },);
},);
