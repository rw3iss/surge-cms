import { describe, expect, it, } from 'vitest';
import { commentCountTarget, discussionQueryFor, } from './discussionFunctions';
import { entityRef, } from './types';

describe('discussionQueryFor', () => {
    it('presets kind + sort, takes a positional limit', () => {
        expect(discussionQueryFor('hotThreads', [5,],),).toEqual({ kind: 'thread', sort: 'hot', limit: 5, },);
        expect(discussionQueryFor('latestComments', [],),).toEqual({ kind: 'comment', sort: 'latest', limit: 5, },);
    },);
    it('named args reach the query and override the preset', () => {
        expect(discussionQueryFor('hotThreads', [3,], { window: '7d', category: 'general', },),)
            .toEqual({ kind: 'thread', sort: 'hot', limit: 3, window: '7d', category: 'general', },);
        expect(discussionQueryFor('discussions', [], { sort: 'top', kind: 'both', limit: 10, },),)
            .toEqual({ sort: 'top', kind: 'both', limit: 10, },);
    },);
    it('ignores unknown names and unknown keys', () => {
        expect(discussionQueryFor('posts', [],),).toBeNull();
        expect(discussionQueryFor('hotComments', [], { bogus: 1, } as never,),).toEqual({ kind: 'comment', sort: 'hot', limit: 5, },);
    },);
},);

describe('commentCountTarget', () => {
    const id = '7e553f7d-8931-4d4f-8361-b37ba1c32408';
    it('reads an entity variable', () => {
        expect(commentCountTarget([entityRef('event', { id, },),],),).toEqual({ type: 'event', id, },);
    },);
    it('a bare id defaults to post; type= overrides', () => {
        expect(commentCountTarget([id,],),).toEqual({ type: 'post', id, },);
        expect(commentCountTarget([id,], { type: 'event', },),).toEqual({ type: 'event', id, },);
    },);
    it('rejects non-ids', () => expect(commentCountTarget(['slug',],),).toBeNull());
},);
