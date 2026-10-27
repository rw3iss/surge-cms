import { describe, expect, it, } from 'vitest';
import { followTitleSlug, } from './autoSlug';

describe('followTitleSlug', () => {
    it('follows the title on a new post', () => {
        expect(followTitleSlug('', 'H', '', { isNew: true, },),).toBe('h',);
        expect(followTitleSlug('Hello', 'Hello World', 'hello', { isNew: true, },),).toBe('hello-world',);
    },);
    it('stops once the author typed their own slug', () => {
        expect(followTitleSlug('Hello', 'Hello World', 'my-slug', { isNew: true, },),).toBeNull();
    },);
    it('never rewrites a saved slug, but fills an empty one', () => {
        expect(followTitleSlug('Hello', 'Hello World', 'hello', { isNew: false, },),).toBeNull();
        expect(followTitleSlug('', 'Hello', '', { isNew: false, },),).toBe('hello',);
    },);
},);
