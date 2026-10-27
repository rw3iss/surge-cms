import { describe, expect, it, } from 'vitest';
import { forumBlockSettingsFrom, } from '../template/forumFunctions';
import { deriveThreadTitle, forumBlockPostCategory, forumFeedQueryFor, normalizeForumBlockSettings, } from './forumBlock';

describe('normalizeForumBlockSettings', () => {
    it('fills defaults', () => {
        const s = normalizeForumBlockSettings({},);
        expect(s.mode,).toBe('list',);
        expect(s.postMode,).toBe('off',);
        expect(s.binding.mode,).toBe('query',);
    },);
    it('clamps and refuses unsafe lengths', () => {
        const s = normalizeForumBlockSettings({ limit: 999, listMaxHeight: '1px;color:red', refreshSeconds: 1, },);
        expect(s.limit,).toBe(50,);
        expect(s.listMaxHeight,).toBe('560px',);
        expect(s.refreshSeconds,).toBe(10,);
        expect(normalizeForumBlockSettings({ listMaxHeight: '400', },).listMaxHeight,).toBe('400px',);
    },);
},);

describe('forumBlockPostCategory', () => {
    it('prefers postCategory, else the query category', () => {
        const q = normalizeForumBlockSettings({ binding: { mode: 'query', query: { filter: { category: 'discussions', }, }, }, },);
        expect(forumBlockPostCategory(q,),).toBe('discussions',);
        expect(forumBlockPostCategory({ ...q, postCategory: 'general', },),).toBe('general',);
        expect(forumBlockPostCategory(normalizeForumBlockSettings({},),),).toBeUndefined();
    },);
},);

describe('forumFeedQueryFor', () => {
    it('maps a live query', () => {
        const s = normalizeForumBlockSettings({ binding: { mode: 'query', query: { filter: { sort: 'hot', window: '7d', category: 'x', }, limit: 5, }, }, },);
        expect(forumFeedQueryFor(s,),).toEqual({ page: 1, limit: 5, postCategory: 'x', sort: 'hot', window: '7d', category: 'x', },);
    },);
    it('maps a selection and thread mode', () => {
        expect(forumFeedQueryFor(normalizeForumBlockSettings({ binding: { mode: 'list', refs: ['a', 'b',], }, },),).threads,).toEqual(['a', 'b',],);
        expect(forumFeedQueryFor(normalizeForumBlockSettings({ mode: 'thread', thread: 't1', },),),).toMatchObject({ threads: ['t1',], limit: 1, },);
    },);
},);

describe('deriveThreadTitle', () => {
    it('uses the first line, cut at a word', () => {
        expect(deriveThreadTitle('Hello world\nmore',),).toBe('Hello world',);
        expect(deriveThreadTitle('word '.repeat(40,), 'x', 30,).endsWith('…',),).toBe(true,);
        expect(deriveThreadTitle('hi', 'Post by Ann',),).toBe('Post by Ann',);
    },);
},);

describe('forum() template function', () => {
    it('maps the call', () => {
        expect(forumBlockSettingsFrom('nope', [],),).toBeNull();
        const s = forumBlockSettingsFrom('forum', [10,], { category: 'discussions', post: 'true', replies: true, chat: 'true', members: true, },)!;
        expect(s.limit,).toBe(10,);
        expect(s.postMode,).toBe('inline',);
        expect(s.allowReplies,).toBe(true,);
        expect(s.chatOrder,).toBe(true,);
        expect(s.visibility,).toBe('members',);
        expect(s.binding,).toEqual({ mode: 'query', query: { filter: { sort: 'latest', category: 'discussions', }, limit: 10, }, },);
        expect(forumBlockSettingsFrom('forum', [], { thread: 'ama', },),).toMatchObject({ mode: 'thread', thread: 'ama', },);
        expect(forumBlockSettingsFrom('forum', [], { readMore: false, },)!.readMoreLabel,).toBe('',);
    },);
},);
