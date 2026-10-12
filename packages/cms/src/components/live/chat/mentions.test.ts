import type { LiveChatMessage, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import {
    collectCandidates,
    insertMention,
    matchCandidates,
    mentionedNames,
    mentionQueryAt,
    mentionsMe,
    mentionToken,
    parseMentions,
} from './mentions';

const msg = (over: Partial<LiveChatMessage>,): LiveChatMessage => ({
    id: Math.random().toString(36,),
    userId: null,
    name: 'Guest',
    role: null,
    text: '',
    at: '2026-10-12T00:00:00Z',
    ...over,
});

describe('parseMentions', () => {
    it('splits text and mentions in order', () => {
        expect(parseMentions('hi @bob and @ann_b!',),).toEqual([
            { kind: 'text', value: 'hi ', },
            { kind: 'mention', value: '@bob', name: 'bob', },
            { kind: 'text', value: ' and ', },
            { kind: 'mention', value: '@ann_b', name: 'ann_b', },
            { kind: 'text', value: '!', },
        ],);
    });

    it('drops trailing punctuation from a mention', () => {
        expect(mentionedNames('thanks @bob.',),).toEqual(['bob',],);
        expect(parseMentions('thanks @bob.',).at(-1,),).toEqual({ kind: 'text', value: '.', },);
    });

    it('keeps dots inside a handle', () => {
        expect(mentionedNames('@j.doe hello',),).toEqual(['j.doe',],);
    });

    it('ignores email addresses and a lone @', () => {
        expect(mentionedNames('mail a@b.com or @ now',),).toEqual([],);
        expect(parseMentions('no mentions',),).toEqual([{ kind: 'text', value: 'no mentions', },],);
    });

    it('accepts a mention at the start', () => {
        expect(parseMentions('@sam',),).toEqual([{ kind: 'mention', value: '@sam', name: 'sam', },],);
    });
});

describe('mentionsMe', () => {
    it('matches by handle or by name without spaces, case-insensitive', () => {
        expect(mentionsMe('hey @Ryan_W', { handle: 'ryan_w', name: 'Ryan Weiss', },),).toBe(true,);
        expect(mentionsMe('hey @ryanweiss', { handle: 'rw', name: 'Ryan Weiss', },),).toBe(true,);
        expect(mentionsMe('hey @bob', { handle: 'rw', name: 'Ryan Weiss', },),).toBe(false,);
        expect(mentionsMe('hey @bob', null,),).toBe(false,);
    });
});

describe('mentionQueryAt', () => {
    it('finds the @query under the caret', () => {
        expect(mentionQueryAt('hi @bo', 6,),).toEqual({ start: 3, query: 'bo', },);
        expect(mentionQueryAt('@', 1,),).toEqual({ start: 0, query: '', },);
    });

    it('returns null outside a mention', () => {
        expect(mentionQueryAt('hi @bob there', 13,),).toBeNull();
        expect(mentionQueryAt('a@b', 3,),).toBeNull();
    });
});

describe('candidates', () => {
    const messages = [
        msg({ userId: 'u1', name: 'Ann Lee', handle: 'ann', },),
        msg({ userId: 'u2', name: 'Bob Stone', handle: null, },),
        msg({ userId: 'u1', name: 'Ann Lee', handle: 'ann', },),
        msg({ userId: 'me', name: 'Me', handle: 'me', },),
    ];

    it('collects distinct authors, most recent first, without me', () => {
        const c = collectCandidates(messages, [{ key: 'u:u3', name: 'Cara', handle: 'cara', },], 'me',);
        expect(c.map((x,) => x.name),).toEqual(['Ann Lee', 'Bob Stone', 'Cara',],);
    });

    it('dedupes extra candidates already in the chat', () => {
        const c = collectCandidates(messages, [{ key: 'u:u1', name: 'Ann Lee', handle: 'ann', },],);
        expect(c.filter((x,) => x.handle === 'ann',).length,).toBe(1,);
    });

    it('ranks handle prefix, then name prefix, then word prefix', () => {
        const list = [
            { key: '1', name: 'Zed Stone', handle: null, },
            { key: '2', name: 'Stan', handle: 'zz', },
            { key: '3', name: 'Other', handle: 'stone', },
        ];
        expect(matchCandidates(list, 'st',).map((c,) => c.key),).toEqual(['3', '2', '1',],);
        expect(matchCandidates(list, 'qq',),).toEqual([],);
        expect(matchCandidates(list, '', 2,).length,).toBe(2,);
    });

    it('inserts @handle, else the name without spaces', () => {
        expect(mentionToken({ name: 'Bob Stone', handle: null, },),).toBe('BobStone',);
        expect(insertMention('hi @bo', { start: 3, query: 'bo', }, 'bob',),).toEqual({ text: 'hi @bob ', caret: 8, },);
        expect(insertMention('hi @bo there', { start: 3, query: 'bo', }, 'bob',),).toEqual({ text: 'hi @bob there', caret: 7, },);
    });
});
