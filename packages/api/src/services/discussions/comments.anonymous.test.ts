/** Guest comments: the anonymous permission is the TARGET's (forum threads use `forum:post_anonymous`). */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const { can, target, } = vi.hoisted(() => ({ can: vi.fn(), target: { current: {} as Record<string, unknown>, }, }),);
vi.mock('../../db', () => ({ query: vi.fn(async () => ({ rows: [], }),), transaction: vi.fn(), }),);
vi.mock('../permissions', () => ({ can: (...a: unknown[]) => can(...a,), }),);
vi.mock('./activity', () => ({ adjust: vi.fn(), }),);
vi.mock('./events', () => ({ emitDiscussionEvent: vi.fn(), }),);
vi.mock('./settings', () => ({ getSettings: async () => ({ maxLength: 5000, editWindowMinutes: 0, }), }),);
vi.mock('./spam', () => ({ checkWriteRate: vi.fn(), countLinks: () => 0, }),);
vi.mock('./targets', () => ({
    getTarget: async () => target.current,
    parseTarget: (ref: string,) => ({ type: ref.split(':',)[0], id: ref.split(':',)[1], }),
}),);
vi.mock('./viewer', () => ({ isModerator: async () => false, }),);

import { create, } from './comments';

const ANON = { id: null, role: null, };
const access = async () => ({ title: '', url: '', canRead: true, canComment: true, allowAnonymous: true, });

beforeEach(() => { can.mockReset(); },);

describe('guest comment permission', () => {
    it('defaults to comments:anonymous', async () => {
        target.current = { type: 'post', access, };
        can.mockResolvedValue(false,);
        await expect(create({ target: 'post:x', body: 'hi', website: 'bot', } as never, ANON,),).rejects.toThrow(/Sign in/,);
        expect(can,).toHaveBeenCalledWith(ANON, 'comments:anonymous',);
    },);
    it('uses the target\'s own key (forum threads: forum:post_anonymous)', async () => {
        target.current = { type: 'forum_thread', access, anonymousPermission: 'forum:post_anonymous', };
        can.mockImplementation(async (_v: unknown, key: string,) => key === 'forum:post_anonymous',);
        // Honeypot filled → answered as held, nothing stored; proves the permission gate passed.
        const c = await create({ target: 'forum_thread:x', body: 'hi', website: 'bot', } as never, ANON,);
        expect(c.status,).toBe('pending',);
        expect(can,).toHaveBeenCalledWith(ANON, 'forum:post_anonymous',);
    },);
},);
