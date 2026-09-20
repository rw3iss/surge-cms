/**
 * Expanding `entity` / `template` blocks for email.
 *
 * Both were registered as `() => ''`, so an email containing an entity block
 * rendered it as NOTHING — silently, with the surrounding blocks looking fine.
 *
 * The expansion's own hazard is the opposite: the source block STAYS in the
 * list (it carries the style and renders the children), so a naive re-pass
 * expands it again and the email contains the template once per pass.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const findBlocksResolved = vi.fn();
const entityGet = vi.fn();
const entityList = vi.fn();

vi.mock('../../repositories/contentBlockTemplates.repo', () => ({
    findBlocksResolved: (...a: unknown[]) => findBlocksResolved(...a,),
}),);
vi.mock('../entities', () => ({
    get: (...a: unknown[]) => entityGet(...a,),
    list: (...a: unknown[]) => entityList(...a,),
}),);
vi.mock('../../utils/logger', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), },
}),);
// Identity resolver — the {{ }} engine is tested elsewhere; here we only care
// that the record reaches it.
vi.mock('./templateRuntime', () => ({
    resolveMailTemplate: (src: string, ctx: Record<string, unknown>,) =>
        Promise.resolve(src.replace(/\{\{\s*post\.(\w+)\s*\}\}/g,
            (_m, k,) => String((ctx.post as Record<string, unknown>)?.[k] ?? '',),),),
}),);

import { expandDynamicBlocks, type FlatMailBlock, } from './expandBlocks';

const entityBlock = (over: Partial<FlatMailBlock> = {},): FlatMailBlock => ({
    id: 'e1', parentBlockId: null, blockType: 'entity', position: 1,
    settings: {
        entity: {
            entityType: 'post', templateId: 'tpl-1',
            binding: { mode: 'single', ref: 'saveourcities', },
        },
    },
    style: { padding: '20px', },
    ...over,
});

const tplBlock = (id = 't1', content = '<a>{{post.title}}</a>',) => ({
    id, parentBlockId: null, blockType: 'html', position: 0,
    settings: { content, }, style: {},
});

beforeEach(() => {
    findBlocksResolved.mockReset();
    entityGet.mockReset();
    entityList.mockReset();
},);

describe('expandDynamicBlocks', () => {
    it('attaches the template blocks as CHILDREN of the entity block', async () => {
        findBlocksResolved.mockResolvedValue([tplBlock(),],);
        entityGet.mockResolvedValue({ title: 'Our Major Cities', slug: 'saveourcities', },);

        const out = await expandDynamicBlocks([entityBlock(),],);
        const child = out.find((b,) => b.parentBlockId === 'e1');
        expect(child,).toBeDefined();
        expect(child!.blockType,).toBe('html',);
    },);

    it('KEEPS the source block, so its custom style still applies', async () => {
        // The style lives on the entity block; dropping it in favour of the
        // children would silently lose the operator's padding/background.
        findBlocksResolved.mockResolvedValue([tplBlock(),],);
        entityGet.mockResolvedValue({ title: 'T', },);

        const out = await expandDynamicBlocks([entityBlock(),],);
        const src = out.find((b,) => b.id === 'e1');
        expect(src,).toBeDefined();
        expect(src!.style,).toEqual({ padding: '20px', },);
    },);

    it('resolves {{ }} against the bound record', async () => {
        findBlocksResolved.mockResolvedValue([tplBlock(),],);
        entityGet.mockResolvedValue({ title: 'Our Major Cities', },);

        const out = await expandDynamicBlocks([entityBlock(),],);
        const child = out.find((b,) => b.parentBlockId === 'e1')!;
        expect(child.settings.content,).toBe('<a>Our Major Cities</a>',);
    },);

    it('does NOT duplicate the template across recursion passes', async () => {
        // THE BUG. The source block stays in the list, so an unguarded re-pass
        // expands it every time — five copies of the article in one email.
        findBlocksResolved.mockResolvedValue([tplBlock(),],);
        entityGet.mockResolvedValue({ title: 'T', },);

        const out = await expandDynamicBlocks([entityBlock(),],);
        expect(out.filter((b,) => b.parentBlockId === 'e1').length,).toBe(1,);
        expect(findBlocksResolved,).toHaveBeenCalledTimes(1,);
    },);

    it('renders one copy PER RECORD for a list binding', async () => {
        findBlocksResolved.mockResolvedValue([tplBlock(),],);
        entityGet.mockImplementation((_t: string, ref: string,) =>
            Promise.resolve({ title: `Post ${ref}`, },),);

        const out = await expandDynamicBlocks([entityBlock({
            settings: { entity: {
                entityType: 'post', templateId: 'tpl-1',
                binding: { mode: 'list', refs: ['a', 'b', 'c',], },
            }, },
        },),],);
        const children = out.filter((b,) => b.parentBlockId === 'e1');
        expect(children.length,).toBe(3,);
        // Each bound to its OWN record, not all to the first.
        expect(children.map((c,) => c.settings.content,).sort(),)
            .toEqual(['<a>Post a</a>', '<a>Post b</a>', '<a>Post c</a>',],);
    },);

    it('gives every copy a UNIQUE id', async () => {
        // Duplicate ids collide in the tree builder and in the per-block
        // responsive CSS keyed on data-block-id.
        findBlocksResolved.mockResolvedValue([tplBlock(),],);
        entityGet.mockResolvedValue({ title: 'T', },);

        const out = await expandDynamicBlocks([entityBlock({
            settings: { entity: {
                entityType: 'post', templateId: 'tpl-1',
                binding: { mode: 'list', refs: ['a', 'b',], },
            }, },
        },),],);
        const ids = out.map((b,) => b.id);
        expect(new Set(ids,).size,).toBe(ids.length,);
    },);

    it('leaves the list untouched when nothing is dynamic', async () => {
        const plain: FlatMailBlock[] = [{
            id: 'x', parentBlockId: null, blockType: 'rich_text', position: 0,
            settings: {}, style: {},
        },];
        expect(await expandDynamicBlocks(plain,),).toEqual(plain,);
        expect(findBlocksResolved,).not.toHaveBeenCalled();
    },);

    it('survives an entity that resolves to nothing', async () => {
        // A deleted post must cost that block its content, not the whole email.
        findBlocksResolved.mockResolvedValue([tplBlock(),],);
        entityGet.mockResolvedValue(null,);

        const out = await expandDynamicBlocks([entityBlock(),],);
        expect(out.filter((b,) => b.parentBlockId === 'e1').length,).toBe(0,);
        expect(out.find((b,) => b.id === 'e1'),).toBeDefined();
    },);

    it('survives a template fetch that throws', async () => {
        findBlocksResolved.mockRejectedValue(new Error('db down',),);
        const out = await expandDynamicBlocks([entityBlock(),],);
        expect(out.find((b,) => b.id === 'e1'),).toBeDefined();
    },);

    it('expands a component (template block) with no entity binding', async () => {
        findBlocksResolved.mockResolvedValue([tplBlock('c1', '<p>static</p>',),],);
        const out = await expandDynamicBlocks([{
            id: 'tb', parentBlockId: null, blockType: 'template', position: 0,
            settings: { templateId: 'cmp-1', }, style: {},
        },],);
        const child = out.find((b,) => b.parentBlockId === 'tb');
        expect(child?.settings.content,).toBe('<p>static</p>',);
    },);

    it('caps a query binding so an email cannot expand unbounded', async () => {
        findBlocksResolved.mockResolvedValue([tplBlock(),],);
        entityList.mockResolvedValue({
            items: Array.from({ length: 100, }, (_, i,) => ({ title: `P${i}`, }),),
        },);
        await expandDynamicBlocks([entityBlock({
            settings: { entity: {
                entityType: 'post', templateId: 'tpl-1',
                binding: { mode: 'query', query: { limit: 500, }, },
            }, },
        },),],);
        const passed = entityList.mock.calls[0][1] as { limit: number; };
        expect(passed.limit,).toBeLessThanOrEqual(25,);
    },);
},);
