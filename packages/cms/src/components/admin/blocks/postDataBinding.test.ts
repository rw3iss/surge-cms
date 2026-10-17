import { describe, expect, it, } from 'vitest';
import { hasPinnedAndQuery, postDataBinding, postSettingsFromBinding, } from './postDataBinding';

describe('posts block ↔ Set data', () => {
    it('reads pinned posts first, else the live query (default on, 5)', () => {
        expect(postDataBinding({ pinnedPostIds: ['a', 'b',], },),).toEqual({ mode: 'list', refs: ['a', 'b',], },);
        expect(postDataBinding({},),).toEqual({ mode: 'query', query: { limit: 5, }, },);
        expect(postDataBinding({ count: 3, query: 'x', },),).toEqual({ mode: 'query', query: { limit: 3, search: 'x', }, },);
        expect(postDataBinding({ queryEnabled: false, },),).toBeNull();
    },);
    it('writes the renderer shape', () => {
        expect(postSettingsFromBinding({ mode: 'list', refs: ['a',], },),).toEqual({ pinnedPostIds: ['a',], queryEnabled: false, },);
        expect(postSettingsFromBinding({ mode: 'query', query: { limit: 8, search: ' cat ', }, },),)
            .toEqual({ pinnedPostIds: [], queryEnabled: true, count: 8, query: 'cat', },);
        expect(postSettingsFromBinding(null,),).toEqual({ pinnedPostIds: [], queryEnabled: false, },);
    },);
    it('flags old blocks holding both', () => {
        expect(hasPinnedAndQuery({ pinnedPostIds: ['a',], },),).toBe(true,);
        expect(hasPinnedAndQuery({ pinnedPostIds: ['a',], queryEnabled: false, },),).toBe(false,);
    },);
},);
