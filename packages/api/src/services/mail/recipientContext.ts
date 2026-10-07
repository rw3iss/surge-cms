/**
 * The per-recipient `{{ }}` context for a mailing-list send — built in ONE
 * place for the send worker AND the sent-mail web view (`archive.ts`), so a
 * mail viewed in the browser resolves exactly as the email did.
 *
 * Also owns the signed VIEW TOKEN behind `{{mail.viewUrl}}`: `<recipientId>.<hmac>`
 * over the job + recipient, keyed like the unsubscribe tokens. It identifies
 * one recipient of one job; editing it fails the signature, so a reader cannot
 * swap in another subscriber's id to see their name or address.
 */
import { createHmac, timingSafeEqual, } from 'crypto';
import type { MailingList, MailingListSubscriber, MailSendJob, } from '@sitesurge/types';
import { config, } from '../../config';
import { generateUnsubscribeToken, } from './unsubscribe';
import { buildVariableContext, type MailVars, } from './variables';

function secret(): string {
    const s = config.mail.unsubscribeSecret;
    if (!s) throw new Error('MAIL_UNSUBSCRIBE_SECRET (or JWT_SECRET fallback) is required to sign mail view links',);
    return s;
}

const sign = (jobId: string, recipientId: string,) =>
    createHmac('sha256', secret(),).update(`view:${jobId}:${recipientId}`,).digest('base64url',);

/** `<recipientId>.<signature>` for one recipient of one job. */
export function viewToken(jobId: string, recipientId: string,): string {
    return `${recipientId}.${sign(jobId, recipientId,)}`;
}

/** The recipient id a view token was issued for, or null when it is not a
 *  valid token for THIS job. */
export function verifyViewToken(jobId: string, token: string | undefined | null,): string | null {
    if (!token) return null;
    const dot = token.indexOf('.',);
    if (dot <= 0) return null;
    const recipientId = token.slice(0, dot,);
    const given = Buffer.from(token.slice(dot + 1,),);
    const expected = Buffer.from(sign(jobId, recipientId,),);
    if (given.length !== expected.length || !timingSafeEqual(given, expected,)) return null;
    return recipientId;
}

export function frontendUrl(): string {
    return ((config.frontendUrl as string | undefined) ?? '').replace(/\/+$/, '',);
}

/** `{{mail.*}}` for a job, personalised when `recipientId` is given. */
export function mailVars(jobId: string, recipientId: string | null,): MailVars {
    const base = frontendUrl();
    const url = `${base}/mail/${jobId}`;
    const token = recipientId ? viewToken(jobId, recipientId,) : '';
    return { id: jobId, url, viewUrl: token ? `${url}?r=${encodeURIComponent(token,)}` : url, viewToken: token, archiveUrl: `${base}/mail`, };
}

export interface SiteBag {
    name: string;
    url: string;
    settings: Record<string, unknown>;
}

export interface RecipientContextInput {
    job: MailSendJob;
    list: MailingList;
    site: SiteBag;
    /** The subscriber row, when there is one. */
    subscriber: MailingListSubscriber | null;
    /** Recipient email (used when there is no subscriber row). */
    email: string;
    /** The mail_send_recipients row id → personalised `mail.viewUrl`. */
    recipientId: string | null;
    /** Override the reader shown as `{{user.*}}` (the web view's signed-in
     *  viewer); defaults to the subscriber. */
    user?: { name?: string; email?: string; phone?: string; } | null;
    /** Include the unsubscribe URL (only for the actual recipient). */
    withUnsubscribe?: boolean;
}

export function buildRecipientContext(input: RecipientContextInput,): Record<string, unknown> {
    const { job, list, site, subscriber: sub, } = input;
    const fe = frontendUrl();
    const unsubscribeUrl = sub && input.withUnsubscribe !== false ? `${fe}/u/${generateUnsubscribeToken(sub.id, list.id,)}` : '';
    const subscriber = (sub ?? {
        id: '',
        listId: list.id,
        email: input.email,
        customFields: {},
        status: 'subscribed',
        subscribedAt: '',
    }) as MailingListSubscriber;
    const ctx = {
        // The job's own variables go UNDER the per-recipient ones: a feature
        // supplying `products` must never be able to shadow the subscriber,
        // list or unsubscribe URL, which RFC 8058 depends on.
        ...(job.context ?? {}),
        ...buildVariableContext({
            siteSettings: site.settings,
            subscriber: input.user
                ? { ...subscriber, name: input.user.name ?? subscriber.name, email: input.user.email ?? subscriber.email, phone: input.user.phone ?? subscriber.phone, }
                : subscriber,
            list,
            siteName: site.name,
            siteUrl: site.url,
            unsubscribeUrl,
            // From the JOB, not the template row: {{template.name}} reports what
            // was actually sent after the template is renamed or deleted.
            template: {
                id: job.templateId,
                name: job.templateName,
                subject: job.subject,
                preheader: job.preheader,
                fromName: job.fromName,
                fromEmail: job.fromEmail,
                replyTo: job.replyTo,
                wasModified: job.templateWasModified,
            },
            mail: mailVars(job.id, input.recipientId,),
        },),
    };
    return ctx as unknown as Record<string, unknown>;
}
