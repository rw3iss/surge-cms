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

    it('exports a complete coverage registry (231 + 6 = 237 manifest routes)', () => {
        const unique = new Set(ROUTE_COVERAGE,);
        expect(unique.size,).toBe(ROUTE_COVERAGE.length,); // no duplicates
        expect(ROUTE_COVERAGE.length + INTENTIONALLY_UNEXPOSED.length,).toBe(237,);
    },);
},);
