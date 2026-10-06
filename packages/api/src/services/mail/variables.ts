/**
 * `{{path.to.var}}` token engine. Tokens survive the email renderer
 * (they go into the rendered HTML verbatim) so per-recipient
 * substitution happens at send time, not at template-author time.
 *
 *   buildVariableContext(...)   — assemble per-recipient context
 *   substituteVariables(html, ctx) — regex replace tokens
 *   detectVariables(text)       — scan for { paths } used in a string
 *   describeVariables()         — catalog for the editor UI
 */
import { buildSiteVariables, type SiteVariables, } from '@sitesurge/types';
import type { MailingList, MailingListSubscriber, VariableDescriptor, } from '@sitesurge/types';

export interface VariableContext {
    user: { name: string; email: string; phone: string; custom: Record<string, unknown>; };
    list: {
        name: string; description: string; slug: string; id: string;
        subscriberCount: number; doubleOptIn: boolean;
        registeredUsersOnly: boolean; isEnabled: boolean;
    };
    /**
     * The template this email was built from, as captured AT SEND TIME.
     *
     * Taken from the send JOB rather than re-read from the template row: the
     * job stores the name and meta it was created with, so `{{template.name}}`
     * still says what was actually sent after the template is renamed or
     * deleted. Re-reading would quietly rewrite history.
     */
    template: {
        name: string; id: string; subject: string; preheader: string;
        fromName: string; fromEmail: string; replyTo: string; wasModified: boolean;
    };
    /** The SHARED site bag (name / url / logo / favicon / tagline / …) — the
     *  same shape the page and SSR runtimes build, so a template means the
     *  same thing in an email as on the site. Was `{ name, url }`, which is
     *  why `{{site.logo}}` rendered empty in mail. */
    site: SiteVariables;
    unsubscribe_url: string;
    view_in_browser_url: string;
}

export interface BuildContextArgs {
    subscriber: MailingListSubscriber;
    list: MailingList;
    siteName: string;
    siteUrl: string;
    unsubscribeUrl: string;
    /** Public site settings, for the full `{{site.*}}` bag. Optional so an
     *  older caller still gets name/url rather than nothing. */
    siteSettings?: Record<string, unknown> | null;
    /** Template meta as captured on the send job. Optional: a caller that has
     *  no job (a transactional send) still gets every other bag. */
    template?: {
        id?: string | null; name?: string | null; subject?: string | null;
        preheader?: string | null; fromName?: string | null; fromEmail?: string | null;
        replyTo?: string | null; wasModified?: boolean | null;
    } | null;
}

export function buildVariableContext(args: BuildContextArgs,): VariableContext {
    return {
        user: {
            name: args.subscriber.name ?? '',
            email: args.subscriber.email,
            phone: args.subscriber.phone ?? '',
            custom: args.subscriber.customFields ?? {},
        },
        list: {
            name: args.list.name,
            description: args.list.description ?? '',
            slug: args.list.slug,
            id: args.list.id,
            subscriberCount: args.list.subscriberCount ?? 0,
            doubleOptIn: args.list.doubleOptIn,
            registeredUsersOnly: args.list.registeredUsersOnly,
            isEnabled: args.list.isEnabled,
        },
        template: {
            name: args.template?.name ?? '',
            id: args.template?.id ?? '',
            subject: args.template?.subject ?? '',
            preheader: args.template?.preheader ?? '',
            fromName: args.template?.fromName ?? '',
            fromEmail: args.template?.fromEmail ?? '',
            replyTo: args.template?.replyTo ?? '',
            wasModified: args.template?.wasModified ?? false,
        },
        site: buildSiteVariables(
            // `siteName` is passed separately by every caller and is the
            // authoritative one here, so it overrides the settings row.
            { ...(args.siteSettings ?? {}), siteName: args.siteName, },
            args.siteUrl,
        ),
        unsubscribe_url: args.unsubscribeUrl,
        // V1: documented but resolved to empty. A real archive page
        // ships post-V1.
        view_in_browser_url: '',
    };
}

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function detectVariables(text: string,): string[] {
    const set = new Set<string>();
    for (const m of text.matchAll(TOKEN_RE,)) set.add(m[1],);
    return Array.from(set,);
}

function resolvePath(ctx: unknown, path: string,): string {
    const parts = path.split('.',);
    let cur: unknown = ctx;
    for (const p of parts) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return '';
        cur = (cur as Record<string, unknown>)[p];
    }
    if (cur === null || cur === undefined) return '';
    if (typeof cur === 'object') return JSON.stringify(cur,);
    return String(cur,);
}

export function substituteVariables(text: string, ctx: VariableContext | Record<string, unknown>,): string {
    return text.replace(TOKEN_RE, (_full, path,) => resolvePath(ctx, path,),);
}

export function describeVariables(): VariableDescriptor[] {
    return [
        { path: 'user.name',           description: 'Subscriber name (blank for email-only subscribers).', sample: 'Sample Subscriber', },
        { path: 'user.email',          description: 'Subscriber email.', sample: 'subscriber@example.com', },
        { path: 'user.phone',          description: 'Subscriber phone (optional).', sample: '', },
        { path: 'user.custom',         description: 'Custom subscriber fields, e.g. {{user.custom.city}}.', sample: {}, },
        { path: 'list.name',           description: 'Mailing list name.', sample: 'Weekly Newsletter', },
        { path: 'list.description',    description: 'Mailing list description.', sample: '', },
        { path: 'list.slug',           description: 'Mailing list slug.', sample: 'newsletter', },
        { path: 'list.id',             description: 'Mailing list id.', sample: '00000000-0000-0000-0000-000000000000', },
        { path: 'list.subscriberCount', description: 'Subscribed members at send time.', sample: 1234, },
        { path: 'list.doubleOptIn',    description: 'Whether the list confirms subscriptions by email.', sample: false, },
        { path: 'list.registeredUsersOnly', description: 'Whether only registered users may subscribe.', sample: false, },
        { path: 'list.isEnabled',      description: 'Whether the list is accepting sends.', sample: true, },
        { path: 'template.name',       description: 'Template name, as captured at send time.', sample: 'Weekly Digest', },
        { path: 'template.id',         description: 'Template id.', sample: '00000000-0000-0000-0000-000000000000', },
        { path: 'template.subject',    description: 'Subject line actually sent.', sample: 'This week at Surge Media', },
        { path: 'template.preheader',  description: 'Preheader actually sent.', sample: 'The stories that mattered', },
        { path: 'template.fromName',   description: 'From name (falls back to the list/site default).', sample: 'Surge Media', },
        { path: 'template.fromEmail',  description: 'From address.', sample: 'newsletter@example.com', },
        { path: 'template.replyTo',    description: 'Reply-To address.', sample: 'hello@example.com', },
        { path: 'template.wasModified', description: 'Blocks were edited after picking the template.', sample: false, },
        { path: 'site.name',           description: 'Site name.', sample: 'Surge CMS', },
        { path: 'site.url',            description: 'Site URL.', sample: 'https://example.com', },
        { path: 'site.logo',           description: 'Site logo image URL (Settings → Site Branding).', sample: 'https://example.com/logo.png', },
        { path: 'site.favicon',        description: 'Site favicon URL.', sample: 'https://example.com/favicon.ico', },
        { path: 'site.tagline',        description: 'Site tagline, when set.', sample: 'Independent journalism', },
        { path: 'site.description',    description: 'Site description.', sample: 'News and commentary.', },
        { path: 'unsubscribe_url',     description: 'One-click unsubscribe URL.', sample: 'https://example.com/u/sample-token', },
        { path: 'view_in_browser_url', description: 'Public archive URL. V1: empty.', sample: '', },
    ];
}

/**
 * Build a sample context for the preview modal from `describeVariables()`,
 * deep-merging any per-path overrides the operator typed into the form.
 */
export function buildSampleContext(overrides: Record<string, unknown> = {},): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const set = (path: string, val: unknown,): void => {
        const parts = path.split('.',);
        let cur = out;
        for (let i = 0; i < parts.length - 1; i++) {
            const key = parts[i];
            if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
            cur = cur[key] as Record<string, unknown>;
        }
        cur[parts[parts.length - 1]] = val;
    };
    for (const d of describeVariables()) set(d.path, d.sample,);
    for (const [path, val,] of Object.entries(overrides,)) set(path, val,);
    return out;
}
