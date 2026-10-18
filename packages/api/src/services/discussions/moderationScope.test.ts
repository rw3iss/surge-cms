/** S10 — a `forum:moderate`-only role can work the queue, for forum rows only. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const h = vi.hoisted(() => ({ perms: new Set<string>(), row: null as Record<string, unknown> | null, sql: [] as string[], }),);
vi.mock('../../db', () => ({
    query: vi.fn(async (sql: string,) => {
        h.sql.push(sql,);
        if (sql.includes('COUNT(*)::int AS n')) return { rows: [{ n: 0, },], };
        if (sql.includes('AS pending')) return { rows: [{ pending: 1, reported: 0, },], };
        return { rows: [], };
    },),
}),);
vi.mock('../permissions', () => ({ can: vi.fn(async (_v: unknown, key: string,) => h.perms.has(key,)), }),);
vi.mock('./viewer', () => ({ isModerator: vi.fn(async () => h.perms.has('discussions:moderate',)), }),);
vi.mock('./comments', () => ({
    getRow: vi.fn(async () => h.row),
    mapForViewer: vi.fn(async () => []),
    setStatus: vi.fn(async () => ({ after: { ...h.row, status: 'hidden', }, }),),
}),);
vi.mock('./events', () => ({ emitDiscussionEvent: vi.fn(), }),);
vi.mock('./settings', () => ({ getSettings: vi.fn(), }),);
vi.mock('./spam', () => ({ rateLimit: vi.fn(), }),);
vi.mock('./targets', () => ({ findTarget: vi.fn(), getTarget: vi.fn(), parseTarget: vi.fn(), }),);

import { act, counts, list, moderationScope, } from './moderation';

const viewer = { id: 'u1', role: 'member', };
beforeEach(() => { h.perms = new Set(); h.row = null; h.sql = []; },);

describe('moderation scope', () => {
    it('refuses a viewer with neither permission', async () => {
        await expect(moderationScope(viewer,),).rejects.toThrow();
    },);
    it('forum:moderate alone gives the forum scope', async () => {
        h.perms.add('forum:moderate',);
        expect(await moderationScope(viewer,),).toBe('forum',);
        h.perms.add('discussions:moderate',);
        expect(await moderationScope(viewer,),).toBe('all',);
    },);
    it('a forum moderator lists and counts forum rows only', async () => {
        h.perms.add('forum:moderate',);
        await list({ scope: 'comments', } as never, viewer,);
        expect(h.sql.some((s,) => s.includes("c.target_type = 'forum_thread'",)),).toBe(true,);
        h.sql = [];
        await counts(viewer, 'all',);
        expect(h.sql[0],).toContain("c.target_type = 'forum_thread'",);
    },);
    it('a forum moderator can act on a forum reply but not a post comment', async () => {
        h.perms.add('forum:moderate',);
        h.row = { id: 'c1', target_type: 'forum_thread', status: 'visible', };
        await expect(act('c1', 'hide', viewer,),).resolves.toMatchObject({ status: 'hidden', },);
        h.row = { id: 'c2', target_type: 'post', status: 'visible', };
        await expect(act('c2', 'hide', viewer,),).rejects.toThrow();
    },);
},);
