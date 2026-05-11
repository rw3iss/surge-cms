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
import type { MailingList, MailingListSubscriber, VariableDescriptor, } from '@rw/shared';

export interface VariableContext {
    user: { name: string; email: string; phone: string; custom: Record<string, unknown>; };
    list: { name: string; description: string; slug: string; };
    site: { name: string; url: string; };
    unsubscribe_url: string;
    view_in_browser_url: string;
}

export interface BuildContextArgs {
    subscriber: MailingListSubscriber;
    list: MailingList;
    siteName: string;
    siteUrl: string;
    unsubscribeUrl: string;
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
        },
        site: { name: args.siteName, url: args.siteUrl, },
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
        { path: 'list.name',           description: 'Mailing list name.', sample: 'Weekly Newsletter', },
        { path: 'list.description',    description: 'Mailing list description.', sample: '', },
        { path: 'list.slug',           description: 'Mailing list slug.', sample: 'newsletter', },
        { path: 'site.name',           description: 'Site name.', sample: 'SiteSurge', },
        { path: 'site.url',            description: 'Site URL.', sample: 'https://example.com', },
        { path: 'unsubscribe_url',     description: 'One-click unsubscribe URL.', sample: 'https://example.com/u/sample-token', },
        { path: 'view_in_browser_url', description: 'Public archive URL. V1: empty.', sample: '', },
    ];
}

/**
 * Build a sample context for the preview modal from `describeVariables()`,
 * deep-merging any per-path overrides the operator typed into the form.
 */
export function buildSampleContext(overrides: Record<string, string> = {},): Record<string, unknown> {
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
