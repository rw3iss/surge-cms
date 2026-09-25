/**
 * Flat catalog paths → the nested bag the template runtime resolves against.
 *
 * The server's `buildSampleContext` does the same expansion for the mail
 * preview; if these two disagree on shape, the Custom HTML editor's Preview tab
 * and the template's Preview button show different things for the same token —
 * which is the bug this store exists to fix.
 */
import { describe, expect, it, } from 'vitest';
import { buildMailPreviewVariables, expandVariablePaths, } from './previewVariables';

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

/**
 * The bag must not smuggle placeholder `site.*` over the real thing.
 *
 * The catalog exists to preview variables the client CANNOT derive. Site
 * values are not among them: the admin loads real settings, and this bag
 * merges last in the runtime — so publishing the catalog's
 * "https://example.com/logo.png" replaced the actual logo with a 404.
 */

const CATALOG = [
    { path: 'site.name', sample: 'SiteSurge', },
    { path: 'site.logo', sample: 'https://example.com/logo.png', },
    { path: 'site.url', sample: 'https://example.com', },
    { path: 'list.name', sample: 'Weekly Newsletter', },
    { path: 'list.subscriberCount', sample: 1234, },
    { path: 'template.name', sample: 'Weekly Digest', },
    { path: 'user.name', sample: 'Sample Subscriber', },
    { path: 'unsubscribe_url', sample: 'https://example.com/u/tok', },
];

describe('buildMailPreviewVariables', () => {
    it('EXCLUDES site.* so the real site bag survives', () => {
        const bag = buildMailPreviewVariables(CATALOG,);
        expect(bag.site,).toBeUndefined();
    },);

    it('keeps the variables the client cannot derive', () => {
        const bag = buildMailPreviewVariables(CATALOG,);
        expect((bag.list as Record<string, unknown>).name,).toBe('Weekly Newsletter',);
        expect((bag.template as Record<string, unknown>).name,).toBe('Weekly Digest',);
        expect((bag.user as Record<string, unknown>).name,).toBe('Sample Subscriber',);
        expect(bag.unsubscribe_url,).toBe('https://example.com/u/tok',);
    },);

    it('lets real editor values beat the samples', () => {
        const bag = buildMailPreviewVariables(CATALOG, { 'template.name': 'Ryan Test Template', },);
        expect((bag.template as Record<string, unknown>).name,).toBe('Ryan Test Template',);
    },);

    it('ignores an empty or undefined override, keeping the sample', () => {
        // A blank subject field should preview the sample, not an empty string
        // that looks like a broken variable.
        const bag = buildMailPreviewVariables(CATALOG, {
            'template.name': '', 'template.subject': undefined,
        },);
        expect((bag.template as Record<string, unknown>).name,).toBe('Weekly Digest',);
    },);

    it('preserves sample types', () => {
        const bag = buildMailPreviewVariables(CATALOG,);
        expect((bag.list as Record<string, unknown>).subscriberCount,).toBe(1234,);
    },);

    it('excludes site.* even when an override names one', () => {
        // Nothing in the editor should be able to reintroduce a placeholder
        // logo by the back door.
        const bag = buildMailPreviewVariables(CATALOG, { 'site.logo': 'https://example.com/x.png', },);
        expect(bag.site,).toBeUndefined();
    },);
},);
