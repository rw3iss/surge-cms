import { describe, expect, it, } from 'vitest';
import type { Comment, } from '@sitesurge/types';
import { countThread, layoutThread, } from './threadLayout';

const c = (id: string, name: string, replies: Comment[] = [],): Comment => ({
    id, targetType: 'post', targetId: 't', parentId: null, rootId: null, depth: 0,
    author: { id: id, name, handle: null, avatarUrl: null, role: null, tierName: null, activityCount: 0, joinedAt: null, isGuest: false, },
    body: null, bodyHtml: '', status: 'visible', isOpening: false, editedAt: null, editCount: 0, reactions: {}, myReactions: [],
    replyCount: replies.length, createdAt: '', canEdit: false, canDelete: false, replies,
});

describe('layoutThread', () => {
    it('indents replies in order', () => {
        const rows = layoutThread([c('a', 'A', [c('b', 'B', [c('c', 'C',),],),],), c('d', 'D',),],);
        expect(rows.map((r,) => [r.comment.id, r.indent,]),).toEqual([['a', 0,], ['b', 1,], ['c', 2,], ['d', 0,],],);
        expect(rows.every((r,) => r.replyingTo === null),).toBe(true,);
    },);

    it('caps the indent and names who a deep reply answers', () => {
        const deep = c('l0', 'L0', [c('l1', 'L1', [c('l2', 'L2', [c('l3', 'L3', [c('l4', 'L4', [c('l5', 'L5',),],),],),],),],),],);
        const rows = layoutThread([deep,],);
        expect(rows.map((r,) => r.indent),).toEqual([0, 1, 2, 3, 3, 3,],);
        expect(rows[3].replyingTo,).toBeNull();
        expect(rows[4].replyingTo,).toBe('L3',);
        expect(rows[5].replyingTo,).toBe('L4',);
    },);

    it('counts every comment in the tree', () => {
        expect(countThread([c('a', 'A', [c('b', 'B',), c('x', 'X',),],), c('d', 'D',),],),).toBe(4,);
    },);
},);
