/**
 * SSR reuses the mail expansion so entity / component blocks reach the SEO
 * body (audit 2026-10-18 G4). Pinned here: the anonymous-site options, the
 * mapping of cloned template blocks back to the SSR shape, and that the
 * dispatcher walks the attached children.
 */
import { describe, expect, it, vi, } from 'vitest';

const expandDynamicBlocks = vi.fn();
vi.mock('../mail/expandBlocks.js', () => ({ expandDynamicBlocks: (...a: unknown[]) => expandDynamicBlocks(...a,), }),);
vi.mock('./templateRuntime', () => ({ resolveContentForSsr: vi.fn(async (s: string,) => s,), }),);
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), }, }),);

import { expandSsrDynamicBlocks, } from './expandBlocks';
import { assembleSsrBlockTree, renderBlockForSeo, } from './blocks';

describe('expandSsrDynamicBlocks', () => {
    it('leaves a list with no dynamic block untouched (no expansion call)', async () => {
        const flat = [{ id: 'a', type: 'rich_text', content: '<p>x</p>', },];
        expect(await expandSsrDynamicBlocks(flat,),).toBe(flat,);
        expect(expandDynamicBlocks,).not.toHaveBeenCalled();
    },);

    it('maps cloned template blocks back, in template order, and renders them as children', async () => {
        expandDynamicBlocks.mockImplementation(async (blocks: Array<Record<string, unknown>>,) => [
            ...blocks,
            { id: 'c-2', parentBlockId: 't1', blockType: 'rich_text', position: 2, settings: { content: '<p>second</p>', }, style: {}, },
            { id: 'c-1', parentBlockId: 't1', blockType: 'rich_text', position: 1, settings: { content: '<p>first</p>', }, style: {}, },
        ],);
        const flat = [{ id: 't1', parentBlockId: null, type: 'template', title: null, content: null, settings: { templateId: 'x', }, },];
        const out = await expandSsrDynamicBlocks(flat,);
        const opts = expandDynamicBlocks.mock.calls[0][3];
        expect(opts,).toMatchObject({ audience: 'site', feeds: false, videoSize: false, },);
        const [root,] = assembleSsrBlockTree(out,);
        const html = renderBlockForSeo(root,);
        expect(html.indexOf('first',),).toBeLessThan(html.indexOf('second',),);
    },);

    it('an unexpanded entity block still emits its naming comment', () => {
        expect(renderBlockForSeo({ type: 'entity', children: [], },),).toContain('entity block',);
    },);
},);
