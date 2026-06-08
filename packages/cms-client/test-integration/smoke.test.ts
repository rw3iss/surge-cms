/**
 * Integration smoke test — exercises the BUILT client against a REAL,
 * running API. This is NOT part of the unit suite (`npm test`); it lives
 * outside `src/` so the unit vitest config (include: ['src/** /*.test.ts'])
 * never picks it up. Run it manually with its own config:
 *
 *     npm run test:integration -w packages/cms-client
 *
 * Prerequisites (the run is skipped when SMOKE_API_KEY is unset, so CI with
 * no live server stays green):
 *   1. A SiteSurge API listening on http://localhost:3101.
 *   2. An admin-scoped API key seeded in `api_keys`, its plaintext passed via
 *      the SMOKE_API_KEY env var.
 *
 * See README.md ("Integration smoke test") for the full boot/seed/teardown
 * recipe. The plan's Task 18 documents the one-shot manual procedure.
 */
import { describe, expect, it, } from 'vitest';
import { createClient, NotFoundError, } from '../src/index';

const BASE_URL = 'http://localhost:3101';
const apiKey = process.env.SMOKE_API_KEY;

describe.skipIf(!apiKey,)('integration smoke (live API @ 3101)', () => {
    it('lists posts (admin via key), serves the second list from cache, probes health, and maps a 404 to NotFoundError', async () => {
        // Spy fetch: count every real network call so we can prove the cache
        // collapses two identical reads into one HTTP request.
        let networkCalls = 0;
        const countingFetch: typeof fetch = (input, init,) => {
            networkCalls += 1;
            return globalThis.fetch(input, init,);
        };

        const cms = createClient({
            baseUrl: BASE_URL,
            auth: { apiKey, },
            cache: { adapter: 'memory', },   // Node has no IndexedDB
            fetch: countingFetch,
        },);

        // 1) Admin list (status:'all' switches the backend to all-statuses).
        const first = await cms.posts.list({ status: 'all', },);
        expect(Array.isArray(first,),).toBe(true,);
        expect(networkCalls,).toBe(1,);

        // 2) Identical read → served from cache, NO second network call.
        const second = await cms.posts.list({ status: 'all', },);
        expect(Array.isArray(second,),).toBe(true,);
        expect(second,).toEqual(first,);
        expect(networkCalls,).toBe(1,);   // still one — cache hit

        // 3) Liveness probe works (cache:false, so it adds a network call).
        const callsBeforeHealth = networkCalls;
        const live = await cms.health.live();
        expect(live,).toBeTruthy();
        expect(networkCalls,).toBe(callsBeforeHealth + 1,);

        // 4) Error path: a non-existent post id → typed NotFoundError.
        await expect(
            cms.posts.getById('00000000-0000-0000-0000-000000000000',),
        ).rejects.toBeInstanceOf(NotFoundError,);
    }, 20_000,);
},);
