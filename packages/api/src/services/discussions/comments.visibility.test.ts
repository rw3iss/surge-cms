/** A4 — counters move ONLY when a comment enters or leaves `visible`. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const { adjust, onCountChange, } = vi.hoisted(() => ({ adjust: vi.fn(), onCountChange: vi.fn(), }),);
vi.mock('../../db', () => ({ query: vi.fn(), transaction: vi.fn(async (fn: (c: unknown,) => unknown,) => fn(fakeClient,),), }),);
vi.mock('../permissions', () => ({ can: vi.fn(), }),);
vi.mock('./activity', () => ({ adjust: (...a: unknown[]) => adjust(...a,), }),);
vi.mock('./events', () => ({ emitDiscussionEvent: vi.fn(), }),);
vi.mock('./settings', () => ({ getSettings: vi.fn(), }),);
vi.mock('./spam', () => ({ checkWriteRate: vi.fn(), countLinks: () => 0, }),);
vi.mock('./targets', () => ({
    getTarget: async () => ({ activityKind: () => 'comments', onCountChange: (...a: unknown[]) => onCountChange(...a,), }),
    parseTarget: vi.fn(),
}),);
vi.mock('./viewer', () => ({ isModerator: vi.fn(), }),);

let current: Record<string, unknown>;
const updates: unknown[][] = [];
const fakeClient = {
    query: vi.fn(async (sql: string, params: unknown[],) => {
        if (sql.startsWith('SELECT * FROM comments',)) return { rows: [{ ...current, },], };
        if (sql.startsWith('UPDATE comments SET status',)) {
            current = { ...current, status: params[1], };
            return { rows: [{ ...current, },], };
        }
        updates.push([sql, params,],);
        return { rows: [], };
    },),
};

import { setStatus, } from './comments';

const base = { id: 'c1', target_type: 'post', target_id: 'p1', parent_id: 'parent', author_id: 'a1', is_opening: false, created_at: new Date(), };

beforeEach(() => { adjust.mockReset(); onCountChange.mockReset(); updates.length = 0; fakeClient.query.mockClear(); },);

describe('setStatus counter deltas', () => {
    it.each([
        ['visible', 'hidden', -1,],
        ['visible', 'deleted', -1,],
        ['pending', 'visible', 1,],
        ['hidden', 'visible', 1,],
    ] as const,)('%s → %s moves counters by %i', async (from, to, delta,) => {
        current = { ...base, status: from, };
        await setStatus('c1', to,);
        expect(adjust,).toHaveBeenCalledWith(fakeClient, 'a1', 'comments', delta,);
        expect(onCountChange,).toHaveBeenCalledWith(fakeClient, 'p1', delta, expect.anything(),);
        expect(updates.some(([sql, p,],) => String(sql,).includes('reply_count',) && (p as unknown[])[1] === delta),).toBe(true,);
    },);
    it.each([
        ['pending', 'hidden',],
        ['hidden', 'deleted',],
        ['visible', 'visible',],
    ] as const,)('%s → %s leaves counters alone', async (from, to,) => {
        current = { ...base, status: from, };
        await setStatus('c1', to,);
        expect(adjust,).not.toHaveBeenCalled();
        expect(onCountChange,).not.toHaveBeenCalled();
    },);
    it('runs inside a caller-supplied client (A3)', async () => {
        current = { ...base, status: 'visible', };
        const other = { query: fakeClient.query, };
        await setStatus('c1', 'hidden', other as never,);
        expect(adjust,).toHaveBeenCalledWith(other, 'a1', 'comments', -1,);
    },);
},);
