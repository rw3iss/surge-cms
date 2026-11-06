import { beforeEach, describe, expect, it, vi, } from 'vitest';

const st = vi.hoisted(() => ({ claimed: 1, updates: 0, released: 0, }),);
vi.mock('../db', () => ({
    query: vi.fn(async (sql: string,) => {
        if (/SELECT id, title, slug, status, author_id FROM posts/.test(sql,)) {
            return { rows: [{ id: 'p1', title: 'T', slug: 't', status: 'pending_review', author_id: null, },], rowCount: 1, };
        }
        if (/SET reviewed_by = \$2, reviewed_at = NOW\(\)\s+WHERE/.test(sql,)) return { rows: [], rowCount: st.claimed, };
        if (/reviewed_at = NULL/.test(sql,)) { st.released++; return { rows: [], rowCount: 1, }; }
        return { rows: [], rowCount: 1, };
    },),
}),);
vi.mock('./permissions', () => ({ checkMode: vi.fn(async () => 'allow',), }),);
vi.mock('./posts', () => ({ update: vi.fn(async () => { st.updates++; return { id: 'p1', }; },), }),);
vi.mock('./mail/purposes', () => ({ sendPurposeMail: vi.fn(async () => {},), }),);
vi.mock('./notifications', () => ({}),);
vi.mock('./contributions/index.js', () => ({ onApproved: vi.fn(async () => false,), }),);

import * as posts from './posts';
import { review, } from './postReview';

const ctx = { userId: 'r1', } as never;

describe('review claim', () => {
    beforeEach(() => { st.claimed = 1; st.updates = 0; st.released = 0; },);
    it('approves once the claim is won', async () => {
        await review('p1', 'approve', undefined, { id: 'r1', role: 'editor', }, ctx,);
        expect(st.updates,).toBe(1,);
    },);
    it('a second reviewer at the same time is refused and changes nothing', async () => {
        st.claimed = 0;
        await expect(review('p1', 'return', 'x', { id: 'r2', role: 'editor', }, ctx,),).rejects.toThrow(/someone else/i,);
        expect(st.updates,).toBe(0,);
    },);
    it('a failed update releases the claim', async () => {
        vi.mocked(posts.update,).mockRejectedValueOnce(new Error('db down',),);
        await expect(review('p1', 'approve', undefined, { id: 'r1', role: 'editor', }, ctx,),).rejects.toThrow('db down',);
        expect(st.released,).toBe(1,);
    },);
},);
