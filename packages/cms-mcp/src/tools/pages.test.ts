import { describe, expect, it, vi, } from 'vitest';
import { pageTools, } from './pages';
import type { ToolContext, ToolDef, } from '../tool';

/** Look up a tool by name from the exported registry. */
function tool(name: string,): ToolDef {
    const t = pageTools.find((x,) => x.name === name,);
    if (!t) throw new Error(`no tool ${name}`,);
    return t;
}

/** Build a ToolContext whose cms.pages.* are vi.fn() mocks. */
function mockCtx(overrides: Record<string, unknown> = {},) {
    const pages = {
        list: vi.fn(),
        getById: vi.fn(),
        getBySlug: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        bulk: vi.fn(),
        createBlock: vi.fn().mockImplementation(async (_pageId: string, body: unknown,) => body,),
        updateBlock: vi.fn(),
        deleteBlock: vi.fn(),
        reorderBlocks: vi.fn(),
        listRevisions: vi.fn(),
        restoreRevision: vi.fn(),
        ...overrides,
    };
    const ctx = {
        cms: { pages, },
        readonly: false,
        config: { baseUrl: 'http://x', apiKeyPreview: 'ssk_…', },
    } as unknown as ToolContext;
    return { ctx, pages, };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (t: ToolDef, args: any, ctx: ToolContext,) => t.handler(args, ctx,);

describe('add_page_block', () => {
    it('creates a plain block once with an id + merged catalog defaults', async () => {
        const { ctx, pages, } = mockCtx();
        const t = tool('add_page_block',);
        await call(t, { pageId: 'p1', type: 'spacer', settings: { height: '20px', }, }, ctx,);

        expect(pages.createBlock,).toHaveBeenCalledTimes(1,);
        const [pageId, body,] = pages.createBlock.mock.calls[0];
        expect(pageId,).toBe('p1',);
        expect(typeof body.id,).toBe('string',);
        expect(body.id.length,).toBeGreaterThan(0,);
        expect(body.type,).toBe('spacer',);
        // default height '60px' from catalog is overridden by caller '20px'.
        expect(body.settings,).toEqual({ height: '20px', },);
    },);

    it('honors a client-supplied id', async () => {
        const { ctx, pages, } = mockCtx();
        await call(tool('add_page_block',), { pageId: 'p1', type: 'rich_text', id: 'my-uuid', content: '<p>hi</p>', }, ctx,);
        const [, body,] = pages.createBlock.mock.calls[0];
        expect(body.id,).toBe('my-uuid',);
        expect(body.content,).toBe('<p>hi</p>',);
    },);

    it('for a group with columns:3 creates 1 group + 3 group_item children and returns slots', async () => {
        const { ctx, pages, } = mockCtx();
        const res = (await call(tool('add_page_block',), {
            pageId: 'p1', type: 'group', settings: { columns: 3, },
        }, ctx,)) as { group: { id: string; }; slots: Array<{ id: string; }>; };

        expect(pages.createBlock,).toHaveBeenCalledTimes(4,);
        const groupId = res.group.id;
        expect(res.slots,).toHaveLength(3,);

        // Calls 2..4 are the group_item children, parented to the group.
        for (let i = 1; i <= 3; i++) {
            const [, body,] = pages.createBlock.mock.calls[i];
            expect(body.type,).toBe('group_item',);
            expect(body.parentBlockId,).toBe(groupId,);
            expect(body.order,).toBe(i - 1,);
        }
        expect(res.slots.map((s,) => s.id,),).toEqual([
            pages.createBlock.mock.calls[1][1].id,
            pages.createBlock.mock.calls[2][1].id,
            pages.createBlock.mock.calls[3][1].id,
        ],);
    },);

    it('defaults a group to 2 slots and clamps out-of-range columns', async () => {
        const { ctx, pages, } = mockCtx();
        await call(tool('add_page_block',), { pageId: 'p1', type: 'group', }, ctx,);
        expect(pages.createBlock,).toHaveBeenCalledTimes(3,); // 1 group + 2 slots

        pages.createBlock.mockClear();
        await call(tool('add_page_block',), { pageId: 'p1', type: 'group', settings: { columns: 99, }, }, ctx,);
        expect(pages.createBlock,).toHaveBeenCalledTimes(17,); // 1 group + 16 slots (clamped)
    },);

    it('rejects a deprecated block type', async () => {
        const { ctx, } = mockCtx();
        await expect(call(tool('add_page_block',), { pageId: 'p1', type: 'post', }, ctx,),).rejects.toThrow(/deprecated/,);
    },);
},);

describe('get_page', () => {
    it('requires exactly one of id/slug', async () => {
        const { ctx, } = mockCtx();
        const t = tool('get_page',);
        await expect(call(t, {}, ctx,),).rejects.toThrow(/exactly one/,);
        await expect(call(t, { id: 'a', slug: 'b', }, ctx,),).rejects.toThrow(/exactly one/,);
    },);

    it('routes id → getById and slug → getBySlug', async () => {
        const { ctx, pages, } = mockCtx();
        const t = tool('get_page',);
        await call(t, { id: 'p1', }, ctx,);
        expect(pages.getById,).toHaveBeenCalledWith('p1',);

        await call(t, { slug: 'about', preview: 'admin', }, ctx,);
        expect(pages.getBySlug,).toHaveBeenCalledWith('about', { preview: 'admin', },);
    },);
},);

describe('update_page_block', () => {
    it('passes only provided keys (no default merge)', async () => {
        const { ctx, pages, } = mockCtx();
        await call(tool('update_page_block',), { pageId: 'p1', blockId: 'b1', title: 'T', style: null, }, ctx,);
        const [pageId, blockId, body,] = pages.updateBlock.mock.calls[0];
        expect(pageId,).toBe('p1',);
        expect(blockId,).toBe('b1',);
        expect(body,).toEqual({ title: 'T', style: null, },);
        expect('settings' in body,).toBe(false,);
        expect('content' in body,).toBe(false,);
    },);
},);

describe('reorder_page_blocks', () => {
    it('coerces omitted parentBlockId to null (top-level scope)', async () => {
        const { ctx, pages, } = mockCtx();
        await call(tool('reorder_page_blocks',), { pageId: 'p1', blockIds: ['a', 'b',], }, ctx,);
        expect(pages.reorderBlocks,).toHaveBeenCalledWith('p1', { blockIds: ['a', 'b',], parentBlockId: null, },);
    },);
},);
