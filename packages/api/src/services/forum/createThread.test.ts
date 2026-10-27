/** Starting a thread: optional title (derived), category by id or slug, guest posting gates, honeypot. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';
import { DEFAULT_DISCUSSIONS_SETTINGS, DEFAULT_FORUM_SETTINGS, } from '@sitesurge/types';

const { dbQuery, clientQuery, can, settings, checkWriteRate, } = vi.hoisted(() => ({
    dbQuery: vi.fn(),
    clientQuery: vi.fn(),
    can: vi.fn(),
    settings: { current: {} as Record<string, unknown>, },
    checkWriteRate: vi.fn(),
}),);

vi.mock('../../db', () => ({
    query: (...a: unknown[]) => dbQuery(...a,),
    transaction: async (fn: (c: unknown,) => unknown,) => fn({ query: (...a: unknown[]) => clientQuery(...a,), },),
}),);
vi.mock('../permissions', () => ({ can: (...a: unknown[]) => can(...a,), }),);
vi.mock('../cache', () => ({ getRedis: vi.fn(), }),);
vi.mock('../discussions/comments', () => ({
    applyVisibility: vi.fn(), getRow: async () => null, mapForViewer: async () => [], setStatus: vi.fn(),
}),);
vi.mock('../discussions/events', () => ({ emitDiscussionEvent: vi.fn(), }),);
vi.mock('../discussions/settings', () => ({ getSettings: async () => DEFAULT_DISCUSSIONS_SETTINGS, }),);
vi.mock('../discussions/spam', () => ({ checkWriteRate: (...a: unknown[]) => checkWriteRate(...a,), countLinks: () => 0, }),);
vi.mock('../discussions/viewer', () => ({ isModerator: async () => false, isStaffViewer: () => false, }),);
vi.mock('../access/level', () => ({ viewerLevel: async (v: { id?: string | null; },) => (v.id ? 0 : -1), }),);
vi.mock('./settings', () => ({ getSettings: async () => ({ ...DEFAULT_FORUM_SETTINGS, ...settings.current, }), }),);

import { createThread, } from './forum';

const MEMBER = { id: '11111111-1111-4111-8111-111111111111', role: 'member', };
const ANON = { id: null, role: null, };
const CAT = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'talk', name: 'Talk', read_min_rank: null, post_min_rank: null, locked: false, };
const THREAD_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The thread INSERT's params. */
const threadInsert = () => clientQuery.mock.calls.find((c,) => String(c[0],).startsWith('INSERT INTO forum_threads',),)?.[1] as unknown[] | undefined;
const commentInsert = () => clientQuery.mock.calls.find((c,) => String(c[0],).includes('INSERT INTO comments',),)?.[1] as unknown[] | undefined;

beforeEach(() => {
    settings.current = {};
    can.mockReset();
    can.mockResolvedValue(true,);
    checkWriteRate.mockReset();
    dbQuery.mockReset();
    dbQuery.mockImplementation(async (sql: string, params: unknown[] = [],) => {
        if (sql.includes('FROM forum_categories fc',)) {
            return { rows: params[0] === CAT.id || params[0] === CAT.slug ? [CAT,] : [], };
        }
        if (sql.startsWith('SELECT display_name',)) return { rows: [{ display_name: 'Ann', },], };
        if (sql.includes('FROM forum_threads t',)) {
            return {
                rows: [{
                    id: THREAD_ID, category_id: CAT.id, slug: 's', title: 'T', author_id: null, status: 'pending', pinned: false, locked: false,
                    reply_count: 0, view_count: 0, last_reply_at: null, created_at: new Date(), updated_at: new Date(), c_slug: 'talk', c_name: 'Talk',
                    read_min_rank: null, post_min_rank: null, c_locked: false, o_guest_name: 'Guest', o_guest_email: null, o_guest_ip: '1.2.3.4',
                },],
            };
        }
        return { rows: [], };
    },);
    clientQuery.mockReset();
    clientQuery.mockImplementation(async (sql: string,) => {
        if (sql.startsWith('INSERT INTO forum_threads',)) return { rows: [{ id: THREAD_ID, },], };
        if (sql.includes('INSERT INTO comments',)) return { rows: [{ id: 'c1', status: 'visible', },], };
        return { rows: [], };
    },);
},);

describe('createThread', () => {
    it('derives the title from the first line when none is given; accepts a category slug', async () => {
        await createThread({ categoryId: 'talk', body: 'Is the meetup still on Friday?\nDetails please', }, MEMBER, '1.2.3.4',);
        const p = threadInsert()!;
        expect(p[0],).toBe(CAT.id,);
        expect(p[2],).toBe('Is the meetup still on Friday?',);
        expect(p[3],).toBe(MEMBER.id,);
    },);

    it('falls back to "Post by <name>" for a message too short to title', async () => {
        await createThread({ categoryId: CAT.id, title: '', body: 'hi', }, MEMBER, null,);
        expect(threadInsert()![2],).toBe('Post by Ann',);
    },);

    it('refuses guests while Allow anonymous posting is off', async () => {
        await expect(createThread({ categoryId: 'talk', body: 'hello there', }, ANON, '1.2.3.4',),).rejects.toThrow(/Sign in/,);
        expect(threadInsert(),).toBeUndefined();
    },);

    it('refuses guests without forum:post_anonymous', async () => {
        settings.current = { allowAnonymous: true, };
        can.mockImplementation(async (_v: unknown, key: string,) => key !== 'forum:post_anonymous',);
        await expect(createThread({ categoryId: 'talk', body: 'hello there', }, ANON, '1.2.3.4',),).rejects.toThrow(/Sign in/,);
    },);

    it('stores a guest thread with no author, the guest name on the opening post, pending while anonymousApproval is on', async () => {
        settings.current = { allowAnonymous: true, anonymousApproval: true, };
        const t = await createThread({ categoryId: 'talk', body: 'A guest question here', guestName: 'Visitor', }, ANON, '9.9.9.9',);
        const p = threadInsert()!;
        expect(p[3],).toBeNull();
        expect(p[4],).toBe('pending',);
        const c = commentInsert()!;
        expect(c.slice(1, 5,),).toEqual([null, 'Visitor', null, '9.9.9.9',],);
        expect(checkWriteRate,).toHaveBeenCalledWith(null, '9.9.9.9',);
        expect(t.status,).toBe('pending',);
    },);

    it('publishes a guest thread at once when anonymousApproval is off', async () => {
        settings.current = { allowAnonymous: true, anonymousApproval: false, };
        await createThread({ categoryId: 'talk', body: 'A guest question here', }, ANON, '9.9.9.9',);
        expect(threadInsert()![4],).toBe('visible',);
    },);

    it('honeypot: answers like a held post and stores nothing', async () => {
        settings.current = { allowAnonymous: true, };
        const t = await createThread({ categoryId: 'talk', body: 'Buy now', website: 'http://spam', }, ANON, '9.9.9.9',);
        expect(t.status,).toBe('pending',);
        expect(threadInsert(),).toBeUndefined();
    },);
},);
