/** A4 — the forum's pure access floors (levels × settings × category). */
import { describe, expect, it, vi, } from 'vitest';
import type { ForumSettings, } from '@sitesurge/types';

vi.mock('../access/level', () => ({ viewerLevel: vi.fn(), }),);

import { canPostCategory, canReadCategory, canReplyCategory, forumReadFloor, type CategoryRanks, } from './access';

const ANON = -1, FREE = 0, SUB = 2, STAFF = Infinity;
const settings = (over: Partial<ForumSettings> = {},): ForumSettings =>
    ({ readAccess: 'public', readMinRank: 0, threadMinRank: 0, replyMinRank: 0, ...over, }) as ForumSettings;
const cat = (over: Partial<CategoryRanks> = {},): CategoryRanks => ({ read_min_rank: null, post_min_rank: null, locked: false, ...over, });

describe('forumReadFloor', () => {
    it('maps public / members / tier', () => {
        expect(forumReadFloor(settings({ readAccess: 'public', },),),).toBe(-1,);
        expect(forumReadFloor(settings({ readAccess: 'members', },),),).toBe(0,);
        expect(forumReadFloor(settings({ readAccess: 'tier' as never, readMinRank: 3, },),),).toBe(3,);
    },);
},);

describe('canReadCategory', () => {
    it.each([
        ['public forum, open category', settings(), cat(), [true, true, true, true,],],
        ['members forum', settings({ readAccess: 'members', },), cat(), [false, true, true, true,],],
        ['subscriber category (rank 2)', settings(), cat({ read_min_rank: 2, },), [false, false, true, true,],],
        ['tier forum rank 3', settings({ readAccess: 'tier' as never, readMinRank: 3, },), cat(), [false, false, false, true,],],
    ] as const,)('%s', (_n, s, c, expected,) => {
        expect([ANON, FREE, SUB, STAFF,].map((l,) => canReadCategory(l, s, c,)),).toEqual(expected,);
    },);
},);

describe('canPostCategory / canReplyCategory', () => {
    it('anonymous never posts or replies, staff always do', () => {
        expect(canPostCategory(ANON, settings(), cat(),),).toBe(false,);
        expect(canReplyCategory(ANON, settings(), cat(),),).toBe(false,);
        expect(canPostCategory(STAFF, settings(), cat({ locked: true, read_min_rank: 99, },),),).toBe(true,);
        expect(canReplyCategory(STAFF, settings(), cat({ locked: true, },),),).toBe(true,);
    },);
    it('a locked category refuses every non-staff level', () => {
        expect(canPostCategory(SUB, settings(), cat({ locked: true, },),),).toBe(false,);
        expect(canReplyCategory(SUB, settings(), cat({ locked: true, },),),).toBe(false,);
    },);
    it('thread and reply minimums apply separately, with the category post floor', () => {
        const s = settings({ threadMinRank: 2, replyMinRank: 0, },);
        expect(canPostCategory(FREE, s, cat(),),).toBe(false,);
        expect(canReplyCategory(FREE, s, cat(),),).toBe(true,);
        expect(canPostCategory(SUB, s, cat(),),).toBe(true,);
        expect(canReplyCategory(FREE, s, cat({ post_min_rank: 2, },),),).toBe(false,);
    },);
    it('you cannot post where you cannot read', () => {
        expect(canReplyCategory(FREE, settings(), cat({ read_min_rank: 2, },),),).toBe(false,);
    },);
},);
