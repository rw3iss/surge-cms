/** P1: comment-target summaries resolve every id in ONE list call (no per-id get). */
import { describe, expect, it, vi, } from 'vitest';

const m = vi.hoisted(() => ({ registered: null as null | { summaries: (ids: string[],) => Promise<Map<string, unknown>>; }, list: vi.fn(), get: vi.fn(), }),);
vi.mock('../discussions/targets', () => ({ registerCommentTarget: (t: never,) => { m.registered = t; }, }),);
vi.mock('../discussions/viewer', () => ({ isStaffViewer: () => false, }),);
vi.mock('../comments/settings', () => ({ getSettings: async () => ({}), }),);
vi.mock('../comments/threads', () => ({}),);
vi.mock('../settings', () => ({ isFeatureEnabledServer: async () => true, }),);
vi.mock('./items', () => ({ get: m.get, list: m.list, }),);
vi.mock('./settings', () => ({ getSettings: async () => ({}), }),);

await import('./targets');

describe('gallery_item summaries', () => {
    it('one list call for many ids, deduped, admin audience', async () => {
        m.list.mockResolvedValue({ items: [{ id: 'a', title: 'A', url: '/gallery/a', }, { id: 'b', title: '', url: '/gallery/b', },], },);
        const out = await m.registered!.summaries(['a', 'b', 'a',],);
        expect(m.list,).toHaveBeenCalledTimes(1,);
        expect(m.list,).toHaveBeenCalledWith({ ids: ['a', 'b',], limit: 2, }, { audience: 'admin', },);
        expect(m.get,).not.toHaveBeenCalled();
        expect(out.get('b',),).toEqual({ title: 'Gallery item', url: '/gallery/b', },);
    });
});
