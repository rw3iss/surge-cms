/**
 * The client cache is stale-while-revalidate, so a GET can resolve with an
 * expired value and refresh behind it. A plain `createResource` awaits that one
 * promise and never hears the refresh — harmless for a value you print, a bug
 * for one you branch on. The shop's merchandise tout vanished exactly this way:
 * the cached flag said "off", the server said "on", and the `<Show>` had already
 * decided.
 *
 * The subscription arguments are the fragile part. They must reproduce the cache
 * key the SDK derived for the original request (`<ns>:<module>:<path>:<args>`);
 * get the module or path wrong and `subscribe` is simply never called back, the
 * hook degrades silently to the broken behaviour, and nothing fails. Hence the
 * assertions on the exact arguments.
 */
import { createRoot, } from 'solid-js';
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const subscribe = vi.fn();
const unsubscribe = vi.fn();

vi.mock('../services/cmsClient', () => ({
    cms: { subscribe: (...args: unknown[]) => subscribe(...args,), },
}),);

const { createLiveResource, } = await import('./createLiveResource');

/** Let the resource's fetcher settle. */
const settle = () => new Promise((r,) => setTimeout(r, 0,),);

beforeEach(() => {
    subscribe.mockReset().mockReturnValue(unsubscribe,);
    unsubscribe.mockReset();
},);

describe('createLiveResource', () => {
    it('adopts the refreshed value when the cache revalidates', async () => {
        await createRoot(async (dispose,) => {
            const res = createLiveResource(
                { module: 'shop', path: '/shop/settings', },
                async () => ({ settings: { merchandiseSignupEnabled: false, }, }),
                null as { settings: { merchandiseSignupEnabled: boolean; }; } | null,
            );
            await settle();

            // The stale answer the component first renders — tout hidden.
            expect(res()?.settings.merchandiseSignupEnabled,).toBe(false,);

            // The background refresh lands. Without the subscription this value
            // reaches the cache and nothing else.
            const push = subscribe.mock.calls[0]![3] as (v: unknown,) => void;
            push({ settings: { merchandiseSignupEnabled: true, }, },);

            expect(res()?.settings.merchandiseSignupEnabled,).toBe(true,);
            dispose();
        },);
    },);

    it('subscribes with the arguments that rebuild the request cache key', async () => {
        await createRoot(async (dispose,) => {
            createLiveResource(
                { module: 'shop', path: '/shop/settings', },
                async () => 1,
                0,
            );
            await settle();
            const [module, path, args,] = subscribe.mock.calls[0]!;
            expect(module,).toBe('shop',);
            expect(path,).toBe('/shop/settings',);
            // A GET with no query caches under `null`, not `undefined` — the key
            // builder stringifies it, so the two are different keys.
            expect(args,).toBeNull();
            dispose();
        },);
    },);

    it('passes an explicit query through as the cache args', async () => {
        await createRoot(async (dispose,) => {
            createLiveResource(
                { module: 'posts', path: '/posts', args: { page: 2, }, },
                async () => [],
                [],
            );
            await settle();
            expect(subscribe.mock.calls[0]![2],).toEqual({ page: 2, },);
            dispose();
        },);
    },);

    it('falls back instead of throwing when the fetch fails', async () => {
        await createRoot(async (dispose,) => {
            const res = createLiveResource(
                { module: 'shop', path: '/shop/settings', },
                async () => { throw new Error('offline',); },
                'fallback',
            );
            await settle();
            expect(res(),).toBe('fallback',);
            dispose();
        },);
    },);

    it('unsubscribes on dispose so a navigated-away page stops updating', async () => {
        await createRoot(async (dispose,) => {
            createLiveResource({ module: 'shop', path: '/shop/settings', }, async () => 1, 0,);
            await settle();
            expect(unsubscribe,).not.toHaveBeenCalled();
            dispose();
            expect(unsubscribe,).toHaveBeenCalledTimes(1,);
        },);
    },);
},);
