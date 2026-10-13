/**
 * "You've been subscribed" — the notice a person gets when they JOIN a mailing
 * list (Mailing Lists → Settings → "Notify new subscribers", on by default).
 *
 * Sent for self-service sign-ups only: the public subscribe form, a form's
 * "subscribe" action, sign-up auto-subscribe, and a double-opt-in confirmation.
 * Not for admin adds / imports, and never for someone already on the list.
 *
 * Body: a short message (list name + description, the address, and the list's
 * own unsubscribe link) rendered as `{{content}}` (also `{{message}}`,
 * `{{notification.message}}`, `{{reply.message}}`) into either
 *   - the chosen Mail Template (`signupNotifyTemplateId`) through the same email
 *     render pass as every template send — with the full list-mail variables
 *     (`{{list.*}}`, `{{user.*}}`, `{{site.*}}`, `{{unsubscribe_url}}`), or
 *   - the built-in Default Template (the one CMS replies use).
 * From: the Mailing Lists default sender (name / address / reply-to).
 * Never throws: a failed notice must not fail the subscription.
 */
import type { MailingList, MailingListSubscriber, } from '@sitesurge/types';
import * as lists from '../../repositories/mailingLists.repo';
import * as subs from '../../repositories/mailingListSubscribers.repo';
import { escapeHtml, } from '../../utils/html';
import { logger, } from '../../utils/logger';
import { sendEmail, } from '../email';
import * as mailTemplates from '../mailTemplates';
import { renderDefaultReply, replyLayout, } from '../reply/defaultTemplate';
import { getMailingListsSettings, } from '../settings';
import { frontendUrl, } from './recipientContext';
import { loadMailRenderContext, } from './siteContext';
import { generateUnsubscribeToken, } from './unsubscribe';
import { buildVariableContext, } from './variables';

/** The default message (HTML), shared by both render paths. */
export function signupNoticeContent(list: MailingList, sub: MailingListSubscriber, unsubscribeUrl: string,): string {
    const p = (html: string,) => `<p style="margin:0 0 16px;line-height:1.6">${html}</p>`;
    const name = sub.name?.trim();
    return [
        p(name ? `Hi ${escapeHtml(name,)},` : 'Hi there,',),
        p(`You've been subscribed to <strong>${escapeHtml(list.name,)}</strong>.${list.description ? ` ${escapeHtml(list.description,)}` : ''}`,),
        p(`We'll send its emails to <strong>${escapeHtml(sub.email,)}</strong>.`,),
        p(`Didn't sign up, or changed your mind? <a href="${escapeHtml(unsubscribeUrl,)}">Unsubscribe from ${escapeHtml(list.name,)}</a> at any time — it takes one click.`,),
    ].join('',);
}

export async function renderSignupNotice(listId: string, subscriberId: string, templateId?: string | null,) {
    const [list, sub,] = await Promise.all([lists.findById(listId,), subs.findById(subscriberId,),],);
    if (!list || !sub) return null;
    return renderFor(list, sub, `${frontendUrl()}/u/${generateUnsubscribeToken(sub.id, list.id,)}`, templateId,);
}

/** Admin preview: the first list + a sample subscriber (the unsubscribe link is a placeholder). */
export async function previewSignupNotice(templateId?: string | null,) {
    const list = (await lists.list().catch(() => [] as MailingList[]))[0];
    const sample = list ?? ({ id: 'preview', name: 'Our newsletter', slug: 'newsletter', description: '', doubleOptIn: false, registeredUsersOnly: false, isEnabled: true, } as unknown as MailingList);
    const sub = { id: 'preview', listId: sample.id, email: 'subscriber@example.com', name: 'Alex', customFields: {}, status: 'subscribed', subscribedAt: '', } as unknown as MailingListSubscriber;
    return renderFor(sample, sub, `${frontendUrl()}/u/preview`, templateId,);
}

async function renderFor(list: MailingList, sub: MailingListSubscriber, unsubscribeUrl: string, templateId?: string | null,) {
    const content = signupNoticeContent(list, sub, unsubscribeUrl,);
    const subject = `You're subscribed to ${list.name}`;

    if (templateId) {
        const site = await loadMailRenderContext();
        const vars = buildVariableContext({
            subscriber: sub, list, siteName: site.siteName, siteUrl: site.siteUrl, unsubscribeUrl,
            siteSettings: site.siteSettings as Record<string, unknown>,
        },) as unknown as Record<string, unknown>;
        const context: Record<string, unknown> = {
            ...vars,
            subscriber: { name: sub.name ?? '', email: sub.email, },
            unsubscribeUrl,
            content,
            message: content,
            notification: { message: content, subject, },
            // Templates built for CMS replies read {{reply.message}}.
            reply: { message: content, subject, },
        };
        const out = await mailTemplates.renderForRecipient(templateId, { subject, context, },);
        return { to: sub.email, subject: out.subject || subject, html: out.html, unsubscribeUrl, };
    }
    return { to: sub.email, subject, html: renderDefaultReply(content, await replyLayout(),), unsubscribeUrl, };
}

/** Send the notice when the setting is on. Never throws. */
export async function sendListSignupNotice(listId: string, subscriberId: string,): Promise<void> {
    try {
        const settings = await getMailingListsSettings();
        if (settings.signupNotifyEnabled === false) return;
        let msg = await renderSignupNotice(listId, subscriberId, settings.signupNotifyTemplateId,).catch(async (e: unknown,) => {
            // A deleted / broken template falls back to the default rather than sending nothing.
            logger.warn('list signup notice: template failed, using the default', { error: (e as Error).message, },);
            return renderSignupNotice(listId, subscriberId, null,);
        },);
        if (!msg) return;
        await sendEmail({
            to: msg.to,
            subject: msg.subject,
            html: msg.html,
            fromName: settings.defaultFromName,
            fromEmail: settings.defaultFromEmail,
            replyTo: settings.defaultReplyTo,
            headers: { 'List-Unsubscribe': `<${msg.unsubscribeUrl}>`, },
        },);
        msg = null;
    } catch (e) {
        logger.warn('list signup notice failed', { listId, subscriberId, error: (e as Error).message, },);
    }
}
