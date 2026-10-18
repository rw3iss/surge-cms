import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../db', () => ({ query: vi.fn(), }),);

import { authorColumns, COMMENT_COLUMNS, type CommentRow, ENTITLED_SQL, mapComment, } from './rows';

const row = (over: Partial<CommentRow> = {},): CommentRow => ({
    id: 'c1', target_type: 'post', target_id: 'p1', parent_id: null, root_id: null, depth: 0,
    author_id: 'author', guest_name: null, guest_email: null, guest_ip: null, body: 'secret words',
    status: 'visible', is_opening: false, edited_at: null, edit_count: 0, reaction_counts: {}, reply_count: 0,
    created_at: new Date(), updated_at: new Date(), ...over,
});

describe('mapComment fails closed (A6)', () => {
    it('shows a visible comment body to anyone', () => {
        expect(mapComment(row(),).bodyHtml,).toContain('secret',);
    },);
    it('blanks hidden and pending bodies for other viewers even when the query let them through', () => {
        for (const status of ['hidden', 'pending',] as const) {
            const c = mapComment(row({ status, },), { viewerId: 'someone-else', },);
            expect(c.bodyHtml,).toBeNull();
            expect(c.body,).toBeNull();
        }
    },);
    it('shows the author their own pending comment, and moderators everything', () => {
        expect(mapComment(row({ status: 'pending', },), { viewerId: 'author', },).bodyHtml,).toContain('secret',);
        expect(mapComment(row({ status: 'hidden', },), { moderator: true, },).bodyHtml,).toContain('secret',);
        expect(mapComment(row({ status: 'deleted', },), { moderator: true, },).bodyHtml,).toContain('secret',);
    },);
    it('keeps a deleted comment blank for its author', () => {
        expect(mapComment(row({ status: 'deleted', },), { viewerId: 'author', },).bodyHtml,).toBeNull();
    },);
},);

describe('author columns (A7)', () => {
    it('builds the entitled array from ENTITLED_STATUSES', () => {
        expect(ENTITLED_SQL,).toBe(`ARRAY['active','trialing','past_due']`,);
    },);
    it('binds the tier subquery to the given author column', () => {
        expect(authorColumns('t.author_id',),).toContain('s.user_id = t.author_id',);
        expect(COMMENT_COLUMNS,).toContain('s.user_id = c.author_id',);
    },);
},);
