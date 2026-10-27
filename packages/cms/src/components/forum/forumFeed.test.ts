import { describe, expect, it, } from 'vitest';
import {
    appendPage, clipText, countLabel, displayOrder, hasMorePages, isNearBottom, mergeById, pollIntervalMs, postAccess, replyAccess, someoneTyping,
} from './forumFeed';

const r = (id: string, v = 0,) => ({ id, v, });

describe('mergeById', () => {
    it('puts the fresh page first and keeps older rows after it', () => {
        const { items, added, } = mergeById([r('a',), r('b',), r('c',),], [r('d',), r('a', 1,),],);
        expect(items.map((x,) => x.id),).toEqual(['d', 'a', 'b', 'c',],);
        expect(items[1].v,).toBe(1,); // the fresh copy wins
        expect(added,).toEqual(['d',],);
    },);
    it('moves a bumped row to its new position without duplicating it', () => {
        const { items, added, } = mergeById([r('a',), r('b',), r('c',),], [r('c',), r('a',), r('b',),],);
        expect(items.map((x,) => x.id),).toEqual(['c', 'a', 'b',],);
        expect(added,).toEqual([],);
    },);
    it('treats everything as new on an empty list', () => {
        expect(mergeById([], [r('x',),],).added,).toEqual(['x',],);
    },);
},);

describe('appendPage', () => {
    it('skips rows already shown', () => {
        expect(appendPage([r('a',), r('b',),], [r('b',), r('c',),],).map((x,) => x.id),).toEqual(['a', 'b', 'c',],);
    },);
},);

describe('displayOrder', () => {
    it('reverses for chat order without mutating', () => {
        const list = [1, 2, 3,];
        expect(displayOrder(list, true,),).toEqual([3, 2, 1,],);
        expect(list,).toEqual([1, 2, 3,],);
        expect(displayOrder(list, false,),).toEqual([1, 2, 3,],);
    },);
},);

describe('hasMorePages', () => {
    it('compares the loaded pages with the total', () => {
        expect(hasMorePages(1, 20, 21,),).toBe(true,);
        expect(hasMorePages(1, 20, 20,),).toBe(false,);
        expect(hasMorePages(2, 20, 40,),).toBe(false,);
    },);
},);

describe('clipText', () => {
    it('keeps short text and collapses whitespace', () => {
        expect(clipText('  hello\n  world ', 50,),).toBe('hello world',);
    },);
    it('cuts at a word boundary with an ellipsis', () => {
        expect(clipText('The quick brown fox jumps over the lazy dog', 20,),).toBe('The quick brown fox…',);
    },);
    it('cuts a long word hard', () => {
        expect(clipText('abcdefghijklmnopqrstuvwxyz', 10,),).toBe('abcdefghij…',);
    },);
    it('handles nothing', () => {
        expect(clipText(null, 10,),).toBe('',);
    },);
},);

describe('isNearBottom', () => {
    it('is true within the threshold', () => {
        expect(isNearBottom(900, 1000, 60,),).toBe(true,);
        expect(isNearBottom(500, 1000, 60,),).toBe(false,);
        expect(isNearBottom(0, 100, 200,),).toBe(true,); // no overflow
    },);
},);

describe('someoneTyping', () => {
    it('counts focus or text, never the honeypot', () => {
        expect(someoneTyping([{ focused: false, value: '', },],),).toBe(false,);
        expect(someoneTyping([{ focused: true, value: '', },],),).toBe(true,);
        expect(someoneTyping([{ focused: false, value: 'hi', },],),).toBe(true,);
        expect(someoneTyping([{ focused: false, value: 'spam', name: 'website', },],),).toBe(false,);
    },);
},);

describe('labels + interval', () => {
    it('pluralizes', () => {
        expect(countLabel(1, 'reply', 'replies',),).toBe('1 reply',);
        expect(countLabel(0, 'reply', 'replies',),).toBe('0 replies',);
    },);
    it('clamps the poll interval', () => {
        expect(pollIntervalMs(5,),).toBe(10_000,);
        expect(pollIntervalMs(20,),).toBe(20_000,);
        expect(pollIntervalMs(9999,),).toBe(300_000,);
        expect(pollIntervalMs(Number.NaN,),).toBe(20_000,);
    },);
},);

describe('replyAccess', () => {
    it('follows the thread for members', () => {
        expect(replyAccess({ locked: false, canReply: true, }, true, false,),).toBe('write',);
        expect(replyAccess({ locked: false, canReply: false, }, true, false,),).toBe(null,);
    },);
    it('asks a visitor to log in unless guests may write', () => {
        expect(replyAccess({ locked: false, canReply: false, }, false, false,),).toBe('login',);
        expect(replyAccess({ locked: false, canReply: false, }, false, true,),).toBe('write',);
    },);
    it('never offers a locked thread', () => {
        expect(replyAccess({ locked: true, canReply: true, }, true, true,),).toBe(null,);
    },);
},);

describe('postAccess', () => {
    const target = (canPost: boolean, anonymous: boolean,) => ({ canPost, anonymous, });
    it('needs a target', () => {
        expect(postAccess(null, true, true,),).toBe('none',);
    },);
    it('members write or are blocked', () => {
        expect(postAccess(target(true, false,), true, false,),).toBe('write',);
        expect(postAccess(target(false, false,), true, false,),).toBe('blocked',);
    },);
    it('guests write only when the block AND the forum allow it', () => {
        expect(postAccess(target(false, true,), false, true,),).toBe('write',);
        expect(postAccess(target(false, true,), false, false,),).toBe('login',);
        expect(postAccess(target(false, false,), false, true,),).toBe('login',);
    },);
},);
