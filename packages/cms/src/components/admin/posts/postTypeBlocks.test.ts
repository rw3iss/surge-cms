import { describe, expect, it, } from 'vitest';
import { getPostType, } from '@sitesurge/types';
import { isEmptyOrUntouchedDefaults, seedDefaultBlocks, } from './postTypeBlocks';

describe('post type default blocks', () => {
    const article = getPostType('article',);
    const video = getPostType('video',);

    it('seeds the definition\'s default blocks', () => {
        const blocks = seedDefaultBlocks(article,);
        expect(blocks.map((b,) => b.type),).toEqual(['rich_text',],);
        expect(blocks[0].id,).toBeTruthy();
    },);

    it('treats empty and freshly seeded lists as replaceable', () => {
        expect(isEmptyOrUntouchedDefaults([], article,),).toBe(true,);
        expect(isEmptyOrUntouchedDefaults(seedDefaultBlocks(article,), article,),).toBe(true,);
    },);

    it('keeps edited content, styled blocks and other types\' defaults', () => {
        const edited = seedDefaultBlocks(article,);
        edited[0].data = { ...edited[0].data, content: '<p>Hello</p>', };
        expect(isEmptyOrUntouchedDefaults(edited, article,),).toBe(false,);

        const styled = seedDefaultBlocks(article,);
        styled[0].styleRef = { templateId: 'x', };
        expect(isEmptyOrUntouchedDefaults(styled, article,),).toBe(false,);

        expect(isEmptyOrUntouchedDefaults(seedDefaultBlocks(video,), article,),).toBe(false,);
    },);

    it('ignores key order from a server round-trip', () => {
        const b = seedDefaultBlocks(article,);
        const reordered = Object.fromEntries(Object.entries(b[0].data,).toReversed(),);
        expect(isEmptyOrUntouchedDefaults([{ ...b[0], data: reordered, },], article,),).toBe(true,);
    },);
},);
