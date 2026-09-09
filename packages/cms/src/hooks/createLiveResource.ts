import { createResource, onCleanup, } from 'solid-js';
import { cms, } from '../services/cmsClient';

/**
 * `createSafeResource`, but it also listens for the SDK's background refresh.
 *
 * WHY THIS EXISTS: the client cache is stale-while-revalidate. `cache.read()`
 * hands back an expired entry IMMEDIATELY and refetches behind it, so a GET
 * resolves with data that may already be wrong. `createResource` awaits that
 * one promise and is then finished — the fresher value lands in the cache and
 * the component never hears about it. The UI keeps rendering the stale answer
 * until something unrelated remounts it.
 *
 * That is invisible for a value you display (a slightly old price corrects
 * itself next navigation) and a real bug for a value you BRANCH on: a `<Show>`
 * fed by a stale flag omits a whole feature, and no amount of waiting brings it
 * back. The shop's "new merchandise" tout disappeared this way — the cached
 * entry said the tout was off, the server said it was on, and the refresh
 * arrived milliseconds after the decision to render nothing.
 *
 * The default GET ttl is 30s (`DEFAULT_TTL.list`), so on any page opened more
 * than half a minute after the last one, the first render is built on stale
 * data. It is only ever *visibly* wrong when the value changed in the meantime,
 * which is exactly why the symptom looks intermittent and unreproducible.
 *
 * `cms.subscribe` fires only when a revalidation produces a value that differs
 * from the one handed out, so a steady value costs one no-op listener and no
 * re-render.
 *
 * @param source Cache coordinates of the underlying GET: the SDK module name
 *   and the request path, which together form the cache key
 *   (`<ns>:<module>:<path>:<args>`). `args` is the request's query object, or
 *   omitted when it has none.
 * @param fetcher The SDK call.
 * @param fallback Returned if the call throws — these are non-critical reads
 *   whose failures surface through the client's global error bus.
 */
export function createLiveResource<T>(
    source: { module: string; path: string; args?: unknown; },
    fetcher: () => Promise<T>,
    fallback: T,
) {
    const [resource, { mutate, },] = createResource<T>(async () => {
        try {
            return await fetcher();
        } catch {
            return fallback;
        }
    },);

    // The updater form, rather than `mutate(value)`: Solid treats a bare
    // function argument as an updater, so passing a callable T directly would
    // be called instead of stored.
    onCleanup(
        cms.subscribe<T>(source.module, source.path, source.args ?? null, (value,) => {
            mutate(() => value,);
        },),
    );

    return resource;
}
