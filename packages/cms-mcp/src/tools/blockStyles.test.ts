import { describe, expect, it, vi, } from 'vitest';
import { blockStyleTools, } from './blockStyles';
import type { ToolContext, ToolDef, } from '../tool';

/** Look up a tool by name from the exported registry. */
function tool(name: string,): ToolDef {
    const t = blockStyleTools.find((x,) => x.name === name,);
    if (!t) throw new Error(`no tool ${name}`,);
    return t;
}

/** Build a ToolContext whose cms.{blockStyles,pages,posts}.* are mocks. */
function mockCtx(overrides: { pages?: Record<string, unknown>; posts?: Record<string, unknown>; } = {},) {
    const blockStyles = {
        list: vi.fn(),
        getById: vi.fn(),
        create: vi.fn().mockImplementation(async (body: unknown,) => body,),
        update: vi.fn().mockImplementation(async (_id: string, body: unknown,) => body,),
        remove: vi.fn(),
    };
    const pages = {
        updateBlock: vi.fn().mockImplementation(async (_p: string, _b: string, body: unknown,) => body,),
        ...overrides.pages,
    };
    const posts = {
        getById: vi.fn(),
        update: vi.fn().mockImplementation(async (_id: string, body: unknown,) => body,),
        ...overrides.posts,
    };
    const ctx = {
        cms: { blockStyles, pages, posts, },
        readonly: false,
        config: { baseUrl: 'http://x', apiKeyPreview: 'ssk_…', },
    } as unknown as ToolContext;
    return { ctx, blockStyles, pages, posts, };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (t: ToolDef, args: any, ctx: ToolContext,) => t.handler(args, ctx,);

describe('create_block_style', () => {
    it('passes name + style fields straight through to create', async () => {
        const { ctx, blockStyles, } = mockCtx();
        await call(tool('create_block_style',), { name: 'Card', backgroundColor: '#fff', padding: '16px', }, ctx,);
        const [body,] = blockStyles.create.mock.calls[0];
        expect(body,).toEqual({ name: 'Card', backgroundColor: '#fff', padding: '16px', },);
    },);
},);

describe('update_block_style', () => {
    it('splits id from the partial body', async () => {
        const { ctx, blockStyles, } = mockCtx();
        await call(tool('update_block_style',), { id: 'bs1', textColor: '#111', }, ctx,);
        const [id, body,] = blockStyles.update.mock.calls[0];
        expect(id,).toBe('bs1',);
        expect(body,).toEqual({ textColor: '#111', },);
        expect('id' in body,).toBe(false,);
    },);
},);

describe('apply_block_style — page', () => {
    it('calls pages.updateBlock with { style }', async () => {
        const { ctx, pages, } = mockCtx();
        await call(tool('apply_block_style',), {
            target: 'page', pageOrPostId: 'pg1', blockId: 'b1', style: { id: 'bs1', },
        }, ctx,);
        expect(pages.updateBlock,).toHaveBeenCalledWith('pg1', 'b1', { style: { id: 'bs1', }, },);
    },);

    it('supports null to clear', async () => {
        const { ctx, pages, } = mockCtx();
        await call(tool('apply_block_style',), {
            target: 'page', pageOrPostId: 'pg1', blockId: 'b1', style: null,
        }, ctx,);
        expect(pages.updateBlock,).toHaveBeenCalledWith('pg1', 'b1', { style: null, },);
    },);
},);

describe('apply_block_style — post', () => {
    it('read-modify-writes data.style on the target block, siblings intact', async () => {
        const { ctx, posts, } = mockCtx({
            posts: {
                getById: vi.fn().mockResolvedValue({
                    id: 'p1',
                    contentBlocks: [
                        { id: 'b1', type: 'rich_text', sortOrder: 0, data: { content: 'a', }, },
                        { id: 'b2', type: 'spacer', sortOrder: 1, data: { height: '10px', }, },
                    ],
                },),
            },
        },);
        await call(tool('apply_block_style',), {
            target: 'post', pageOrPostId: 'p1', blockId: 'b2', style: { backgroundColor: '#eee', },
        }, ctx,);

        expect(posts.getById,).toHaveBeenCalledWith('p1',);
        const [id, body,] = posts.update.mock.calls[0];
        expect(id,).toBe('p1',);
        const [b1, b2,] = body.contentBlocks;
        expect(b1.data,).toEqual({ content: 'a', },); // sibling untouched
        expect(b2.data.style,).toEqual({ backgroundColor: '#eee', },);
        expect(b2.data.height,).toBe('10px',); // existing data preserved
        expect(b2.sort_order,).toBe(1,); // read→write snake_case
    },);

    it('throws when the block id is not found on the post', async () => {
        const { ctx, } = mockCtx({
            posts: { getById: vi.fn().mockResolvedValue({ id: 'p1', contentBlocks: [], },), },
        },);
        await expect(call(tool('apply_block_style',), {
            target: 'post', pageOrPostId: 'p1', blockId: 'nope', style: null,
        }, ctx,),).rejects.toThrow(/not found/,);
    },);
},);
