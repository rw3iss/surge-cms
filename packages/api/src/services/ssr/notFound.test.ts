/**
 * Which URLs answer 404.
 *
 * Every unmatched path used to return HTTP 200 with a self-referencing
 * canonical and `index, follow` — an unbounded soft-404 surface on a site with
 * ~18 real URLs, where any typo or scraped link became an indexable page.
 *
 * The risk in fixing it runs the OTHER way: a false 404 removes a real page
 * from the index. So the tests below care at least as much about what must
 * STAY 200 as about what must become 404.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn();
vi.mock('../../db', () => ({ query: (...a: unknown[]) => queryMock(...a,), }),);
vi.mock('./templateRuntime', () => ({ resolveContentForSsr: (c: string,) => Promise.resolve(c,), }),);
vi.mock('../../config', () => ({ config: { frontendUrl: 'https://example.test', }, }),);

import { resolveRouteMeta, } from './routes';

/** No settings rows, no content rows — every lookup misses. */
function withNoContent() {
    queryMock.mockImplementation((sql: string,) => {
        if (String(sql,).includes('site_settings',)) return Promise.resolve({ rows: [], },);
        return Promise.resolve({ rows: [], },);
    },);
}

beforeEach(() => { queryMock.mockReset(); withNoContent(); },);

describe('URLs that must 404', () => {
    it('a single-segment slug with no page behind it', async () => {
        const meta = await resolveRouteMeta('/this-page-does-not-exist-xyz',);
        expect(meta?.notFound,).toBe(true,);
    },);

    it('a post slug with no published post', async () => {
        const meta = await resolveRouteMeta('/posts/no-such-post',);
        expect(meta?.notFound,).toBe(true,);
    },);

    it('a campaign slug with no campaign', async () => {
        const meta = await resolveRouteMeta('/campaigns/no-such-campaign',);
        expect(meta?.notFound,).toBe(true,);
    },);

    it('an arbitrary deep path', async () => {
        const meta = await resolveRouteMeta('/random/deep/path',);
        expect(meta?.notFound,).toBe(true,);
    },);

    it('carries noindex AND no canonical', async () => {
        // A canonical on a 404 invites the crawler to treat the URL as real,
        // which is the behaviour being fixed — a 404 status with a
        // self-canonical is a mixed signal.
        const meta = await resolveRouteMeta('/nope-xyz',);
        expect(meta?.noindex,).toBe(true,);
        expect(meta?.nofollow,).toBe(true,);
        expect(meta?.canonical,).toBeUndefined();
    },);
},);

describe('URLs that must NOT 404', () => {
    it('static public routes with no CMS entity behind them', async () => {
        // There is no row to find for any of these, so the "nothing matched"
        // path would condemn the sign-in page.
        for (const path of [
            '/', '/login', '/join', '/subscribe', '/search', '/profile',
            '/posts', '/campaigns', '/donate', '/events', '/shop', '/setup',
            '/forgot-password', '/reset-password', '/verify',
        ]) {
            const meta = await resolveRouteMeta(path,);
            expect(meta?.notFound, `${path} must not 404`,).toBeFalsy();
        }
    },);

    it('routes under prefixes the SPA resolves client-side', async () => {
        // SSR has no product/event/form resolver, so it cannot know whether
        // these exist. A false 404 on a real product is far worse than a soft
        // 200 on a fake one.
        for (const path of [
            '/shop/some-product', '/shop/cart', '/shop/checkout',
            '/shop/collections/tees', '/events/summer-gala',
            '/forms/newsletter', '/u/unsubscribe-token',
        ]) {
            const meta = await resolveRouteMeta(path,);
            expect(meta?.notFound, `${path} must not 404`,).toBeFalsy();
        }
    },);

    it('a page slug that DOES exist', async () => {
        queryMock.mockImplementation((sql: string,) => {
            if (String(sql,).includes('FROM pages',)) {
                return Promise.resolve({
                    rows: [{ id: 'p1', title: 'About', slug: 'about', show_title: true, },],
                },);
            }
            return Promise.resolve({ rows: [], },);
        },);
        const meta = await resolveRouteMeta('/about',);
        expect(meta?.notFound,).toBeFalsy();
        expect(meta?.canonical,).toBe('https://example.test/about',);
    },);

    it('a post slug that DOES exist', async () => {
        queryMock.mockImplementation((sql: string,) => {
            if (String(sql,).includes('FROM posts p',)) {
                return Promise.resolve({
                    rows: [{ id: 'x1', title: 'Real Post', slug: 'real-post', status: 'published', },],
                },);
            }
            return Promise.resolve({ rows: [], },);
        },);
        const meta = await resolveRouteMeta('/posts/real-post',);
        expect(meta?.notFound,).toBeFalsy();
    },);
},);
