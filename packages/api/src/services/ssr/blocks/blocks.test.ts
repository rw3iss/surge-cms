import { describe, expect, it, } from 'vitest';
import { ALL_BLOCK_TYPES, } from '@sitesurge/types';
import { assembleSsrBlockTree, renderBlockForSeo, SSR_BLOCK_RENDERERS, } from './index';

describe('SSR block registry coverage', () => {
    it('every BlockType has an SSR strategy', () => {
        for (const t of ALL_BLOCK_TYPES) {
            expect(SSR_BLOCK_RENDERERS[t], `missing SSR strategy for ${t}`,).toBeTypeOf('function',);
        }
    });

    it('registry has no strategy for a type outside the catalog', () => {
        const extra = Object.keys(SSR_BLOCK_RENDERERS,).filter(
            (k,) => !(ALL_BLOCK_TYPES as readonly string[]).includes(k,),
        );
        expect(extra,).toEqual([],);
    });
});

describe('SSR block output parity', () => {
    it('rich_text sanitizes into an ssr-block div', () => {
        expect(renderBlockForSeo({ type: 'rich_text', content: '<p>Hi</p>', },))
            .toBe('<div class="ssr-block ssr-block--rich_text"><p>Hi</p></div>',);
    });
    it('html passes through raw (unsanitized)', () => {
        expect(renderBlockForSeo({ type: 'html', content: '<p onclick="x">Hi</p>', },))
            .toBe('<div class="ssr-block ssr-block--html"><p onclick="x">Hi</p></div>',);
    });
    it('image emits an img with escaped attrs', () => {
        expect(renderBlockForSeo({ type: 'image', content: 'https://x/y.png', settings: { alt: 'A&B', }, },))
            .toBe('<img class="ssr-block ssr-block--image" src="https://x/y.png" alt="A&amp;B" />',);
    });
    it('dynamic blocks emit a naming comment', () => {
        expect(renderBlockForSeo({ type: 'form', },)).toBe('<!-- form block (not server-rendered) -->',);
    });
    it('video emits nothing; childless group/group_item emit nothing', () => {
        expect(renderBlockForSeo({ type: 'video', },)).toBe('',);
        expect(renderBlockForSeo({ type: 'group', },)).toBe('',);
        expect(renderBlockForSeo({ type: 'group_item', },)).toBe('',);
    });
});

describe('SSR nested block tree', () => {
    it('assembles a flat list into a tree and recurses group children', () => {
        // page → group → group_item → rich_text
        const flat = [
            { id: 'g', parentBlockId: null, type: 'group', },
            { id: 'slot', parentBlockId: 'g', type: 'group_item', },
            { id: 'rt', parentBlockId: 'slot', type: 'rich_text', content: '<p>Nested</p>', },
        ];
        const roots = assembleSsrBlockTree(flat,);
        expect(roots,).toHaveLength(1,);
        expect(roots[0].type,).toBe('group',);
        // The nested rich_text is now indexable through the container recursion.
        expect(renderBlockForSeo(roots[0],)).toBe(
            '<div class="ssr-block ssr-block--rich_text"><p>Nested</p></div>',
        );
    });
});
