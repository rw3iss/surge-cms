/**
 * The per-recipient variable bags an email is rendered against.
 *
 * `{{list.*}}` had three properties and `{{template.*}}` did not exist, so a
 * template could not say which list it was going to or which template it came
 * from. Both are now bound automatically at send time.
 */
import { describe, expect, it, } from 'vitest';
import type { MailingList, MailingListSubscriber, } from '@sitesurge/types';
import { buildVariableContext, describeVariables, substituteVariables, } from './variables';

const list = {
    id: 'list-1', slug: 'newsletter', name: 'Weekly Newsletter',
    description: 'The weekly one', isEnabled: true, registeredUsersOnly: false,
    doubleOptIn: true, createdAt: '', updatedAt: '', subscriberCount: 1234,
} as MailingList;

const subscriber = {
    id: 'sub-1', listId: 'list-1', email: 'reader@example.com', name: 'Reader',
    phone: '555', status: 'subscribed', customFields: { city: 'Philadelphia', },
    subscribedAt: '',
} as MailingListSubscriber;

const build = (over: Record<string, unknown> = {},) => buildVariableContext({
    subscriber, list, siteName: 'Surge Media', siteUrl: 'https://example.com',
    unsubscribeUrl: 'https://example.com/u/tok',
    ...over,
} as never,);

describe('{{list.*}}', () => {
    it('exposes every documented property', () => {
        const c = build();
        expect(c.list.name,).toBe('Weekly Newsletter',);
        expect(c.list.description,).toBe('The weekly one',);
        expect(c.list.slug,).toBe('newsletter',);
        expect(c.list.id,).toBe('list-1',);
        expect(c.list.subscriberCount,).toBe(1234,);
        expect(c.list.doubleOptIn,).toBe(true,);
        expect(c.list.registeredUsersOnly,).toBe(false,);
        expect(c.list.isEnabled,).toBe(true,);
    });

    it('defaults a missing subscriberCount to 0 rather than undefined', () => {
        // It is joined on read, so a caller that did not ask for it would
        // otherwise render the literal "undefined" into an email.
        const c = buildVariableContext({
            subscriber, list: { ...list, subscriberCount: undefined, },
            siteName: 'S', siteUrl: 'u', unsubscribeUrl: '',
        } as never,);
        expect(c.list.subscriberCount,).toBe(0,);
    });

    it('renders a blank description rather than "undefined"', () => {
        const c = buildVariableContext({
            subscriber, list: { ...list, description: undefined, },
            siteName: 'S', siteUrl: 'u', unsubscribeUrl: '',
        } as never,);
        expect(substituteVariables('[{{list.description}}]', c,),).toBe('[]',);
    });
});

describe('{{template.*}}', () => {
    it('is bound from the send job', () => {
        const c = build({ template: {
            id: 'tpl-1', name: 'Weekly Digest', subject: 'Hello',
            preheader: 'Pre', fromName: 'Surge', fromEmail: 'a@b.c',
            replyTo: 'r@b.c', wasModified: true,
        }, },);
        expect(c.template.name,).toBe('Weekly Digest',);
        expect(c.template.id,).toBe('tpl-1',);
        expect(c.template.subject,).toBe('Hello',);
        expect(c.template.preheader,).toBe('Pre',);
        expect(c.template.fromName,).toBe('Surge',);
        expect(c.template.fromEmail,).toBe('a@b.c',);
        expect(c.template.replyTo,).toBe('r@b.c',);
        expect(c.template.wasModified,).toBe(true,);
    });

    it('is present but EMPTY when there is no job (a transactional send)', () => {
        // Absent-but-defined matters: `{{template.name}}` must render blank,
        // not crash the resolver walking into undefined.
        const c = build();
        expect(c.template,).toBeDefined();
        expect(c.template.name,).toBe('',);
        expect(substituteVariables('[{{template.name}}]', c,),).toBe('[]',);
    });

    it('renders nulls from the job as blanks', () => {
        const c = build({ template: { id: null, name: null, subject: null, }, },);
        expect(substituteVariables('[{{template.name}}][{{template.id}}]', c,),).toBe('[][]',);
    });
});

describe('substitution end to end', () => {
    it('resolves the new paths in real copy', () => {
        const c = build({ template: { name: 'Weekly Digest', }, },);
        const out = substituteVariables(
            'Hi {{user.name}} — {{template.name}} for {{list.name}} ({{list.subscriberCount}} readers) in {{user.custom.city}}.',
            c,
        );
        expect(out,).toBe('Hi Reader — Weekly Digest for Weekly Newsletter (1234 readers) in Philadelphia.',);
    });

    it('an unknown path renders blank, not the raw token', () => {
        expect(substituteVariables('[{{list.nope}}]', build(),),).toBe('[]',);
    });
});

describe('the documented catalog matches the real bag', () => {
    const paths = describeVariables().map(d => d.path,);

    it.each([
        'list.name', 'list.description', 'list.slug', 'list.id', 'list.subscriberCount',
        'list.doubleOptIn', 'list.registeredUsersOnly', 'list.isEnabled',
        'template.name', 'template.id', 'template.subject', 'template.preheader',
        'template.fromName', 'template.fromEmail', 'template.replyTo', 'template.wasModified',
        'user.name', 'user.email', 'user.phone', 'user.custom',
    ],)('documents %s', (path,) => {
        expect(paths,).toContain(path,);
    });

    it('every documented list/template path actually resolves', () => {
        // The catalog drives the editor panel and the preview, so a path it
        // advertises that the bag does not provide is a promise the send
        // breaks.
        const c = build({ template: { name: 'T', id: 'i', subject: 's', }, }) as unknown as Record<string, unknown>;
        for (const d of describeVariables()) {
            if (!d.path.startsWith('list.') && !d.path.startsWith('template.')) continue;
            const walk = d.path.split('.',).reduce<unknown>(
                (acc, k,) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
                c,
            );
            expect(walk, `${d.path} is documented but not in the context`,).toBeDefined();
        }
    });

    it('samples keep their real types', () => {
        // Previewing a count as the STRING "1234" would mislead anyone
        // writing `{{ if list.subscriberCount > 100 }}`.
        const byPath = Object.fromEntries(describeVariables().map(d => [d.path, d.sample,]),);
        expect(typeof byPath['list.subscriberCount'],).toBe('number',);
        expect(typeof byPath['list.doubleOptIn'],).toBe('boolean',);
        expect(typeof byPath['template.wasModified'],).toBe('boolean',);
        expect(typeof byPath['list.name'],).toBe('string',);
    });
});
