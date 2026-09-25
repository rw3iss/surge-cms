/**
 * Flat catalog paths → the nested bag the template runtime resolves against.
 *
 * The server's `buildSampleContext` does the same expansion for the mail
 * preview; if these two disagree on shape, the Custom HTML editor's Preview tab
 * and the template's Preview button show different things for the same token —
 * which is the bug this store exists to fix.
 */
import { describe, expect, it, } from 'vitest';
import { expandVariablePaths, } from './previewVariables';

describe('expandVariablePaths', () => {
    it('nests dotted paths', () => {
        expect(expandVariablePaths({ 'list.name': 'Weekly', },),)
            .toEqual({ list: { name: 'Weekly', }, },);
    },);

    it('merges siblings under one parent', () => {
        expect(expandVariablePaths({
            'list.name': 'Weekly', 'list.slug': 'weekly', 'template.name': 'Digest',
        },),).toEqual({
            list: { name: 'Weekly', slug: 'weekly', },
            template: { name: 'Digest', },
        },);
    },);

    it('handles a top-level path with no dot', () => {
        expect(expandVariablePaths({ unsubscribe_url: 'https://x/u/t', },),)
            .toEqual({ unsubscribe_url: 'https://x/u/t', },);
    },);

    it('nests three levels (user.custom.city)', () => {
        expect(expandVariablePaths({ 'user.custom.city': 'Philadelphia', },),)
            .toEqual({ user: { custom: { city: 'Philadelphia', }, }, },);
    },);

    it('preserves non-string values', () => {
        // A count must stay a number so `{{ if list.subscriberCount > 100 }}`
        // compares numerically rather than lexically.
        const out = expandVariablePaths({
            'list.subscriberCount': 1234, 'list.doubleOptIn': true, 'user.custom': {},
        },);
        expect((out.list as Record<string, unknown>).subscriberCount,).toBe(1234,);
        expect((out.list as Record<string, unknown>).doubleOptIn,).toBe(true,);
    },);

    it('lets a later path overwrite an earlier leaf', () => {
        // How the editor's REAL template name beats the catalog sample.
        expect(expandVariablePaths({ 'template.name': 'Sample', },),)
            .toEqual({ template: { name: 'Sample', }, },);
        const merged = { 'template.name': 'Sample', };
        merged['template.name'] = 'Real Name';
        expect(expandVariablePaths(merged,),).toEqual({ template: { name: 'Real Name', }, },);
    },);

    it('replaces a non-object leaf when a deeper path needs it as a parent', () => {
        // `{'a': 1, 'a.b': 2}` — the leaf has to become a branch or the
        // assignment would throw on a primitive.
        expect(() => expandVariablePaths({ a: 1, 'a.b': 2, },),).not.toThrow();
        expect(expandVariablePaths({ a: 1, 'a.b': 2, },),).toEqual({ a: { b: 2, }, },);
    },);

    it('returns an empty bag for no paths', () => {
        expect(expandVariablePaths({},),).toEqual({},);
    },);
},);
