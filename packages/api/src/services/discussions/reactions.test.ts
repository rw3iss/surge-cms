/** S12 — reactions are rate-limited, and a toggle does not flush every feed cache. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const { rateLimit, invalidate, listeners, } = vi.hoisted(() => ({
    rateLimit: vi.fn(),
    invalidate: vi.fn(),
    listeners: [] as ((e: { type: string; },) => unknown)[],
}),);
vi.mock('../../db', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0, }),), transaction: vi.fn(), }),);
vi.mock('../permissions', () => ({ can: vi.fn(async () => true,), }),);
vi.mock('./settings', () => ({ getSettings: async () => ({ reactionsEnabled: true, reactions: ['like',], }), }),);
vi.mock('./spam', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a,), checkWriteRate: vi.fn(), countLinks: () => 0, }),);
vi.mock('./comments', () => ({ getRow: vi.fn(async () => ({ id: 'c1', status: 'visible', target_type: 'post', target_id: 'p1', }),), mapForViewer: vi.fn(), setStatus: vi.fn(), }),);
vi.mock('./targets', () => ({ getTarget: async () => ({ access: async () => ({ canRead: true, }), }), findTarget: vi.fn(), parseTarget: vi.fn(), allTargets: () => [], }),);
vi.mock('./events', () => ({ emitDiscussionEvent: vi.fn(), onDiscussionEvent: (fn: never,) => listeners.push(fn,), }),);
vi.mock('../cache', () => ({ cache: { invalidateDiscussionFeedCache: (...a: unknown[]) => invalidate(...a,), }, CACHE_KEYS: {}, }),);

import { react, REACT_LIMIT_PER_MINUTE, } from './moderation';
import './query';

beforeEach(() => { rateLimit.mockReset(); invalidate.mockReset(); },);

describe('reactions (S12)', () => {
    it('react() goes through a per-user rate limit', async () => {
        await react('c1', 'like', { id: 'u1', role: 'member', } as never,);
        expect(rateLimit,).toHaveBeenCalledWith('u:u1:react', REACT_LIMIT_PER_MINUTE, 60,);
    },);
    it('a reaction does not invalidate the discovery feeds; other events do', async () => {
        for (const l of listeners) await l({ type: 'reacted', },);
        expect(invalidate,).not.toHaveBeenCalled();
        for (const l of listeners) await l({ type: 'created', },);
        expect(invalidate,).toHaveBeenCalled();
    },);
},);
