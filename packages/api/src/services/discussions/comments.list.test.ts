/** P3 — replies capped per root (+ hiddenReplies), orphans hang off the root, settings read once. */
import { describe, expect, it, vi, } from 'vitest';

const h = vi.hoisted(() => ({ sql: [] as string[], settingsReads: 0, getRow: null as Record<string, unknown> | null, }),);
const ROOT = '11111111-1111-4111-8111-111111111111';
const row = (id: string, over: Record<string, unknown> = {},) => ({
    id, target_type: 'post', target_id: 'p', parent_id: null, root_id: null, depth: 0, author_id: 'a', guest_name: null,
    guest_email: null, guest_ip: null, body: 'b', status: 'visible', is_opening: false, edited_at: null, edit_count: 0,
    reaction_counts: {}, reply_count: 0, created_at: new Date(), updated_at: new Date(), ...over,
});
vi.mock('../../db', () => ({
    transaction: vi.fn(),
    query: vi.fn(async (sql: string,) => {
        h.sql.push(sql,);
        if (sql.includes('COUNT(*)::int AS n')) return { rows: [{ n: 1, },], };
        if (sql.includes('ROW_NUMBER()')) {
            return { rows: [
                // parent 'gone' is outside the newest-N window
                { ...row('r2', { parent_id: 'gone', root_id: ROOT, depth: 2, },), rn: 1, root_total: 60, },
                { ...row('r1', { parent_id: ROOT, root_id: ROOT, depth: 1, },), rn: 2, root_total: 60, },
            ], };
        }
        if (sql.includes('comment_reactions')) return { rows: [], };
        if (sql.includes('WHERE c.id = $1') && h.getRow) return { rows: [h.getRow,], };
        return { rows: [row(ROOT,),], };
    },),
}),);
vi.mock('../permissions', () => ({ can: vi.fn(async () => true,), }),);
vi.mock('./activity', () => ({ adjust: vi.fn(), }),);
vi.mock('./events', () => ({ emitDiscussionEvent: vi.fn(), }),);
vi.mock('./settings', () => ({ getSettings: vi.fn(async () => { h.settingsReads++; return { editWindowMinutes: 15, }; },), }),);
vi.mock('./spam', () => ({ checkWriteRate: vi.fn(), countLinks: () => 0, }),);
vi.mock('./targets', () => ({
    parseTarget: () => ({ type: 'post', id: 'p', }),
    getTarget: async () => ({ type: 'post', access: async () => ({ canRead: true, }), }),
}),);
vi.mock('./viewer', () => ({ isModerator: vi.fn(async () => false,), }),);

import { list, locate, REPLIES_PER_ROOT, } from './comments';

describe('comments.list', () => {
    it('keeps the newest replies per root and counts the rest', async () => {
        const r = await list('post:p', { id: 'v1', },);
        expect(h.sql.some((s,) => s.includes(`x.rn <= ${REPLIES_PER_ROOT}`,)),).toBe(true,);
        expect(r.items[0].hiddenReplies,).toBe(60 - REPLIES_PER_ROOT,);
        expect(r.items[0].replies?.map((c,) => c.id).sort(),).toEqual(['r1', 'r2',],);
        expect(h.settingsReads,).toBe(1,);
    },);

    it('locate (F1) answers a reply\'s root, and hides a comment the viewer may not see', async () => {
        const REPLY = '22222222-2222-4222-8222-222222222222';
        h.getRow = row(REPLY, { parent_id: ROOT, root_id: ROOT, },);
        expect(await locate(REPLY, { id: 'v1', },),).toEqual({ id: REPLY, rootId: ROOT, target: 'post:p', },);
        h.getRow = row(REPLY, { status: 'hidden', },);
        await expect(locate(REPLY, { id: 'v1', },),).rejects.toThrow();
        h.getRow = null;
    },);
},);
