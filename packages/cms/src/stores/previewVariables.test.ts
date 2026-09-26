/**
 * Flat catalog paths → the nested bag the template runtime resolves against.
 *
 * The server's `buildSampleContext` does the same expansion for the mail
 * preview; if these two disagree on shape, the Custom HTML editor's Preview tab
 * and the template's Preview button show different things for the same token —
 * which is the bug this store exists to fix.
 */
import { createEffect, createRoot, } from 'solid-js';
import { describe, expect, it, } from 'vitest';
import {
    buildMailPreviewVariables,
    expandVariablePaths,
    mailVariableOverrides,
    previewVariables,
    setPreviewVariables,
} from './previewVariables';

describe('expandVariablePaths', () => {
    it('nests dotted paths', () => {
        expect(expandVariablePaths({ 'list.name': 'Weekly', },),)
            .toEqual({ list: { name: 'Weekly', }, },);
    });

    it('merges siblings under one parent', () => {
        expect(expandVariablePaths({
            'list.name': 'Weekly',
            'list.slug': 'weekly',
            'template.name': 'Digest',
        },),).toEqual({
            list: { name: 'Weekly', slug: 'weekly', },
            template: { name: 'Digest', },
        },);
    });

    it('handles a top-level path with no dot', () => {
        expect(expandVariablePaths({ unsubscribe_url: 'https://x/u/t', },),)
            .toEqual({ unsubscribe_url: 'https://x/u/t', },);
    });

    it('nests three levels (user.custom.city)', () => {
        expect(expandVariablePaths({ 'user.custom.city': 'Philadelphia', },),)
            .toEqual({ user: { custom: { city: 'Philadelphia', }, }, },);
    });

    it('preserves non-string values', () => {
        // A count must stay a number so `{{ if list.subscriberCount > 100 }}`
        // compares numerically rather than lexically.
        const out = expandVariablePaths({
            'list.subscriberCount': 1234,
            'list.doubleOptIn': true,
            'user.custom': {},
        },);
        expect((out.list as Record<string, unknown>).subscriberCount,).toBe(1234,);
        expect((out.list as Record<string, unknown>).doubleOptIn,).toBe(true,);
    });

    it('lets a later path overwrite an earlier leaf', () => {
        // How the editor's REAL template name beats the catalog sample.
        expect(expandVariablePaths({ 'template.name': 'Sample', },),)
            .toEqual({ template: { name: 'Sample', }, },);
        const merged = { 'template.name': 'Sample', };
        merged['template.name'] = 'Real Name';
        expect(expandVariablePaths(merged,),).toEqual({ template: { name: 'Real Name', }, },);
    });

    it('replaces a non-object leaf when a deeper path needs it as a parent', () => {
        // `{'a': 1, 'a.b': 2}` — the leaf has to become a branch or the
        // assignment would throw on a primitive.
        expect(() => expandVariablePaths({ a: 1, 'a.b': 2, },)).not.toThrow();
        expect(expandVariablePaths({ a: 1, 'a.b': 2, },),).toEqual({ a: { b: 2, }, },);
    });

    it('returns an empty bag for no paths', () => {
        expect(expandVariablePaths({},),).toEqual({},);
    });
});

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
    });

    it('keeps the variables the client cannot derive', () => {
        const bag = buildMailPreviewVariables(CATALOG,);
        expect((bag.list as Record<string, unknown>).name,).toBe('Weekly Newsletter',);
        expect((bag.template as Record<string, unknown>).name,).toBe('Weekly Digest',);
        expect((bag.user as Record<string, unknown>).name,).toBe('Sample Subscriber',);
        expect(bag.unsubscribe_url,).toBe('https://example.com/u/tok',);
    });

    it('lets real editor values beat the samples', () => {
        const bag = buildMailPreviewVariables(CATALOG, { 'template.name': 'Ryan Test Template', },);
        expect((bag.template as Record<string, unknown>).name,).toBe('Ryan Test Template',);
    });

    it('ignores an empty or undefined override, keeping the sample', () => {
        // A blank subject field should preview the sample, not an empty string
        // that looks like a broken variable.
        const bag = buildMailPreviewVariables(CATALOG, {
            'template.name': '',
            'template.subject': undefined,
        },);
        expect((bag.template as Record<string, unknown>).name,).toBe('Weekly Digest',);
    });

    it('preserves sample types', () => {
        const bag = buildMailPreviewVariables(CATALOG,);
        expect((bag.list as Record<string, unknown>).subscriberCount,).toBe(1234,);
    });

    it('excludes site.* even when an override names one', () => {
        // Nothing in the editor should be able to reintroduce a placeholder
        // logo by the back door.
        const bag = buildMailPreviewVariables(CATALOG, { 'site.logo': 'https://example.com/x.png', },);
        expect(bag.site,).toBeUndefined();
    });
});

/**
 * Real list/template values for the send composer.
 *
 * That page is the one surface that knows which list and template are actually
 * selected, so its Content preview should show what THIS send will say rather
 * than catalog samples. One mapping, shared, so the composer and the template
 * editor cannot disagree about what `{{list.slug}}` means.
 */
describe('mailVariableOverrides', () => {
    const list = {
        id: 'l1',
        name: 'Ryan Test List',
        slug: 'ryan-test',
        description: 'A test list',
        subscriberCount: 0,
        doubleOptIn: false,
        registeredUsersOnly: false,
        isEnabled: true,
    };

    it('maps a real list onto the {{list.*}} paths', () => {
        const o = mailVariableOverrides(list,);
        expect(o['list.name'],).toBe('Ryan Test List',);
        expect(o['list.slug'],).toBe('ryan-test',);
        expect(o['list.id'],).toBe('l1',);
        expect(o['list.description'],).toBe('A test list',);
    });

    it('keeps 0 and false — they are real answers, not absences', () => {
        // Dropping them would fall back to a sample count of 1234 on a list
        // that genuinely has no subscribers yet.
        const o = mailVariableOverrides(list,);
        expect(o['list.subscriberCount'],).toBe(0,);
        expect(o['list.doubleOptIn'],).toBe(false,);
        expect(o['list.isEnabled'],).toBe(true,);
    });

    it('omits what it does not know, so the sample stands', () => {
        const o = mailVariableOverrides({ name: 'Only a name', },);
        expect(o['list.name'],).toBe('Only a name',);
        expect('list.slug' in o,).toBe(false,);
    });

    it('maps a template draft onto the {{template.*}} paths', () => {
        const o = mailVariableOverrides(null, {
            id: 't1',
            name: 'Ryan Test Template',
            subject: 'Hi',
            preheader: 'Pre',
            fromName: 'Surge',
            fromEmail: 'a@b.c',
            replyTo: 'r@b.c',
            wasModified: true,
        },);
        expect(o['template.name'],).toBe('Ryan Test Template',);
        expect(o['template.subject'],).toBe('Hi',);
        expect(o['template.wasModified'],).toBe(true,);
    });

    it('drops null, which is how "no template chosen" arrives', () => {
        const o = mailVariableOverrides(null, { id: null, name: null, },);
        expect('template.id' in o,).toBe(false,);
        expect('template.name' in o,).toBe(false,);
    });

    it('feeds buildMailPreviewVariables so real values beat samples', () => {
        const bag = buildMailPreviewVariables(CATALOG, mailVariableOverrides(list, { name: 'Real Tpl', },),);
        expect((bag.list as Record<string, unknown>).name,).toBe('Ryan Test List',);
        expect((bag.template as Record<string, unknown>).name,).toBe('Real Tpl',);
        // Still no site bag, and the sample recipient still stands in.
        expect(bag.site,).toBeUndefined();
        expect((bag.user as Record<string, unknown>).name,).toBe('Sample Subscriber',);
    });

    it('returns nothing when neither is selected', () => {
        expect(mailVariableOverrides(null, null,),).toEqual({},);
    });
});

describe('setPreviewVariables — identity churn', () => {
    it('does NOT notify when the same content is republished', () => {
        /*
         * The publishers rebuild the whole bag inside an effect that tracks the
         * editor's subject/name/preheader, so a keystroke anywhere produced a
         * new object. `TemplatedContent` keys a resource on this signal, so a
         * new reference re-rendered every templated block in the editor.
         */
        let notifications = 0;
        createRoot(() => {
            setPreviewVariables(undefined,);
            createEffect(() => {
                previewVariables();
                notifications += 1;
            },);
        },);
        // Flush the initial run.
        const before = notifications;

        setPreviewVariables({ list: { name: 'Weekly', }, },);
        setPreviewVariables({ list: { name: 'Weekly', }, },); // same content, new object
        setPreviewVariables({ list: { name: 'Weekly', }, },);

        expect(notifications - before,).toBeLessThanOrEqual(1,);
    });

    it('DOES notify when the content actually changes', () => {
        // The guard must not swallow a real edit.
        const seen: unknown[] = [];
        createRoot(() => {
            setPreviewVariables(undefined,);
            createEffect(() => {
                seen.push(previewVariables(),);
            },);
        },);
        setPreviewVariables({ template: { subject: 'A', }, },);
        setPreviewVariables({ template: { subject: 'B', }, },);
        const subjects = seen
            .map(v => (v as { template?: { subject?: string; }; } | undefined)?.template?.subject)
            .filter(Boolean,);
        expect(subjects,).toEqual(['A', 'B',],);
    });

    it('still clears to undefined on unmount', () => {
        // Every editor clears on cleanup so a page preview cannot inherit this
        // one's sample subscriber. The guard must not block that.
        setPreviewVariables({ list: { name: 'X', }, },);
        setPreviewVariables(undefined,);
        expect(previewVariables(),).toBeUndefined();
    });
});
