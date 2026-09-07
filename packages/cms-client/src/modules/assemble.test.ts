import { describe, expect, it, } from 'vitest';
import { createClient, } from '../index';
import { ROUTE_COVERAGE, INTENTIONALLY_UNEXPOSED, } from './index';

/** A client with no token store and a no-op fetch — assembly is offline. */
function makeClient() {
    return createClient({
        baseUrl: 'http://api',
        fetch: (() => Promise.reject(new Error('no network in assembly test',),)) as never,
        auth: { store: null, },
    },);
}

describe('module assembly', () => {
    it('exposes every namespace as an object', () => {
        const cms = makeClient();
        const namespaces = [
            'posts', 'pages', 'campaigns', 'forms', 'media', 'users', 'messages',
            'social', 'search', 'utils', 'audit', 'dashboard', 'auth', 'apiKeys',
            'connections', 'blockStyles', 'fonts', 'dev', 'health', 'setup',
            'mailingLists', 'mailTemplates', 'mailSend', 'payments', 'settings',
            'feed', 'sitemap',
        ] as const;
        const bag = cms as unknown as Record<string, unknown>;
        for (const ns of namespaces) {
            expect(typeof bag[ns],).toBe('object',);
            expect(bag[ns],).toBeTruthy();
        }
    },);

    it('namespaces carry their expected methods (typeof === function)', () => {
        const cms = makeClient();
        expect(typeof cms.posts.list,).toBe('function',);
        expect(typeof cms.posts.getBySlug,).toBe('function',);
        expect(typeof cms.users.list,).toBe('function',);
        expect(typeof cms.users.ban,).toBe('function',);
        expect(typeof cms.mailingLists.subscribe,).toBe('function',);
        expect(typeof cms.mailingLists.addSubscriber,).toBe('function',);
        expect(typeof cms.settings.getPublic,).toBe('function',);
        expect(typeof cms.settings.update,).toBe('function',);
        expect(typeof cms.settings.uninstallFeature,).toBe('function',);
        expect(typeof cms.payments.donate,).toBe('function',);
        expect(typeof cms.payments.adminSubscriptions,).toBe('function',);
        expect(typeof cms.payments.adminTransactions,).toBe('function',);
        expect(typeof cms.payments.adminUserTransactions,).toBe('function',);
        expect(typeof cms.auth.login,).toBe('function',);
        expect(typeof cms.auth.register,).toBe('function',);
        expect(typeof cms.auth.me,).toBe('function',);
        expect(typeof cms.utils.urlPreview,).toBe('function',);
        expect(typeof cms.shop.products.list,).toBe('function',);
        expect(typeof cms.shop.categories.getBySlug,).toBe('function',);
        expect(typeof cms.shop.collections.list,).toBe('function',);
        expect(typeof cms.shop.tags.list,).toBe('function',);
        expect(typeof cms.shop.checkout.create,).toBe('function',);
        expect(typeof cms.shop.orders.list,).toBe('function',);
        expect(typeof cms.feed.xml,).toBe('function',);
        expect(typeof cms.sitemap.xml,).toBe('function',);
        expect(typeof cms.sitemap.regenerate,).toBe('function',);
    },);

    it('exports a well-formed registry with no duplicates and no overlap', () => {
        // Deliberately NOT a route count. A hardcoded total goes stale the
        // moment a route is added, which makes the suite fail for a reason
        // that has nothing to do with the change under test. Coverage against
        // the live manifest is `npm run check:drift`, which compares both
        // directions and reports the gap BY NAME.
        const unique = new Set(ROUTE_COVERAGE,);
        expect(unique.size,).toBe(ROUTE_COVERAGE.length,); // no duplicates

        // A route in both sets means "we expose it" and "we deliberately
        // don't" at once — drift would then pass while the intent is broken.
        const allow = new Set(INTENTIONALLY_UNEXPOSED,);
        expect(ROUTE_COVERAGE.filter((r,) => allow.has(r,)),).toEqual([],);

        // Both sets must use the manifest's `"<METHOD> <absolutePath>"` form,
        // or an entry silently matches nothing during the drift check.
        const shape = /^(GET|POST|PUT|PATCH|DELETE|HEAD) \/\S*$/;
        const malformed = [...ROUTE_COVERAGE, ...INTENTIONALLY_UNEXPOSED,]
            .filter((r,) => !shape.test(r,));
        expect(malformed,).toEqual([],);
    },);
},);
