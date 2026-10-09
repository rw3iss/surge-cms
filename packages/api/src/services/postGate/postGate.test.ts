import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../permissions/subjects', () => ({ activePlanId: vi.fn(), }),);

import { applyGateSync, gateFor, hiddenClause, isHiddenFor, } from './index';
import { samplePostContent, } from './samples';

const tiers = new Map([
    ['free', { id: 'free', name: 'Free', slug: 'free', sortOrder: 0, },],
    ['sub', { id: 'sub', name: 'Subscriber', slug: 'subscriber', sortOrder: 10, },],
    ['vip', { id: 'vip', name: 'VIP', slug: 'vip', sortOrder: 20, },],
],);

const post = (extra: Record<string, unknown> = {},) => ({
    id: 'p', title: 'T', slug: 't', content: '<p>Legacy body text here.</p>', requiredTierId: 'sub',
    gateHidden: false, gateShowSample: false, gateSamplePercent: 50, ...extra,
}) as never;

describe('gateFor', () => {
    it('public when no tier is required (or the tier no longer exists)', () => {
        expect(gateFor(post({ requiredTierId: null, },), null, tiers,).state,).toBe('public',);
        expect(gateFor(post({ requiredTierId: 'gone', },), null, tiers,).state,).toBe('public',);
    },);
    it('ranks tiers by sort order: equal or higher passes, lower and anonymous are locked', () => {
        expect(gateFor(post(), 10, tiers,).state,).toBe('premium',);
        expect(gateFor(post(), 20, tiers,).state,).toBe('premium',);
        expect(gateFor(post(), 0, tiers,).state,).toBe('locked',);
        expect(gateFor(post(), null, tiers,).state,).toBe('locked',);
        expect(gateFor(post(), Infinity, tiers,).state,).toBe('premium',);
    },);
    it('requiring Free means "signed in"', () => {
        expect(gateFor(post({ requiredTierId: 'free', },), 0, tiers,).state,).toBe('premium',);
        expect(gateFor(post({ requiredTierId: 'free', },), null, tiers,).state,).toBe('locked',);
    },);
    it('names the required tier and hides only when asked', () => {
        const g = gateFor(post({ gateHidden: true, },), null, tiers,);
        expect(g.requiredTier,).toEqual({ id: 'sub', name: 'Subscriber', slug: 'subscriber', },);
        expect(isHiddenFor(post({ gateHidden: true, },), g,),).toBe(true,);
        expect(g.sample,).toBe(false,);
    },);
},);

describe('applyGateSync', () => {
    const blocks = () => [
        { type: 'image', data: { url: 'a.jpg', }, },
        { type: 'rich_text', data: { content: '<p>one two three four five six seven eight nine ten</p>', }, },
        { type: 'video', data: { url: 'v.mp4', }, },
    ];
    it('a locked post without a sample loses its whole body', () => {
        const p = applyGateSync(post({ contentBlocks: blocks(), },), null, tiers,) as never as { contentBlocks: unknown[]; content: string; };
        expect(p.contentBlocks,).toEqual([],);
        expect(p.content,).toBe('',);
    },);
    it('a locked post with a sample keeps the lead blocks + part of the first rich text, nothing after', () => {
        const p = applyGateSync(post({ gateShowSample: true, contentBlocks: blocks(), },), null, tiers,) as never as {
            contentBlocks: { type: string; data: { content?: string; }; }[];
        };
        expect(p.contentBlocks.map((b,) => b.type),).toEqual(['image', 'rich_text',],);
        expect(p.contentBlocks[1].data.content,).toContain('one two',);
        expect(p.contentBlocks[1].data.content,).not.toContain('ten',);
    },);
    it('a premium viewer gets everything', () => {
        const p = applyGateSync(post({ contentBlocks: blocks(), },), 10, tiers,) as never as { contentBlocks: unknown[]; };
        expect(p.contentBlocks,).toHaveLength(3,);
    },);
},);

describe('samplePostContent', () => {
    it('shows only the first lead block when the article has no rich text', () => {
        const s = samplePostContent({ contentBlocks: [{ type: 'image', }, { type: 'video', },], } as never, 25,);
        expect(s.blocks,).toHaveLength(1,);
    },);
    it('defaults to the article sampler (no type, unknown type → custom → article)', () => {
        const blocks = [{ type: 'image', }, { type: 'rich_text', data: { content: '<p>a b c d</p>', }, }, { type: 'image', },];
        expect(samplePostContent({ contentBlocks: blocks, } as never, 50,).blocks.map((b,) => b.type),).toEqual(['image', 'rich_text',],);
        expect(samplePostContent({ postType: 'nope', contentBlocks: blocks, } as never, 50,).blocks,).toHaveLength(2,);
    },);
    it('video: lead blocks through the first video, then part of a following rich text', () => {
        const blocks = [
            { type: 'image', },
            { type: 'video', data: { url: 'v', }, },
            { type: 'rich_text', data: { content: '<p>one two three four five six seven eight nine ten</p>', }, },
            { type: 'image', },
        ];
        const s = samplePostContent({ postType: 'video', contentBlocks: blocks, } as never, 30,);
        expect(s.blocks.map((b,) => b.type),).toEqual(['image', 'video', 'rich_text',],);
        expect(String(s.blocks[2].data?.content,),).toContain('one',);
        expect(String(s.blocks[2].data?.content,),).not.toContain('ten',);
    },);
    it('video: nothing after the video when the next block is not rich text', () => {
        const s = samplePostContent({ postType: 'video', contentBlocks: [{ type: 'video', }, { type: 'image', }, { type: 'rich_text', data: { content: 'x', }, },], } as never, 30,);
        expect(s.blocks.map((b,) => b.type),).toEqual(['video',],);
    },);
    it('video without a video block falls back to the article rule', () => {
        const s = samplePostContent({ postType: 'video', contentBlocks: [{ type: 'image', }, { type: 'rich_text', data: { content: '<p>a b</p>', }, },], } as never, 50,);
        expect(s.blocks.map((b,) => b.type),).toEqual(['image', 'rich_text',],);
    },);
    it('live: no body, only the first lead block', () => {
        const s = samplePostContent({ postType: 'live', content: '<p>secret</p>', contentBlocks: [{ type: 'image', }, { type: 'rich_text', data: { content: 'x', }, },], } as never, 50,);
        expect(s.blocks.map((b,) => b.type),).toEqual(['image',],);
        expect(s.content,).toBe('',);
        expect(samplePostContent({ postType: 'live', contentBlocks: [{ type: 'rich_text', data: { content: 'x', }, },], } as never, 50,).blocks,).toEqual([],);
    },);
},);

describe('hiddenClause', () => {
    it('adds nothing for staff and binds the rank otherwise', () => {
        const params: unknown[] = [];
        expect(hiddenClause('p', Infinity, params,),).toBe('',);
        expect(hiddenClause('p', null, params,),).toContain('gate_hidden = false',);
        expect(params,).toEqual([null,],);
    },);
},);
